import type { AssetMeta, AssetRef, StoredAssetInfo } from './assets.js';
import type { Actor, Artifact, ArtifactStatus, ArtifactSummary } from './envelope.js';
import type { ChangeSummary } from './kind.js';

/** Workspace and actor. Every store implementation filters by scope; ids alone never grant access. */
export interface Scope {
  workspaceId: string;
  actor: Actor;
}

export type StoredArtifact = Artifact;

export interface NewArtifact {
  kind: string;
  schemaVersion: number;
  title: string;
  status: ArtifactStatus;
  locale: string;
  themeId: string;
  content: unknown;
  tags?: string[];
  message?: string;
  idempotencyKey?: string;
  createdIds?: string[];
}

export interface Commit {
  /** Version the change was computed against. The store rejects with VERSION_CONFLICT when it is stale. */
  baseVersion: number;
  schemaVersion: number;
  content: unknown;
  title: string;
  locale: string;
  themeId: string;
  status?: ArtifactStatus;
  operations: unknown[];
  diff: ChangeSummary[];
  createdIds?: string[];
  message?: string;
  idempotencyKey?: string;
  /** Set when the commit restores an older version (spec §8.5). */
  restoredFrom?: number;
}

export interface VersionEntry {
  version: number;
  actor: Actor;
  createdAt: string;
  operations: unknown[];
  diff: ChangeSummary[];
  createdIds: string[];
  status: ArtifactStatus;
  message?: string;
  idempotencyKey?: string;
  restoredFrom?: number;
  /** Lifecycle changes made while this was the current version, oldest first (approval trail). */
  statusLog?: StatusChange[];
  /** Content snapshot, present at least on the first version and periodically after (spec §8.5). */
  snapshot?: { schemaVersion: number; content: unknown };
}

export interface StatusChange {
  status: ArtifactStatus;
  actor: Actor;
  at: string;
  /** Submit message, approval note or rejection reason. */
  message?: string;
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
  kind?: string;
  status?: ArtifactStatus;
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
 * Persistence contract (spec §15.1). Implementations must pass the shared contract suite
 * exported from `@artkit-ai/core/testing`.
 */
export interface ArtifactStore {
  get(scope: Scope, id: string, opts?: { version?: number }): Promise<StoredArtifact | null>;
  create(scope: Scope, input: NewArtifact): Promise<StoredArtifact>;
  /** Throws `ArtifactError('VERSION_CONFLICT')` when `change.baseVersion` is not the current version. */
  commit(scope: Scope, id: string, change: Commit): Promise<StoredArtifact>;
  history(scope: Scope, id: string, page: PageRequest): Promise<Page<VersionEntry>>;
  list(scope: Scope, filter: ArtifactFilter, page: PageRequest): Promise<Page<ArtifactSummary>>;
  /** Changes status without creating a version; sets `meta.publishedVersion` when publishing. */
  setStatus(
    scope: Scope,
    id: string,
    status: ArtifactStatus,
    actor: Actor,
    message?: string,
  ): Promise<StoredArtifact>;
  /** Throws `ArtifactError('LOCKED')` when another actor holds a valid lock. */
  lock(scope: Scope, id: string, actor: Actor, ttlMs: number): Promise<Lock>;
  unlock(scope: Scope, lock: Lock): Promise<void>;
  getLock(scope: Scope, id: string): Promise<Lock | null>;
  findByIdempotencyKey(scope: Scope, id: string, key: string): Promise<VersionEntry | null>;
  /**
   * Finds an artifact created with this idempotency key by the same actor in the scope's workspace, so a repeated
   * `create` tool call returns the first artifact instead of a duplicate. Optional for compatibility;
   * without it, creation is not deduplicated across processes.
   */
  findCreatedByIdempotencyKey?(scope: Scope, key: string): Promise<StoredArtifact | null>;
}

export interface AssetStore {
  put(scope: Scope, bytes: Uint8Array, meta: AssetMeta): Promise<StoredAssetInfo>;
  get(scope: Scope, ref: AssetRef): Promise<{ bytes: Uint8Array; mimeType: string }>;
  url(scope: Scope, ref: AssetRef, ttlSeconds: number): Promise<string>;
}
