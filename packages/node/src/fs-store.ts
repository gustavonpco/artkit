import { randomBytes } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type Actor,
  ARTIFACT_ID_PATTERN,
  type Artifact,
  ArtifactError,
  type ArtifactFilter,
  type ArtifactStatus,
  type ArtifactStore,
  type ArtifactSummary,
  type Commit,
  createArtifactId,
  type Lock,
  type NewArtifact,
  type PageRequest,
  type Scope,
  summarize,
  t,
  type VersionEntry,
} from '@artkit-ai/core';
import {
  hashName,
  isErrno,
  KeyedMutex,
  mapLimit,
  readJson,
  removeFile,
  writeJsonAtomic,
} from './fs-utils.js';

export interface FsStoreOptions {
  /** Root directory. Created on first write. */
  dir: string;
  /** Snapshot every N versions in the history (the first version always has one). Default 10. */
  snapshotEvery?: number;
  now?: () => Date;
  /** Locale of error messages (pt-BR or en). */
  locale?: string;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 500;
const READ_CONCURRENCY = 16;

interface IdempotencyRecord {
  key: string;
  version: number;
}

/**
 * Filesystem `ArtifactStore` (spec §15.2) for local tools, CLIs and development agents.
 *
 * Layout, per workspace (directory name = sha256 of the workspace id) and artifact:
 *
 * ```
 * <dir>/workspaces/<sha256(workspaceId)>/artifacts/<artifactId>/
 *   head.json                 current envelope; replacing it is the commit point
 *   versions/<n>.json         envelopes of superseded versions (immutable)
 *   history/<n>.json          VersionEntry per version (snapshots every `snapshotEvery`)
 *   idempotency/<sha256>.json idempotency key → version
 *   lock.json                 advisory edit lock with expiry
 * ```
 *
 * Every file is written atomically (temp file + fsync + rename). Writes to one artifact are serialized
 * by an in-process mutex, so concurrent commits in one process get `VERSION_CONFLICT` on a stale
 * `baseVersion`. The store assumes a single writing process per directory; use a database store
 * (see `examples/postgres-store`) when several processes write.
 */
export function createFsStore(options: FsStoreOptions): ArtifactStore {
  if (typeof options?.dir !== 'string' || options.dir.trim() === '') {
    throw new TypeError('createFsStore: `dir` must be a non-empty path.');
  }
  const snapshotEvery = options.snapshotEvery ?? 10;
  if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1) {
    throw new TypeError('createFsStore: `snapshotEvery` must be a positive integer.');
  }
  const root = resolve(options.dir);
  const now = options.now ?? (() => new Date());
  const locale = options.locale;
  const mutex = new KeyedMutex();

  const workspaceDir = (scope: Scope) => join(root, 'workspaces', hashName(scope.workspaceId), 'artifacts');
  // Workspace-level index of creation idempotency keys → artifact id (spans artifacts, unlike `idempotency/`).
  const createKeyFile = (scope: Scope, key: string) =>
    join(root, 'workspaces', hashName(scope.workspaceId), 'creates', `${hashName(key)}.json`);
  const artifactDir = (scope: Scope, id: string) => join(workspaceDir(scope), id);
  const versionName = (version: number) => `${String(version).padStart(10, '0')}.json`;
  const files = (scope: Scope, id: string) => {
    const base = artifactDir(scope, id);
    return {
      base,
      head: join(base, 'head.json'),
      lock: join(base, 'lock.json'),
      version: (v: number) => join(base, 'versions', versionName(v)),
      history: (v: number) => join(base, 'history', versionName(v)),
      idempotency: (key: string) => join(base, 'idempotency', `${hashName(key)}.json`),
    };
  };

  const notFound = (id: string): never => {
    throw new ArtifactError('NOT_FOUND', t(locale, 'NOT_FOUND', { what: 'Artifact', id }));
  };

  // Ids are validated against the core pattern before touching the filesystem: this blocks path traversal.
  const validId = (id: unknown): id is string => typeof id === 'string' && ARTIFACT_ID_PATTERN.test(id);

  async function readHead(scope: Scope, id: string): Promise<Artifact | undefined> {
    if (!validId(id)) return undefined;
    return readJson<Artifact>(files(scope, id).head);
  }

  async function requireHead(scope: Scope, id: string): Promise<Artifact> {
    return (await readHead(scope, id)) ?? notFound(String(id));
  }

  function withHeadStatus(entry: VersionEntry, head: Artifact): VersionEntry {
    return entry.version === head.version ? { ...entry, status: head.status } : entry;
  }

  async function activeLock(scope: Scope, id: string): Promise<Lock | null> {
    const path = files(scope, id).lock;
    const lock = await readJson<Lock>(path);
    if (!lock) return null;
    if (Date.parse(lock.expiresAt) <= now().getTime()) {
      await removeFile(path);
      return null;
    }
    return lock;
  }

  const lockKey = (scope: Scope, id: string) => `${hashName(scope.workspaceId)}/${id}`;

