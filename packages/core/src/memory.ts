import {
  type AssetPolicy,
  type AssetRef,
  assetIdFromRef,
  checkAsset,
  defaultAssetPolicy,
  sha256Hex,
  toDataUrl,
} from './assets.js';
import { type Artifact, type ArtifactSummary, summarize } from './envelope.js';
import { ArtifactError } from './errors.js';
import { t } from './i18n.js';
import { createArtifactId } from './ids.js';
import type {
  ArtifactFilter,
  ArtifactStore,
  AssetStore,
  Commit,
  Lock,
  NewArtifact,
  Page,
  PageRequest,
  Scope,
} from './store.js';

export interface MemoryStoreOptions {
  now?: () => Date;
  locale?: string;
}

interface Record_ {
  workspaceId: string;
  artifact: Artifact;
  lock?: Lock;
}

const DEFAULT_PAGE = 50;

/** Reference in-memory store: tests, playground and prototypes (spec §15.2). Runs in any runtime. */
export function createMemoryStore(options: MemoryStoreOptions = {}): ArtifactStore {
  const now = options.now ?? (() => new Date());
  const records = new Map<string, Record_>();

  const notFound = (id: string): never => {
    throw new ArtifactError('NOT_FOUND', t(options.locale, 'NOT_FOUND', { what: 'Artifact', id }));
  };

  function record(scope: Scope, id: string): Record_ {
    const found = records.get(id);
    // Scope isolation: an id from another workspace behaves exactly like a missing one.
    if (!found || found.workspaceId !== scope.workspaceId) return notFound(id);
    return found;
  }

  function activeLock(rec: Record_): Lock | null {
    if (!rec.lock) return null;
    if (Date.parse(rec.lock.expiresAt) <= now().getTime()) {
      delete rec.lock;
      return null;
    }
    return rec.lock;
  }

  function paginate<T>(items: T[], page: PageRequest): Page<T> {
    const start = page.cursor ? Number(page.cursor) || 0 : 0;
    const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_PAGE), 500);
    const slice = items.slice(start, start + limit);
    return start + limit < items.length
      ? { items: slice, nextCursor: String(start + limit) }
      : { items: slice };
  }

  const clone = <T>(value: T): T => structuredClone(value);

  return {
    async get(scope, id) {
      const rec = records.get(id);
      if (!rec || rec.workspaceId !== scope.workspaceId) return null;
      return clone(rec.artifact);
    },

    async create(scope, input: NewArtifact) {
      const at = now();
      const id = createArtifactId(at.getTime());
      const artifact: Artifact = {
        id,
        format: input.format,
        formatVersion: input.formatVersion,
        version: 1,
        title: input.title,
        locale: input.locale,
        themeId: input.themeId,
        content: clone(input.content),
        meta: {
          createdAt: at.toISOString(),
          updatedAt: at.toISOString(),
          createdBy: scope.actor,
          updatedBy: scope.actor,
          tags: input.tags ?? [],
        },
      };
      records.set(id, { workspaceId: scope.workspaceId, artifact });
      return clone(artifact);
    },

    async commit(scope, id, change: Commit) {
      const rec = record(scope, id);
      const current = rec.artifact;
      if (change.baseVersion !== current.version) {
        throw new ArtifactError(
          'VERSION_CONFLICT',
          t(options.locale, 'VERSION_CONFLICT', {
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
        content: clone(change.content),
        meta: { ...current.meta, updatedAt: now().toISOString(), updatedBy: scope.actor },
      };
      rec.artifact = next;
      return clone(next);
    },

    async list(scope, filter: ArtifactFilter, page) {
      const items: ArtifactSummary[] = [];
      for (const rec of records.values()) {
        if (rec.workspaceId !== scope.workspaceId) continue;
        const artifact = rec.artifact;
        if (filter.format && artifact.format !== filter.format) continue;
        if (filter.title && !artifact.title.toLowerCase().includes(filter.title.toLowerCase())) continue;
        if (filter.tag && !artifact.meta.tags.includes(filter.tag)) continue;
        items.push(summarize(artifact));
      }
      items.sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : -1,
      );
      return paginate(items, page);
    },

    async lock(scope, id, actor, ttlMs) {
      const rec = record(scope, id);
      const existing = activeLock(rec);
      if (existing && (existing.holder.id !== actor.id || existing.holder.type !== actor.type)) {
        throw new ArtifactError(
          'LOCKED',
          t(options.locale, 'LOCKED', {
            holder: `${existing.holder.type}:${existing.holder.id}`,
            expiresAt: existing.expiresAt,
          }),
          { details: { expiresAt: existing.expiresAt } },
        );
      }
      const token = createArtifactId(now().getTime()).slice(4);
      rec.lock = {
        artifactId: id,
        holder: actor,
        token,
        expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
      };
      return clone(rec.lock);
    },

    async unlock(scope, lock) {
      const rec = record(scope, lock.artifactId);
      if (rec.lock?.token === lock.token) delete rec.lock;
    },

    async getLock(scope, id) {
      const rec = record(scope, id);
      const lock = activeLock(rec);
      return lock ? clone(lock) : null;
    },
  };
}

export interface MemoryAssetStoreOptions {
  policy?: Partial<AssetPolicy>;
  locale?: string;
}

/** In-memory asset store with the same validation as production stores (MIME sniffing, size, SVG sanitizing). */
export function createMemoryAssetStore(options: MemoryAssetStoreOptions = {}): AssetStore {
  const policy: AssetPolicy = { ...defaultAssetPolicy, ...options.policy };
  const assets = new Map<string, { workspaceId: string; bytes: Uint8Array; mimeType: string }>();
  return {
    async put(scope, bytes, meta) {
      const checked = checkAsset(bytes, meta, policy, options.locale);
      const hash = await sha256Hex(checked.bytes);
      const id = `${hash.slice(0, 24)}`;
      const ref: AssetRef = `asset://${id}`;
      assets.set(`${scope.workspaceId}/${id}`, {
        workspaceId: scope.workspaceId,
        bytes: checked.bytes,
        mimeType: checked.mimeType,
      });
      return {
        ref,
        mimeType: checked.mimeType,
        size: checked.bytes.byteLength,
        hash,
        ...(meta.filename ? { filename: meta.filename } : {}),
      };
    },
    async get(scope, ref) {
      const found = assets.get(`${scope.workspaceId}/${assetIdFromRef(ref)}`);
      if (!found)
        throw new ArtifactError('NOT_FOUND', t(options.locale, 'NOT_FOUND', { what: 'Asset', id: ref }));
      return { bytes: found.bytes, mimeType: found.mimeType };
    },
    async url(scope, ref) {
      const found = await this.get(scope, ref);
      return toDataUrl(found.bytes, found.mimeType);
    },
  };
}
