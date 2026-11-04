import type { Artifact } from '@artkit/core';
import type { ArtifactClient } from './client.js';

export interface CacheEntry {
  artifact?: Artifact;
  error?: unknown;
  loading: boolean;
}

const EMPTY: CacheEntry = Object.freeze({ loading: false }) as CacheEntry;

const keyOf = (id: string, version?: number) => `${id}@${version ?? 'latest'}`;

/**
 * Artifact cache shared by the hooks under one provider (spec §13.2). Versions are immutable, so an
 * entry for a specific version never needs revalidation; the `latest` entry only moves forward and is
 * revalidated on demand. Listeners are per artifact id so history and editors hear about new commits.
 */
export class ArtifactCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Artifact>>();
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly client: ArtifactClient) {}

  entry(id: string, version?: number): CacheEntry {
    return this.entries.get(keyOf(id, version)) ?? EMPTY;
  }

  latest(id: string): Artifact | undefined {
    return this.entries.get(keyOf(id))?.artifact;
  }

  subscribe(id: string, listener: () => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  private notify(id: string): void {
    for (const listener of [...(this.listeners.get(id) ?? [])]) listener();
  }

  private set(id: string, version: number | undefined, entry: CacheEntry): void {
    this.entries.set(keyOf(id, version), entry);
  }

  /**
   * Records a known artifact version (commit result, prop, status change). `latest` only moves forward,
   * except that a status change on the same version replaces it.
   */
  put(artifact: Artifact): void {
    const current = this.latest(artifact.id);
    const sameVersionChanged =
      current !== undefined &&
      artifact.version === current.version &&
      (artifact.status !== current.status ||
        artifact.meta.updatedAt !== current.meta.updatedAt ||
        artifact.meta.publishedVersion !== current.meta.publishedVersion);
    const known = this.entries.get(keyOf(artifact.id, artifact.version))?.artifact;
    if (current && !sameVersionChanged && artifact.version <= current.version && known) return;
    this.set(artifact.id, artifact.version, { artifact, loading: false });
    if (!current || artifact.version > current.version || sameVersionChanged) {
      this.set(artifact.id, undefined, { artifact, loading: false });
    }
    this.notify(artifact.id);
  }

  /** Loads unless a fresh value is cached. `force` revalidates `latest` (specific versions never change). */
  load(id: string, version?: number, force = false): Promise<Artifact> {
    const key = keyOf(id, version);
    const existing = this.entries.get(key);
    if (existing?.artifact && (version !== undefined || !force)) return Promise.resolve(existing.artifact);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    this.set(id, version, { ...(existing ?? {}), loading: true });
    this.notify(id);
    const promise = this.client.get(id, version === undefined ? undefined : { version }).then(
      (artifact) => {
        this.inflight.delete(key);
        if (version === undefined) {
          // A commit may have landed while the request was in flight; never move `latest` backwards.
          const current = this.latest(id);
          if (current && current.version > artifact.version) {
            this.set(id, undefined, { artifact: current, loading: false });
            this.notify(id);
            return current;
          }
        }
        this.set(artifact.id, artifact.version, { artifact, loading: false });
        if (version === undefined) this.set(id, undefined, { artifact, loading: false });
        else if (!this.latest(id) || this.latest(id)!.version < artifact.version)
          this.set(id, undefined, { artifact, loading: false });
        this.notify(id);
        return artifact;
      },
      (error: unknown) => {
        this.inflight.delete(key);
        const previous = this.entries.get(key);
        this.set(id, version, {
          ...(previous?.artifact ? { artifact: previous.artifact } : {}),
          error,
          loading: false,
        });
        this.notify(id);
        throw error;
      },
    );
    this.inflight.set(key, promise);
    return promise;
  }

  /** Signals listeners of an id without changing entries (e.g. history must refetch after a restore). */
  touch(id: string): void {
    this.notify(id);
  }
}

const caches = new WeakMap<ArtifactClient, ArtifactCache>();

export function cacheFor(client: ArtifactClient): ArtifactCache {
  let cache = caches.get(client);
  if (!cache) {
    cache = new ArtifactCache(client);
    caches.set(client, cache);
  }
  return cache;
}