  function paginateOffset(total: number, page: PageRequest): { start: number; limit: number } {
    const start = page.cursor ? Math.max(0, Math.floor(Number(page.cursor)) || 0) : 0;
    const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_PAGE), MAX_PAGE);
    return { start: Math.min(start, total), limit };
  }

  const store: ArtifactStore = {
    async get(scope, id, opts) {
      const head = await readHead(scope, id);
      if (!head) return null;
      const version = opts?.version;
      if (version === undefined || version === head.version) return head;
      if (!Number.isInteger(version) || version < 1 || version > head.version) return null;
      return (await readJson<Artifact>(files(scope, id).version(version))) ?? null;
    },

    async create(scope, input: NewArtifact) {
      const at = now();
      let id = createArtifactId(at.getTime());
      // The artifact directory is created exclusively; a (practically impossible) id collision retries.
      for (;;) {
        await mkdir(workspaceDir(scope), { recursive: true });
        try {
          await mkdir(artifactDir(scope, id));
          break;
        } catch (error) {
          if (!isErrno(error, 'EEXIST')) throw error;
          id = createArtifactId(at.getTime());
        }
      }
      const paths = files(scope, id);
      const artifact: Artifact = {
        id,
        kind: input.kind,
        schemaVersion: input.schemaVersion,
        version: 1,
        title: input.title,
        status: input.status,
        locale: input.locale,
        themeId: input.themeId,
        content: structuredClone(input.content),
        meta: {
          createdAt: at.toISOString(),
          updatedAt: at.toISOString(),
          createdBy: scope.actor,
          updatedBy: scope.actor,
          tags: input.tags ?? [],
        },
      };
      const entry: VersionEntry = {
        version: 1,
        actor: scope.actor,
        createdAt: at.toISOString(),
        operations: [],
        diff: [],
        createdIds: input.createdIds ?? [],
        status: input.status,
        ...(input.message ? { message: input.message } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        snapshot: { schemaVersion: input.schemaVersion, content: input.content },
      };
      await mutex.run(lockKey(scope, id), async () => {
        await writeJsonAtomic(paths.history(1), entry);
        if (input.idempotencyKey) {
          await writeJsonAtomic(paths.idempotency(input.idempotencyKey), {
            key: input.idempotencyKey,
            version: 1,
          } satisfies IdempotencyRecord);
        }
        await writeJsonAtomic(paths.head, artifact);
        // Written after the head (the commit point), so a crash never indexes a missing artifact.
        if (input.idempotencyKey) {
          await mkdir(dirname(createKeyFile(scope, input.idempotencyKey)), { recursive: true });
          await writeJsonAtomic(createKeyFile(scope, input.idempotencyKey), {
            key: input.idempotencyKey,
            id,
          });
        }
      });
      return artifact;
    },

    async findCreatedByIdempotencyKey(scope, key) {
      const record = await readJson<{ key: string; id: string }>(createKeyFile(scope, key));
      if (!record || record.key !== key) return null;
      const head = await readHead(scope, record.id);
      const creator = head?.meta.createdBy;
      return head && creator?.type === scope.actor.type && creator.id === scope.actor.id ? head : null;
    },

    async commit(scope, id, change: Commit) {
      if (!validId(id)) return notFound(String(id));
      return mutex.run(lockKey(scope, id), async () => {
        const current = await requireHead(scope, id);
        if (change.baseVersion !== current.version) {
          throw new ArtifactError(
            'VERSION_CONFLICT',
            t(locale, 'VERSION_CONFLICT', {
              baseVersion: change.baseVersion,
              currentVersion: current.version,
            }),
            { details: { currentVersion: current.version } },
          );
        }
        const paths = files(scope, id);
        const at = now().toISOString();
        const version = current.version + 1;
        const next: Artifact = {
          ...current,
          schemaVersion: change.schemaVersion,
          version,
          title: change.title,
          locale: change.locale,
          themeId: change.themeId,
          status: change.status ?? current.status,
          content: structuredClone(change.content),
          meta: { ...current.meta, updatedAt: at, updatedBy: scope.actor },
        };
        const entry: VersionEntry = {
          version,
          actor: scope.actor,
          createdAt: at,
          operations: change.operations,
          diff: change.diff,
          createdIds: change.createdIds ?? [],
          status: next.status,
          ...(change.message ? { message: change.message } : {}),
          ...(change.idempotencyKey ? { idempotencyKey: change.idempotencyKey } : {}),
          ...(change.restoredFrom ? { restoredFrom: change.restoredFrom } : {}),
          ...(version % snapshotEvery === 0
            ? { snapshot: { schemaVersion: change.schemaVersion, content: change.content } }
            : {}),
        };
        // Order matters for crash safety: everything a reader may follow is written before head.json,
        // the commit point. Files left by an interrupted commit are ignored (version > head) and overwritten.
        await writeJsonAtomic(paths.version(current.version), current);
        await writeJsonAtomic(paths.history(version), entry);
        if (change.idempotencyKey) {
          await writeJsonAtomic(paths.idempotency(change.idempotencyKey), {
            key: change.idempotencyKey,
            version,
          } satisfies IdempotencyRecord);
        }
        await writeJsonAtomic(paths.head, next);
        return next;
      });
    },

    async history(scope, id, page) {
      const head = await requireHead(scope, id);
      const { start, limit } = paginateOffset(head.version, page);
      const versions: number[] = [];
      for (let v = head.version - start; v >= 1 && versions.length < limit; v--) versions.push(v);
      const paths = files(scope, id);
      const entries = await mapLimit(versions, READ_CONCURRENCY, async (v) => {
        const entry = await readJson<VersionEntry>(paths.history(v));
        if (!entry) throw new Error(`artkit fs store: history entry ${v} of ${id} is missing`);
        return withHeadStatus(entry, head);
      });
      return start + limit < head.version
        ? { items: entries, nextCursor: String(start + limit) }
        : { items: entries };
    },

    async list(scope, filter: ArtifactFilter, page) {
      let names: string[];
      try {
        names = await readdir(workspaceDir(scope));
      } catch (error) {
        if (isErrno(error, 'ENOENT')) names = [];
        else throw error;
      }
      const heads = await mapLimit(names.filter(validId), READ_CONCURRENCY, (id) => readHead(scope, id));
      const items: ArtifactSummary[] = [];
      const title = filter.title?.toLowerCase();
      for (const artifact of heads) {
        if (!artifact) continue;
        if (filter.kind && artifact.kind !== filter.kind) continue;
        if (filter.status && artifact.status !== filter.status) continue;
        if (title && !artifact.title.toLowerCase().includes(title)) continue;
        if (filter.tag && !artifact.meta.tags.includes(filter.tag)) continue;
        items.push(summarize(artifact));
      }
      // Same order as the memory store: most recently updated first, ties by id descending.
      items.sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : -1,
      );
      const { start, limit } = paginateOffset(items.length, page);
      const slice = items.slice(start, start + limit);
      return start + limit < items.length
        ? { items: slice, nextCursor: String(start + limit) }
        : { items: slice };
    },

    async setStatus(scope, id, status: ArtifactStatus, actor: Actor, message?: string) {
      if (!validId(id)) return notFound(String(id));
      return mutex.run(lockKey(scope, id), async () => {
        const current = await requireHead(scope, id);
        const at = now().toISOString();
        const updated: Artifact = {
          ...current,
          status,
          meta: {
            ...current.meta,
            updatedAt: at,
            updatedBy: actor,
            ...(status === 'published' ? { publishedVersion: current.version } : {}),
          },
        };
        const paths = files(scope, id);
        await writeJsonAtomic(paths.head, updated);
        const entry = await readJson<VersionEntry>(paths.history(current.version));
        if (entry) {
          const change = { status, actor, at, ...(message ? { message } : {}) };
          await writeJsonAtomic(paths.history(current.version), {
            ...entry,
            status,
            statusLog: [...(entry.statusLog ?? []), change],
          });
        }
        return updated;
      });
    },

    async lock(scope, id, actor, ttlMs) {
      if (!validId(id)) return notFound(String(id));
      return mutex.run(lockKey(scope, id), async () => {
        await requireHead(scope, id);
        const existing = await activeLock(scope, id);
        if (existing && (existing.holder.id !== actor.id || existing.holder.type !== actor.type)) {
          throw new ArtifactError(
            'LOCKED',
            t(locale, 'LOCKED', {
              holder: `${existing.holder.type}:${existing.holder.id}`,
              expiresAt: existing.expiresAt,
            }),
            { details: { expiresAt: existing.expiresAt } },
          );
        }
        const lock: Lock = {
          artifactId: id,
          holder: actor,
          token: randomBytes(16).toString('hex'),
          expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
        };
        await writeJsonAtomic(files(scope, id).lock, lock);
        return lock;
      });
    },

    async unlock(scope, lock) {
      const id = lock?.artifactId;
      if (!validId(id)) return notFound(String(id));
      await mutex.run(lockKey(scope, id), async () => {
        await requireHead(scope, id);
        const path = files(scope, id).lock;
        const current = await readJson<Lock>(path);
        if (current && current.token === lock.token) await removeFile(path);
      });
    },

    async getLock(scope, id) {
      if (!validId(id)) return notFound(String(id));
      return mutex.run(lockKey(scope, id), async () => {
        await requireHead(scope, id);
        return activeLock(scope, id);
      });
    },

    async findByIdempotencyKey(scope, id, key) {
      const head = await requireHead(scope, id);
      const paths = files(scope, id);
      const record = await readJson<IdempotencyRecord>(paths.idempotency(key));
      // Records left by an interrupted commit point past the head or at an entry with another key.
      if (!record || record.key !== key || record.version > head.version) return null;
      const entry = await readJson<VersionEntry>(paths.history(record.version));
      if (!entry || entry.idempotencyKey !== key) return null;
      return withHeadStatus(entry, head);
    },
  };
  return store;
}
