import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ArtifactError,
  ASSET_REF_PATTERN,
  type AssetPolicy,
  type AssetRef,
  type AssetStore,
  assetIdFromRef,
  checkAsset,
  defaultAssetPolicy,
  type Scope,
  type StoredAssetInfo,
  sha256Hex,
  t,
  toDataUrl,
} from '@artkit-ai/core';
import { createFileAtomic, hashName, isErrno, readJson } from './fs-utils.js';

export interface PublicUrlContext {
  scope: Scope;
  /** Validity requested by the caller, for signed URLs. */
  ttlSeconds: number;
  mimeType: string;
}

export interface FsAssetStoreOptions {
  /** Root directory. Created on first write. */
  dir: string;
  /** Overrides of the core default policy (MIME allowlist, max bytes, allowed external domains). */
  policy?: Partial<AssetPolicy>;
  /**
   * Builds the URL returned by `url()`, e.g. a route of your app that streams `get()` after checking
   * access. When omitted, `url()` returns a data URL.
   */
  publicUrl?(ref: AssetRef, context: PublicUrlContext): string | Promise<string>;
  locale?: string;
}

interface AssetMetaFile {
  hash: string;
  mimeType: string;
  size: number;
  filename?: string;
}

// Same id length as the memory store: 96 bits of the sha256 keep refs short for the model.
const ID_LENGTH = 24;
const ID_PATTERN = /^[0-9a-f]{24}$/;

/**
 * Content-addressed asset store on the filesystem (spec §6.5). Bytes are validated with the core
 * `checkAsset` (magic-byte MIME sniffing, size, allowlist, SVG sanitizing, allowed domains), stored
 * once per workspace under their sha256, and never overwritten.
 *
 * Layout: `<dir>/workspaces/<sha256(workspaceId)>/<id[0..2]>/<id>.bin` plus `<id>.json` metadata.
 */
export function createFsAssetStore(options: FsAssetStoreOptions): AssetStore {
  if (typeof options?.dir !== 'string' || options.dir.trim() === '') {
    throw new TypeError('createFsAssetStore: `dir` must be a non-empty path.');
  }
  const root = resolve(options.dir);
  const policy: AssetPolicy = { ...defaultAssetPolicy, ...options.policy };
  const locale = options.locale;

  const paths = (scope: Scope, id: string) => {
    const base = join(root, 'workspaces', hashName(scope.workspaceId), id.slice(0, 2));
    return { bytes: join(base, `${id}.bin`), meta: join(base, `${id}.json`) };
  };

  const notFound = (ref: unknown): never => {
    throw new ArtifactError('NOT_FOUND', t(locale, 'NOT_FOUND', { what: 'Asset', id: String(ref) }));
  };

  // Refs are validated before building paths, which rules out traversal through crafted ids.
  function idOf(ref: AssetRef): string {
    if (typeof ref !== 'string' || !ASSET_REF_PATTERN.test(ref)) return notFound(ref);
    const id = assetIdFromRef(ref);
    return ID_PATTERN.test(id) ? id : notFound(ref);
  }

  async function readMeta(scope: Scope, ref: AssetRef): Promise<{ id: string; meta: AssetMetaFile }> {
    const id = idOf(ref);
    const meta = await readJson<AssetMetaFile>(paths(scope, id).meta);
    return meta ? { id, meta } : notFound(ref);
  }

  const store: AssetStore = {
    async put(scope, bytes, meta) {
      const checked = checkAsset(bytes, meta, policy, locale);
      const hash = await sha256Hex(checked.bytes);
      const id = hash.slice(0, ID_LENGTH);
      const target = paths(scope, id);
      const existing = await readJson<AssetMetaFile>(target.meta);
      if (existing && existing.hash !== hash) {
        // A 96-bit prefix collision: refuse instead of serving the wrong bytes under the same ref.
        throw new ArtifactError('INTERNAL_ERROR', t(locale, 'INTERNAL_ERROR'), {
          cause: new Error(`asset id collision for ${id}`),
        });
      }
      if (!existing) {
        // Bytes first, metadata last: the metadata file marks the asset as complete.
        await createFileAtomic(target.bytes, checked.bytes);
        const metaFile: AssetMetaFile = {
          hash,
          mimeType: checked.mimeType,
          size: checked.bytes.byteLength,
          ...(meta.filename ? { filename: meta.filename } : {}),
        };
        await createFileAtomic(target.meta, JSON.stringify(metaFile));
      }
      const info: StoredAssetInfo = {
        ref: `asset://${id}`,
        mimeType: checked.mimeType,
        size: checked.bytes.byteLength,
        hash,
        ...(meta.filename ? { filename: meta.filename } : {}),
      };
      return info;
    },

    async get(scope, ref) {
      const { id, meta } = await readMeta(scope, ref);
      try {
        const buffer = await readFile(paths(scope, id).bytes);
        return {
          bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          mimeType: meta.mimeType,
        };
      } catch (error) {
        if (isErrno(error, 'ENOENT')) return notFound(ref);
        throw error;
      }
    },

    async url(scope, ref, ttlSeconds) {
      if (options.publicUrl) {
        const { meta } = await readMeta(scope, ref);
        return options.publicUrl(ref, { scope, ttlSeconds, mimeType: meta.mimeType });
      }
      const found = await store.get(scope, ref);
      return toDataUrl(found.bytes, found.mimeType);
    },
  };
  return store;
}
