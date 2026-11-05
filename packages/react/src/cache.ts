import type { Artifact } from '@artkit-ai/core';
import type { ArtifactClient } from './client.js';

export interface CacheEntry {
  artifact?: Artifact;
  error?: unknown;
  loading: boolean;
}

const EMPTY: CacheEntry = Object.freeze({ loading: false }) as CacheEntry;

/**
 * Artifact cache shared by the hooks under one provider (spec §13.2). One entry per artifact: the current content the
 * application last loaded or saved. The library keeps no older versions, so there is nothing else to cache.
 */
export class ArtifactCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Artifact>>();
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(private readonly client: ArtifactClient) {}

  entry(id: string): CacheEntry {
    return this.entries.get(id) ?? EMPTY;
  }

  latest(id: string): Artifact | undefined {
    return this.entries.get(id)?.artifact;
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

  /**
   * Records an artifact the application loaded or saved. An older version never replaces a newer one; a newer
   * `updatedAt` of the same version replaces it.
   */
  put(artifact: Artifact): void {
    const current = this.latest(artifact.id);
    if (current) {
      const older = artifact.version < current.version;
      const sameVersionOlder =
        artifact.version === current.version && artifact.meta.updatedAt <= current.meta.updatedAt;
      if (older || sameVersionOlder) return;
    }
    this.entries.set(artifact.id, { artifact, loading: false });
    this.notify(artifact.id);
  }

  /** Loads the artifact unless it is cached. `force` fetches it again. */
  load(id: string, force = false): Promise<Artifact> {
    const existing = this.entries.get(id);
    if (existing?.artifact && !force) return Promise.resolve(existing.artifact);
    const pending = this.inflight.get(id);
    if (pending) return pending;
    this.entries.set(id, { ...(existing ?? {}), loading: true });
    this.notify(id);
    const promise = this.client.get(id).then(
      (artifact) => {
        this.inflight.delete(id);
        // A save may have landed while the request was in flight; never move the cache backwards.
        const current = this.latest(id);
        if (current && current.version > artifact.version) {
          this.entries.set(id, { artifact: current, loading: false });
          this.notify(id);
          return current;
        }
        this.entries.set(id, { artifact, loading: false });
        this.notify(id);
        return artifact;
      },
      (error: unknown) => {
        this.inflight.delete(id);
        const previous = this.entries.get(id);
        this.entries.set(id, {
          ...(previous?.artifact ? { artifact: previous.artifact } : {}),
          error,
          loading: false,
        });
        this.notify(id);
        throw error;
      },
    );
    this.inflight.set(id, promise);
    return promise;
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
