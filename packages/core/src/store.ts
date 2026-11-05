import type { AssetMeta, AssetRef, StoredAssetInfo } from './assets.js';
import type { Actor, Artifact, ArtifactSummary } from './envelope.js';

/** Workspace and actor. Every store implementation filters by scope; ids alone never grant access. */
export interface Scope {
  workspaceId: string;
  actor: Actor;
}

export type StoredArtifact = Artifact;

export interface NewArtifact {
  format: string;
  formatVersion: string;
  title: string;
  locale: string;
  themeId: string;
  content: unknown;
  tags?: string[];
}

export interface Commit {
  /** Version the change was computed against. The store rejects with VERSION_CONFLICT when it is stale. */
  baseVersion: number;
  formatVersion: string;
  content: unknown;
  title: string;
  locale: string;
  themeId: string;
}

export interface PageRequest {
  limit?: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface ArtifactFilter {
  format?: string;
  /** Case-insensitive substring of the title. */
  title?: string;
  tag?: string;
}

export interface Lock {
  artifactId: string;
  holder: Actor;
  token: string;
  expiresAt: string;
}

/**
 * Persistence contract (spec §17.1). The store keeps the current content of each artifact and its version counter;
 * it does not keep earlier versions. Implementations must pass the shared contract suite from `@artkit-ai/core/testing`.
 */
export interface ArtifactStore {
  get(scope: Scope, id: string): Promise<StoredArtifact | null>;
  create(scope: Scope, input: NewArtifact): Promise<StoredArtifact>;
  /**
   * Replaces the content when `change.baseVersion` is the current version and increments the version. Throws
   * `ArtifactError('VERSION_CONFLICT')` otherwise.
   */
  commit(scope: Scope, id: string, change: Commit): Promise<StoredArtifact>;
  list(scope: Scope, filter: ArtifactFilter, page: PageRequest): Promise<Page<ArtifactSummary>>;
  /** Throws `ArtifactError('LOCKED')` when another actor holds a valid lock. */
  lock(scope: Scope, id: string, actor: Actor, ttlMs: number): Promise<Lock>;
  unlock(scope: Scope, lock: Lock): Promise<void>;
  getLock(scope: Scope, id: string): Promise<Lock | null>;
}

export interface AssetStore {
  put(scope: Scope, bytes: Uint8Array, meta: AssetMeta): Promise<StoredAssetInfo>;
  get(scope: Scope, ref: AssetRef): Promise<{ bytes: Uint8Array; mimeType: string }>;
  url(scope: Scope, ref: AssetRef, ttlSeconds: number): Promise<string>;
}
