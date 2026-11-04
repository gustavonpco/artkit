import {
  type Artifact,
  ArtifactError,
  type ArtifactFilter,
  type ArtifactService,
  type ArtifactSummary,
  type BatchResult,
  type CommitResult,
  type CreateRequest,
  ERROR_CODES,
  type ErrorCode,
  type ErrorIssue,
  isArtifactError,
  type Lock,
  type Page,
  type PageRequest,
  type ProjectionMode,
  type ReadResult,
  type Scope,
  type VersionEntry,
} from '@artkit-ai/core';

/** Lifecycle actions accepted by `POST {base}/{id}/status` (spec §15.3). */
export type StatusAction = 'submit' | 'approve' | 'reject' | 'publish' | 'archive';

export const STATUS_ACTIONS: readonly StatusAction[] = ['submit', 'approve', 'reject', 'publish', 'archive'];

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ReadOptions extends RequestOptions {
  mode?: ProjectionMode;
  range?: string;
  maxTokens?: number;
  cursor?: string;
  version?: number;
}

export interface ApplyInput {
  baseVersion: number;
  operations: unknown[];
  idempotencyKey?: string;
  message?: string;
}

export interface ExportInput extends RequestOptions {
  format: string;
  version?: number;
  options?: Record<string, unknown>;
}

export interface ClientExportResult {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  warnings: string[];
}

/**
 * What the React layer talks to (spec §13.3). It never touches a store: credentials and authorization
 * stay on the server (HTTP client) or in the scope given to an in-process service (service client).
 */
export interface ArtifactClient {
  list(filter?: ArtifactFilter, page?: PageRequest, options?: RequestOptions): Promise<Page<ArtifactSummary>>;
  create(request: CreateRequest, options?: RequestOptions): Promise<CommitResult>;
  get(id: string, options?: RequestOptions & { version?: number }): Promise<Artifact>;
  read(id: string, options?: ReadOptions): Promise<ReadResult>;
  apply(id: string, input: ApplyInput, options?: RequestOptions): Promise<CommitResult>;
  /** Dry run on the current version: diff and lint without committing. */
  preview(id: string, input: ApplyInput, options?: RequestOptions): Promise<BatchResult>;
  history(id: string, page?: PageRequest, options?: RequestOptions): Promise<Page<VersionEntry>>;
  restore(id: string, version: number, message?: string, options?: RequestOptions): Promise<CommitResult>;
  setStatus(id: string, action: StatusAction, message?: string, options?: RequestOptions): Promise<Artifact>;
  lock(id: string, options?: RequestOptions & { ttlMs?: number }): Promise<Lock>;
  unlock(id: string, lock: Lock, options?: RequestOptions): Promise<void>;
  /** Current lock, or null when nobody holds one. */
  getLock(id: string, options?: RequestOptions): Promise<Lock | null>;
  export(id: string, input: ExportInput): Promise<ClientExportResult>;
}

// ---------------------------------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------------------------------

type HeadersSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

export interface HttpClientOptions {
  /** Base path of the `@artkit-ai/node` routes (default `/api/artifacts`). */
  baseUrl?: string;
  /** Custom fetch (auth wrappers, tests, SSR). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra headers, or a function returning them per request (e.g. a fresh bearer token). */
  headers?: HeadersSource;
  credentials?: RequestCredentials;
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  404: 'NOT_FOUND',
  403: 'PERMISSION_DENIED',
  409: 'VERSION_CONFLICT',
  423: 'LOCKED',
  413: 'LIMIT_EXCEEDED',
  422: 'INVALID_CONTENT',
};

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function toIssues(value: unknown): ErrorIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const issues: ErrorIssue[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const { path, message, hint } = item as Record<string, unknown>;
    if (typeof message !== 'string') continue;
    issues.push({
      path: typeof path === 'string' ? path : '',
      message,
      ...(typeof hint === 'string' ? { hint } : {}),
    });
  }
  return issues;
}

