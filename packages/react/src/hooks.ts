import {
  type AnyArtifactExporter,
  type Artifact,
  ArtifactError,
  type CommitResult,
  isArtifactError,
  silentLogger,
  slugify,
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

export interface UseArtifactOptions {
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
  const { initial, revalidate = true } = options;
  const subscribe = useCallback(
    (listener: () => void) => (id ? cache.subscribe(id, listener) : noop),
    [cache, id],
  );
  const read = () => (id ? cache.entry(id) : NO_ENTRY);
  const entry = useSyncExternalStore(id ? subscribe : noSubscription, read, read);

  useEffect(() => {
    if (initial && initial.id === id) cache.put(initial);
  }, [cache, id, initial]);

  useEffect(() => {
    if (!id) return;
    cache.load(id, revalidate).catch(noop);
  }, [cache, id, revalidate]);

  const usableInitial = initial && initial.id === id ? initial : undefined;
  const artifact =
    entry.artifact && (!usableInitial || entry.artifact.version >= usableInitial.version)
      ? entry.artifact
      : (usableInitial ?? entry.artifact);
  const refresh = useCallback(async () => {
    if (!id) return undefined;
    return cache.load(id, true);
  }, [cache, id]);

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

export interface ApplyConflict {
  operations: unknown[];
  baseVersion: number;
  currentVersion?: number;
}

export interface ApplyOptions {
  /** Defaults to the latest cached version (loaded when unknown). */
  baseVersion?: number;
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
        const result = await client.apply(id, { baseVersion, operations });
        cache.put(result.artifact);
        conflictRef.current = undefined;
        setState({ pending: false });
        return result;
      } catch (caught) {
        const error = toArtifactError(caught);
        let conflict: ApplyConflict | undefined;
        if (error.code === 'VERSION_CONFLICT') {
          const current = error.details.currentVersion;
          conflict = {
            operations,
            baseVersion: baseVersion ?? 0,
            ...(typeof current === 'number' ? { currentVersion: current } : {}),
          };
          cache.load(id, true).catch(noop);
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
    const latest = await cache.load(id, true);
    return apply(conflict.operations, { baseVersion: latest.version });
  }, [apply, cache, id]);

  const reset = useCallback(() => {
    conflictRef.current = undefined;
    setState({ pending: false });
  }, []);

  return { apply, pending: state.pending, error: state.error, conflict: state.conflict, retry, reset };
}

export interface ExportOptions {
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
export function useArtifactExport(id: string, format?: string): UseArtifactExportResult {
  const ctx = useArtkit();
  const { client, cache, registry } = ctx;
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ArtifactError | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<AnyArtifactExporter[]>([]);
  const knownFormat = format ?? cache.latest(id)?.format;

  const browserExporters = useCallback(
    async (artifactKind: string): Promise<AnyArtifactExporter[]> => {
      const fromRegistry = registry.exporters(artifactKind).filter((exporter) => exporter.runtime !== 'node');
      if (!ctx.hasExporters(artifactKind)) return fromRegistry;
      const lazy = (await ctx.loadExporters(artifactKind)).filter(
        (exporter) => exporter.format === artifactKind && exporter.runtime !== 'node',
      );
      return [...lazy, ...fromRegistry];
    },
    [ctx, registry],
  );

  const loadFormats = useCallback(async () => {
    if (!knownFormat) return;
    try {
      setLoaded(await browserExporters(knownFormat));
    } catch {
      // Without browser exporters the server formats still work.
    }
  }, [browserExporters, knownFormat]);

  const formats = useMemo(() => {
    if (!knownFormat) return [];
    const set = new Set<string>(ctx.exportFormats[knownFormat] ?? []);
    for (const exporter of registry.exporters(knownFormat))
      if (exporter.runtime !== 'node') set.add(exporter.target);
    for (const exporter of loaded) set.add(exporter.target);
    return [...set];
  }, [ctx.exportFormats, knownFormat, loaded, registry]);

  const exportArtifact = useCallback(
    async (format: string, options: ExportOptions = {}) => {
      setPending(format);
      setError(undefined);
      setWarnings([]);
      try {
        const artifact = cache.latest(id) ?? (await cache.load(id));
        let result: ClientExportResult | undefined;
        if (options.prefer !== 'server') {
          const exporter = (await browserExporters(artifact.format).catch(() => [])).find(
            (candidate) => candidate.target === format,
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
