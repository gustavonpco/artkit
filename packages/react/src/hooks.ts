import {
  type AnyArtifactExporter,
  type Artifact,
  ArtifactError,
  type ChangeSummary,
  type CommitResult,
  isArtifactError,
  silentLogger,
  slugify,
  type VersionEntry,
} from '@artkit-ai/core';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CacheEntry } from './cache.js';
import type { ClientExportResult } from './client.js';
import { useArtkit } from './context.js';
import { triggerDownload } from './download.js';

const NO_ENTRY: CacheEntry = Object.freeze({ loading: false }) as CacheEntry;
const noop = () => {};
const noSubscription = () => noop;

function toArtifactError(error: unknown): ArtifactError {
  if (isArtifactError(error)) return error;
  return new ArtifactError('INTERNAL_ERROR', 'Internal error while processing the request.', {
    cause: error,
  });
}

function newKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return (
    cryptoApi?.randomUUID?.() ?? `ak-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export interface UseArtifactOptions {
  /** A specific (immutable) version; omit for the latest. */
  version?: number;
  /** Already-known artifact (e.g. from a chat message), shown immediately and cached. */
  initial?: Artifact;
  /** Revalidate the latest version on mount (default true). */
  revalidate?: boolean;
}

export interface UseArtifactResult {
  artifact: Artifact | undefined;
  error: unknown;
  loading: boolean;
  /** Fetches the latest version again (specific versions never change). */
  refresh(): Promise<Artifact | undefined>;
}

/** Loads an artifact through the client with a shared cache (spec §13.2). Pass undefined to skip. */
export function useArtifact(id: string | undefined, options: UseArtifactOptions = {}): UseArtifactResult {
  const { cache } = useArtkit();
  const { version, initial, revalidate = true } = options;
  const subscribe = useCallback(
    (listener: () => void) => (id ? cache.subscribe(id, listener) : noop),
    [cache, id],
  );
  const read = () => (id ? cache.entry(id, version) : NO_ENTRY);
  const entry = useSyncExternalStore(id ? subscribe : noSubscription, read, read);

  useEffect(() => {
    if (initial && initial.id === id) cache.put(initial);
  }, [cache, id, initial]);

  useEffect(() => {
    if (!id) return;
    cache.load(id, version, version === undefined && revalidate).catch(noop);
  }, [cache, id, version, revalidate]);

  const usableInitial =
    initial && initial.id === id && (version === undefined || initial.version === version)
      ? initial
      : undefined;
  const artifact =
    entry.artifact && (!usableInitial || entry.artifact.version >= usableInitial.version)
      ? entry.artifact
      : (usableInitial ?? entry.artifact);
  const refresh = useCallback(async () => {
    if (!id) return undefined;
    return cache.load(id, version, true);
  }, [cache, id, version]);

  return {
    artifact,
    error: artifact ? undefined : entry.error,
    loading: !artifact && !entry.error && id !== undefined,
    refresh,
  };
}

/** Latest known version of an artifact in the cache, updated when commits arrive. */
export function useLatestVersion(id: string | undefined): number | undefined {
  const { cache } = useArtkit();
  const subscribe = useCallback(
    (listener: () => void) => (id ? cache.subscribe(id, listener) : noop),
    [cache, id],
  );
  const read = () => (id ? cache.latest(id)?.version : undefined);
  return useSyncExternalStore(subscribe, read, read);
}

export interface UseArtifactHistoryResult {
  entries: VersionEntry[];
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
  /** Creates a new version with the content of `version` (spec §8.5). */
  restore(version: number, message?: string): Promise<CommitResult>;
  restoring: number | undefined;
}

/** Version list with pagination and restore (spec §13.2). Refetches when a newer version is known. */
export function useArtifactHistory(
  id: string | undefined,
  options: { pageSize?: number } = {},
): UseArtifactHistoryResult {
  const { client, cache } = useArtkit();
  const pageSize = options.pageSize ?? 20;
  const latest = useLatestVersion(id);
  const [entries, setEntries] = useState<VersionEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<unknown>(undefined);
  const [restoring, setRestoring] = useState<number | undefined>(undefined);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    if (!id) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const page = await client.history(id, { limit: pageSize });
      if (ticket !== request.current) return;
      setEntries(page.items);
      setCursor(page.nextCursor);
      setError(undefined);
    } catch (caught) {
      if (ticket === request.current) setError(caught);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [client, id, pageSize]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `latest` is the revalidation trigger.
  useEffect(() => {
    void refresh();
  }, [refresh, latest]);

  const loadMore = useCallback(async () => {
    if (!id || !cursor) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const page = await client.history(id, { limit: pageSize, cursor });
      if (ticket !== request.current) return;
      setEntries((previous) => {
        const seen = new Set(previous.map((entry) => entry.version));
        return [...previous, ...page.items.filter((entry) => !seen.has(entry.version))];
      });
      setCursor(page.nextCursor);
    } catch (caught) {
      if (ticket === request.current) setError(caught);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [client, id, cursor, pageSize]);

  const restore = useCallback(
    async (version: number, message?: string) => {
      if (!id) throw new ArtifactError('NOT_FOUND', 'No artifact id.');
      setRestoring(version);
      try {
        const result = await client.restore(id, version, message);
        cache.put(result.artifact);
        return result;
      } finally {
        setRestoring(undefined);
      }
    },
    [client, cache, id],
  );

  return { entries, loading, error, hasMore: cursor !== undefined, loadMore, refresh, restore, restoring };
}

export interface ApplyConflict {
  operations: unknown[];
  baseVersion: number;
  currentVersion?: number;
  changes: ChangeSummary[];
}

export interface ApplyOptions {
  /** Defaults to the latest cached version (loaded when unknown). */
  baseVersion?: number;
  idempotencyKey?: string;
  message?: string;
}

export interface UseApplyOperationsResult {
  apply(operations: unknown[], options?: ApplyOptions): Promise<CommitResult>;
  pending: boolean;
  error: ArtifactError | undefined;
  /** Set on VERSION_CONFLICT: what changed since the base, and the operations that were refused. */
  conflict: ApplyConflict | undefined;
  /** Sends the refused operations again on the latest version. */
  retry(): Promise<CommitResult>;
  reset(): void;
}

/** Sends operations with `baseVersion` and surfaces conflicts (spec §13.2). */
export function useApplyOperations(id: string): UseApplyOperationsResult {
  const { client, cache } = useArtkit();
  const [state, setState] = useState<{ pending: boolean; error?: ArtifactError; conflict?: ApplyConflict }>({
    pending: false,
  });
  const conflictRef = useRef<ApplyConflict | undefined>(undefined);

  const apply = useCallback(
    async (operations: unknown[], options: ApplyOptions = {}) => {
      setState({ pending: true });
      let baseVersion = options.baseVersion;
      try {
        baseVersion ??= cache.latest(id)?.version ?? (await cache.load(id)).version;
        const result = await client.apply(id, {
          baseVersion,
          operations,
          idempotencyKey: options.idempotencyKey ?? newKey(),
          ...(options.message ? { message: options.message } : {}),
        });
        cache.put(result.artifact);
        conflictRef.current = undefined;
        setState({ pending: false });
        return result;
      } catch (caught) {
        const error = toArtifactError(caught);
        let conflict: ApplyConflict | undefined;
        if (error.code === 'VERSION_CONFLICT') {
          const changes = error.details.changesSinceBase;
          const current = error.details.currentVersion;
          conflict = {
            operations,
            baseVersion: baseVersion ?? 0,
            ...(typeof current === 'number' ? { currentVersion: current } : {}),
            changes: Array.isArray(changes) ? (changes as ChangeSummary[]) : [],
          };
          cache.load(id, undefined, true).catch(noop);
        }
        conflictRef.current = conflict;
        setState({ pending: false, error, ...(conflict ? { conflict } : {}) });
        throw error;
      }
    },
    [client, cache, id],
  );

  const retry = useCallback(async () => {
    const conflict = conflictRef.current;
    if (!conflict) throw new ArtifactError('NOT_FOUND', 'There is no conflicting batch to retry.');
    const latest = await cache.load(id, undefined, true);
    return apply(conflict.operations, { baseVersion: latest.version });
  }, [apply, cache, id]);

  const reset = useCallback(() => {
    conflictRef.current = undefined;
    setState({ pending: false });
  }, []);

  return { apply, pending: state.pending, error: state.error, conflict: state.conflict, retry, reset };
}

export interface ExportOptions {
  version?: number;
  /** Triggers a browser download (default true). */
  download?: boolean;
  options?: Record<string, unknown>;
  /** `auto` (default) exports in the browser when a browser-capable exporter is loaded. */
  prefer?: 'auto' | 'browser' | 'server';
  signal?: AbortSignal;
}

export interface UseArtifactExportResult {
  exportArtifact(format: string, options?: ExportOptions): Promise<ClientExportResult>;
  pending: string | undefined;
  error: ArtifactError | undefined;
  warnings: string[];
  /** Formats available for the artifact's kind (server formats plus browser exporters). */
  formats: string[];
  /** Loads the kind's browser exporters so `formats` includes them. */
  loadFormats(): Promise<void>;
}

/**
 * Exports in the browser when a loaded exporter with runtime `any`/`browser` handles the format, else
 * through the client (spec §13.2), and triggers a download.
 */
export function useArtifactExport(id: string, kind?: string): UseArtifactExportResult {
  const ctx = useArtkit();
  const { client, cache, registry } = ctx;
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ArtifactError | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<AnyArtifactExporter[]>([]);
  const knownKind = kind ?? cache.latest(id)?.kind;

  const browserExporters = useCallback(
    async (artifactKind: string): Promise<AnyArtifactExporter[]> => {
      const fromRegistry = registry.exporters(artifactKind).filter((exporter) => exporter.runtime !== 'node');
      if (!ctx.hasExporters(artifactKind)) return fromRegistry;
      const lazy = (await ctx.loadExporters(artifactKind)).filter(
        (exporter) => exporter.kind === artifactKind && exporter.runtime !== 'node',
      );
      return [...lazy, ...fromRegistry];
    },
    [ctx, registry],
  );

  const loadFormats = useCallback(async () => {
    if (!knownKind) return;
    try {
      setLoaded(await browserExporters(knownKind));
    } catch {
      // Without browser exporters the server formats still work.
    }
  }, [browserExporters, knownKind]);

  const formats = useMemo(() => {
    if (!knownKind) return [];
    const set = new Set<string>(ctx.exportFormats[knownKind] ?? []);
    for (const exporter of registry.exporters(knownKind))
      if (exporter.runtime !== 'node') set.add(exporter.format);
    for (const exporter of loaded) set.add(exporter.format);
    return [...set];
  }, [ctx.exportFormats, knownKind, loaded, registry]);

  const exportArtifact = useCallback(
    async (format: string, options: ExportOptions = {}) => {
      setPending(format);
      setError(undefined);
      setWarnings([]);
      try {
        const artifact =
          options.version === undefined
            ? (cache.latest(id) ?? (await cache.load(id)))
            : await cache.load(id, options.version);
        let result: ClientExportResult | undefined;
        if (options.prefer !== 'server') {
          const exporter = (await browserExporters(artifact.kind).catch(() => [])).find(
            (candidate) => candidate.format === format,
          );
          if (exporter) {
            const collected: string[] = [];
            let bytes: Uint8Array;
            try {
              bytes = await exporter.export(artifact.content, {
                title: artifact.title,
                theme: ctx.themeFor(artifact.themeId),
                locale: artifact.locale,
                assets: ctx.assets ?? {
                  resolve: (ref) =>
                    Promise.reject(
                      new ArtifactError('NOT_FOUND', `Asset not available in the browser: ${ref}.`),
                    ),
                },
                logger: silentLogger,
                warn: (message) => collected.push(message),
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.options ? { options: options.options } : {}),
              });
            } catch (cause) {
              throw isArtifactError(cause)
                ? cause
                : new ArtifactError('EXPORT_FAILED', `Failed to export to ${format}.`, { cause });
            }
            result = {
              bytes,
              mimeType: exporter.mimeType,
              filename: `${slugify(artifact.title)}.${exporter.extension}`,
              warnings: collected,
            };
          } else if (options.prefer === 'browser') {
            throw new ArtifactError('EXPORT_FAILED', `No browser exporter for format ${format}.`);
          }
        }
        result ??= await client.export(id, {
          format,
          ...(options.version === undefined ? {} : { version: options.version }),
          ...(options.options ? { options: options.options } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        setWarnings(result.warnings);
        if (options.download !== false) triggerDownload(result);
        return result;
      } catch (caught) {
        const failure = toArtifactError(caught);
        setError(failure);
        throw failure;
      } finally {
        setPending(undefined);
      }
    },
    [browserExporters, cache, client, ctx, id],
  );

  return { exportArtifact, pending, error, warnings, formats, loadFormats };
}