/** Rebuilds an `ArtifactError` from an HTTP error response (`ModelErrorPayload` body, spec CONVENTIONS). */
export async function errorFromResponse(response: Response): Promise<ArtifactError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const error = (body as { error?: Record<string, unknown> } | undefined)?.error;
  const fallbackCode: ErrorCode = STATUS_TO_CODE[response.status] ?? 'INTERNAL_ERROR';
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    const issues = toIssues(error.issues);
    const details =
      error.details && typeof error.details === 'object' && !Array.isArray(error.details)
        ? (error.details as Record<string, unknown>)
        : undefined;
    return new ArtifactError(isErrorCode(error.code) ? error.code : fallbackCode, error.message, {
      ...(issues ? { issues } : {}),
      details: { ...details, status: response.status },
    });
  }
  return new ArtifactError(fallbackCode, `Request failed with status ${response.status}.`, {
    details: { status: response.status },
  });
}

/** Parses `Content-Disposition`, preferring the RFC 5987 `filename*` form. */
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
  if (extended?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(extended[1].trim().replace(/^"|"$/g, '')));
    } catch {
      // Fall through to the plain form when the encoded name is malformed.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  const value = plain?.[2] ?? plain?.[1];
  return value ? sanitizeFilename(value.trim()) : undefined;
}

// The name ends up in a download attribute: strip any path a hostile server could smuggle in.
function sanitizeFilename(name: string): string | undefined {
  const base = name.split(/[\\/]/).pop()?.trim();
  return base ? base : undefined;
}

