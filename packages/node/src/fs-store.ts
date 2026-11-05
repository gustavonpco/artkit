import { randomBytes } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ARTIFACT_ID_PATTERN,
  type Artifact,
  ArtifactError,
  type ArtifactFilter,
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
  now?: () => Date;
  /** Locale of error messages (pt-BR or en). */
  locale?: string;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 500;
const READ_CONCURRENCY = 16;

/**
 * Filesystem `ArtifactStore` (spec §15.2) for local tools, CLIs and development agents. It keeps only the current
 * envelope of each artifact: there is no history, so saving versions is the harness's job.
 *
 * Layout, per workspace (directory name = sha256 of the workspace id) and artifact:
 *
 * ```
 * <dir>/workspaces/<sha256(workspaceId)>/artifacts/<artifactId>/
 *   head.json   current envelope; replacing it is the commit point
 *   lock.json   advisory edit lock with expiry
 * ```
 *
 * Every file is written atomically (temp file + fsync + rename). Writes to one artifact are serialized by an
 * in-process mutex, so concurrent commits in one process get `VERSION_CONFLICT` on a stale `baseVersion`. The store
 * assumes a single writing process per directory.
 */
export function createFsStore(options: FsStoreOptions): ArtifactStore {
  if (typeof options?.dir !== 'string' || options.dir.trim() === '') {
    throw new TypeError('createFsStore: `dir` must be a non-empty path.');
  }
  const root = resolve(options.dir);
  const now = options.now ?? (() => new Date());
  const locale = options.locale;
  const mutex = new KeyedMutex();

  const workspaceDir = (scope: Scope) => join(root, 'workspaces', hashName(scope.workspaceId), 'artifacts');
  const files = (scope: Scope, id: string) => {
    const base = join(workspaceDir(scope), id);
    return { base, head: join(base, 'head.json'), lock: join(base, 'lock.json') };
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
    async get(scope, id) {
      return (await readHead(scope, id)) ?? null;
    },

    async create(scope, input: NewArtifact) {
      const at = now();
      let id = createArtifactId(at.getTime());
      // The artifact directory is created exclusively; a (practically impossible) id collision retries.
      for (;;) {
        await mkdir(workspaceDir(scope), { recursive: true });
        try {
          await mkdir(files(scope, id).base);
          break;
        } catch (error) {
          if (!isErrno(error, 'EEXIST')) throw error;
          id = createArtifactId(at.getTime());
        }
      }
      const artifact: Artifact = {
        id,
        format: input.format,
        formatVersion: input.formatVersion,
        version: 1,
        title: input.title,
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
      await mutex.run(lockKey(scope, id), () => writeJsonAtomic(files(scope, id).head, artifact));
      return artifact;
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
        const next: Artifact = {
          ...current,
          formatVersion: change.formatVersion,
          version: current.version + 1,
          title: change.title,
          locale: change.locale,
          themeId: change.themeId,
          content: structuredClone(change.content),
          meta: { ...current.meta, updatedAt: now().toISOString(), updatedBy: scope.actor },
        };
        // A single rename of head.json is the commit point: an interrupted write leaves the previous head in place.
        await writeJsonAtomic(files(scope, id).head, next);
        return next;
      });
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
        if (filter.format && artifact.format !== filter.format) continue;
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
  };
  return store;
}