function parseWarnings(header: string | null): string[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** Reference client for the `@artkit-ai/node` routes (HTTP contract in docs/CONVENTIONS.md). */
export function createHttpClient(options: HttpClientOptions = {}): ArtifactClient {
  const base = (options.baseUrl ?? '/api/artifacts').replace(/\/+$/, '');
  const doFetch =
    options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  const path = (id?: string, suffix?: string) =>
    `${base}${id === undefined ? '' : `/${encodeURIComponent(id)}`}${suffix ? `/${suffix}` : ''}`;

  function withQuery(url: string, query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== '') params.set(key, String(value));
    const text = params.toString();
    return text ? `${url}?${text}` : url;
  }

  async function send(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const headers = new Headers(
      typeof options.headers === 'function' ? await options.headers() : options.headers,
    );
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
        ...(options.credentials ? { credentials: options.credentials } : {}),
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new ArtifactError('INTERNAL_ERROR', 'Network request failed.', {
        cause,
        details: { network: true },
      });
    }
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  }

  async function json<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await send(method, url, body, signal);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new ArtifactError('INTERNAL_ERROR', 'Invalid JSON response.', {
        cause,
        details: { status: response.status },
      });
    }
  }

  return {
    list: (filter = {}, page = {}, opts) =>
      json(
        'GET',
        withQuery(path(), { ...filter, limit: page.limit, cursor: page.cursor }),
        undefined,
        opts?.signal,
      ),
    create: (request, opts) => json('POST', path(), request, opts?.signal),
    get: (id, opts) => json('GET', withQuery(path(id), { version: opts?.version }), undefined, opts?.signal),
    read: (id, opts = {}) =>
      json(
        'GET',
        withQuery(path(id, 'read'), {
          mode: opts.mode,
          range: opts.range,
          maxTokens: opts.maxTokens,
          cursor: opts.cursor,
          version: opts.version,
        }),
        undefined,
        opts.signal,
      ),
    apply: (id, input, opts) => json('POST', path(id, 'apply'), input, opts?.signal),
    preview: (id, input, opts) => json('POST', path(id, 'preview'), input, opts?.signal),
    history: (id, page = {}, opts) =>
      json(
        'GET',
        withQuery(path(id, 'history'), { limit: page.limit, cursor: page.cursor }),
        undefined,
        opts?.signal,
      ),
    restore: (id, version, message, opts) =>
      json('POST', path(id, 'restore'), { version, ...(message ? { message } : {}) }, opts?.signal),
    setStatus: (id, action, message, opts) =>
      json('POST', path(id, 'status'), { action, ...(message ? { message } : {}) }, opts?.signal),
    lock: (id, opts) =>
      json('POST', path(id, 'lock'), opts?.ttlMs === undefined ? {} : { ttlMs: opts.ttlMs }, opts?.signal),
    async unlock(id, lock, opts) {
      await send('DELETE', path(id, 'lock'), lock, opts?.signal);
    },
    getLock: (id, opts) => json('GET', path(id, 'lock'), undefined, opts?.signal),
    async export(id, input) {
      const response = await send(
        'POST',
        path(id, 'export'),
        {
          format: input.format,
          ...(input.version === undefined ? {} : { version: input.version }),
          ...(input.options ? { options: input.options } : {}),
        },
        input.signal,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mimeType =
        response.headers.get('Content-Type')?.split(';')[0]?.trim() || 'application/octet-stream';
      return {
        bytes,
        mimeType,
        filename:
          filenameFromDisposition(response.headers.get('Content-Disposition')) ?? `${id}.${input.format}`,
        warnings: parseWarnings(response.headers.get('X-Artkit-Warnings')),
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// In-process client
// ---------------------------------------------------------------------------------------------------

function normalizeError(error: unknown): unknown {
  if (isArtifactError(error) || isAbortError(error)) return error;
  return new ArtifactError('INTERNAL_ERROR', 'Internal error while processing the request.', {
    cause: error,
  });
}

/**
 * Wraps a core `ArtifactService` in-process (playground, tests, local apps). The scope is fixed by the
 * application, never by the UI; pass a function to resolve it per call (e.g. after a login change).
 */
export function createServiceClient(service: ArtifactService, scope: Scope | (() => Scope)): ArtifactClient {
  const current = () => (typeof scope === 'function' ? scope() : scope);
  const run = async <T>(fn: (s: Scope) => Promise<T>): Promise<T> => {
    try {
      return await fn(current());
    } catch (error) {
      throw normalizeError(error);
    }
  };

  return {
    list: (filter, page) => run((s) => service.list(s, filter, page)),
    create: (request) => run((s) => service.create(s, request)),
    get: (id, opts) =>
      run((s) => service.get(s, id, opts?.version === undefined ? undefined : { version: opts.version })),
    read: (id, opts = {}) =>
      run((s) => {
        const { signal: _signal, ...rest } = opts;
        return service.read(s, id, rest);
      }),
    apply: (id, input) => run((s) => service.apply(s, { artifactId: id, ...input })),
    preview: (id, input) => run((s) => service.preview(s, { artifactId: id, ...input })),
    history: (id, page) => run((s) => service.history(s, id, page)),
    restore: (id, version, message) => run((s) => service.restore(s, id, version, message)),
    setStatus: (id, action, message) =>
      run((s) => {
        switch (action) {
          case 'submit':
            return service.submit(s, id, message);
          case 'approve':
            return service.approve(s, id, message);
          case 'reject':
            return service.reject(s, id, message);
          case 'publish':
            return service.publish(s, id);
          case 'archive':
            return service.archive(s, id);
          default:
            throw new ArtifactError('INVALID_OPERATION', `Unknown status action "${String(action)}".`, {
              issues: [{ path: 'action', message: `Use one of: ${STATUS_ACTIONS.join(', ')}.` }],
            });
        }
      }),
    lock: (id, opts) => run((s) => service.lock(s, id, opts?.ttlMs)),
    unlock: (_id, lock) => run((s) => service.unlock(s, lock)),
    getLock: (id) => run((s) => service.getLock(s, id)),
    export: (id, input) =>
      run(async (s) => {
        const result = await service.export(s, {
          artifactId: id,
          format: input.format,
          ...(input.version === undefined ? {} : { version: input.version }),
          ...(input.options ? { options: input.options } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return {
          bytes: result.bytes,
          mimeType: result.mimeType,
          filename: result.filename,
          warnings: result.warnings,
        };
      }),
  };
}
