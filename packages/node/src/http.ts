import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import {
  ARTIFACT_STATUSES,
  ArtifactError,
  type ArtifactFilter,
  type ArtifactService,
  type ArtifactStatus,
  type CreateRequest,
  catalogLocale,
  type ErrorCode,
  type ErrorIssue,
  isArtifactError,
  type Lock,
  type Logger,
  type ProjectionMode,
  type Scope,
  silentLogger,
  t,
  toModelError,
} from '@artkit-ai/core';

/** Fetch-standard handler; resolves `undefined` when the request is not for the artifact routes. */
export type ArtifactRouteHandler = (request: Request) => Promise<Response | undefined>;

export interface ArtifactRoutesOptions {
  service: ArtifactService;
  /**
   * Derives workspace and actor from the authenticated request (session, token…). Workspace and user
   * ids in bodies or query strings are never trusted. Throw `ArtifactError('PERMISSION_DENIED')` to
   * answer 403, or return a `Response` (e.g. a 401) to answer it as is.
   */
  resolveScope(request: Request): Scope | Response | Promise<Scope | Response>;
  /** Default `/api/artifacts`. */
  basePath?: string;
  /** Maximum JSON body size in bytes (default 6 MiB: the 5 MB envelope limit plus request overhead). */
  maxBodyBytes?: number;
  /** Maximum lock TTL accepted from clients (default 1 hour). */
  maxLockTtlMs?: number;
  /** Locale of the messages produced by the routes themselves (pt-BR or en). */
  locale?: string;
  /** Receives metadata-only error logs (code, status, route), never bodies. */
  logger?: Logger;
}

const DEFAULT_BASE_PATH = '/api/artifacts';
const DEFAULT_MAX_BODY_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_LOCK_TTL_MS = 60 * 60 * 1000;
const MAX_KEY_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 4000;
const STATUS_ACTIONS = ['submit', 'approve', 'reject', 'publish', 'archive'] as const;
const READ_MODES: readonly ProjectionMode[] = ['outline', 'full', 'range'];

/** HTTP status for each error code of the catalog (docs/CONVENTIONS.md, HTTP contract). */
export function httpStatusForError(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'PERMISSION_DENIED':
    case 'APPROVAL_REQUIRED':
      return 403;
    case 'VERSION_CONFLICT':
      return 409;
    case 'LOCKED':
      return 423;
    case 'LIMIT_EXCEEDED':
      return 413;
    case 'EXPORT_FAILED':
    case 'INTERNAL_ERROR':
      return 500;
    default:
      // INVALID_*, UNSUPPORTED_VERSION, MIGRATION_FAILED, OPERATION_FAILED, UNKNOWN_KIND, ASSET_REJECTED…
      return 422;
  }
}

const messages = {
  'pt-BR': {
    invalidRequest: 'A requisição é inválida.',
    invalidJson: 'O corpo não é um JSON válido.',
    invalidJsonHint: 'Envie um objeto JSON bem formado.',
    unsupportedMedia: 'Envie o corpo como application/json.',
    methodNotAllowed: (method: string, allowed: string) => `Método ${method} não permitido; use ${allowed}.`,
    expectedObject: 'Esperado um objeto JSON.',
    required: 'Campo obrigatório.',
    expectedString: (max: number) => `Esperado texto com até ${max} caracteres.`,
    expectedInteger: (min: number, max: number) => `Esperado inteiro entre ${min} e ${max}.`,
    expectedOneOf: (values: readonly string[]) => `Use um dos valores: ${values.join(', ')}.`,
    expectedArray: 'Esperado um array.',
    lockMismatch: 'O bloqueio pertence a outro artefato.',
  },
  en: {
    invalidRequest: 'The request is invalid.',
    invalidJson: 'The body is not valid JSON.',
    invalidJsonHint: 'Send a well-formed JSON object.',
    unsupportedMedia: 'Send the body as application/json.',
    methodNotAllowed: (method: string, allowed: string) => `Method ${method} is not allowed; use ${allowed}.`,
    expectedObject: 'Expected a JSON object.',
    required: 'Required field.',
    expectedString: (max: number) => `Expected text with at most ${max} characters.`,
    expectedInteger: (min: number, max: number) => `Expected an integer between ${min} and ${max}.`,
    expectedOneOf: (values: readonly string[]) => `Use one of: ${values.join(', ')}.`,
    expectedArray: 'Expected an array.',
    lockMismatch: 'The lock belongs to another artifact.',
  },
};

type Messages = (typeof messages)['en'];

/** Collects field issues so a single 422 lists every problem of the request. */
class Validator {
  readonly issues: ErrorIssue[] = [];
  constructor(readonly m: Messages) {}

  fail(path: string, message: string, hint?: string): undefined {
    this.issues.push(hint ? { path, message, hint } : { path, message });
    return undefined;
  }

  string(value: unknown, path: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
    const max = opts.max ?? MAX_MESSAGE_LENGTH;
    if (value === undefined || value === null)
      return opts.required ? this.fail(path, this.m.required) : undefined;
    if (typeof value !== 'string' || value.length > max || (opts.required && value.length === 0)) {
      return this.fail(path, this.m.expectedString(max));
    }
    return value;
  }

  int(
    value: unknown,
    path: string,
    opts: { required?: boolean; min?: number; max?: number } = {},
  ): number | undefined {
    const min = opts.min ?? 1;
    const max = opts.max ?? Number.MAX_SAFE_INTEGER;
    if (value === undefined || value === null)
      return opts.required ? this.fail(path, this.m.required) : undefined;
    const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < min || parsed > max) {
      return this.fail(path, this.m.expectedInteger(min, max));
    }
    return parsed;
  }

  oneOf<T extends string>(
    value: unknown,
    values: readonly T[],
    path: string,
    required = false,
  ): T | undefined {
    if (value === undefined || value === null) return required ? this.fail(path, this.m.required) : undefined;
    return values.includes(value as T) ? (value as T) : this.fail(path, this.m.expectedOneOf(values));
  }

  object(value: unknown, path: string, required = false): Record<string, unknown> | undefined {
    if (value === undefined || value === null) return required ? this.fail(path, this.m.required) : undefined;
    return isPlainObject(value) ? value : this.fail(path, this.m.expectedObject);
  }

  throwIfInvalid(locale: string | undefined): void {
    if (this.issues.length > 0) {
      throw new ArtifactError('INVALID_OPERATION', messages[catalogLocale(locale)].invalidRequest, {
        issues: this.issues,
      });
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

type Route =
  | { name: 'collection' }
  | { name: 'artifact'; id: string }
  | { name: 'read' | 'apply' | 'preview' | 'history' | 'restore' | 'status' | 'lock' | 'export'; id: string };

const SUB_ROUTES = ['read', 'apply', 'preview', 'history', 'restore', 'status', 'lock', 'export'] as const;

const ALLOWED_METHODS: Record<Route['name'], readonly string[]> = {
  collection: ['GET', 'POST'],
  artifact: ['GET'],
  read: ['GET'],
  apply: ['POST'],
  preview: ['POST'],
  history: ['GET'],
  restore: ['POST'],
  status: ['POST'],
  lock: ['GET', 'POST', 'DELETE'],
  export: ['POST'],
};

function normalizeBasePath(path: string): string {
  let out = path.trim();
  if (!out.startsWith('/')) out = `/${out}`;
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function matchRoute(pathname: string, basePath: string): Route | undefined {
  if (pathname !== basePath && !pathname.startsWith(basePath === '/' ? '/' : `${basePath}/`))
    return undefined;
  const rest = pathname.slice(basePath === '/' ? 1 : basePath.length + 1);
  const segments = rest === '' ? [] : rest.split('/');
  if (segments.length > 0 && segments[segments.length - 1] === '') segments.pop();
  let decoded: string[];
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
  if (decoded.length === 0) return { name: 'collection' };
  const id = decoded[0]!;
  if (id === '') return undefined;
  if (decoded.length === 1) return { name: 'artifact', id };
  const sub = decoded[1] as (typeof SUB_ROUTES)[number];
  if (decoded.length === 2 && SUB_ROUTES.includes(sub)) return { name: sub, id };
  return undefined;
}

/**
 * HTTP routes for the artifact service, implementing the contract consumed by `@artkit-ai/react`
 * (docs/CONVENTIONS.md). Framework-neutral: works with any runtime that speaks fetch `Request`/`Response`
 * (Next.js route handlers, Hono, Bun, Deno) and with `node:http`/Express through {@link toNodeHandler}.
 *
 * POST and DELETE bodies must be `application/json` (this also blocks cross-site form posts).
 */
export function createArtifactRoutes(options: ArtifactRoutesOptions): ArtifactRouteHandler {
  const { service } = options;
  if (!service || typeof options.resolveScope !== 'function') {
    throw new TypeError('createArtifactRoutes: `service` and `resolveScope` are required.');
  }
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_BASE_PATH);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxLockTtlMs = options.maxLockTtlMs ?? DEFAULT_MAX_LOCK_TTL_MS;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1)
    throw new TypeError('createArtifactRoutes: `maxBodyBytes` must be a positive integer.');
  if (!Number.isInteger(maxLockTtlMs) || maxLockTtlMs < 1)
    throw new TypeError('createArtifactRoutes: `maxLockTtlMs` must be a positive integer.');
  const locale = options.locale;
  const m = messages[catalogLocale(locale)];
  const logger = options.logger ?? silentLogger;

  async function readJsonBody(request: Request): Promise<unknown> {
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) > maxBodyBytes) throw tooLarge(Number(declared));
    if (!request.body) return undefined;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge(total);
      }
      chunks.push(value);
    }
    if (total === 0) return undefined;
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^application\/([\w.+-]+\+)?json\s*(;|$)/i.test(contentType)) {
      throw new ArtifactError('INVALID_OPERATION', m.unsupportedMedia, {
        issues: [{ path: 'body', message: m.unsupportedMedia }],
      });
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new ArtifactError('INVALID_OPERATION', m.invalidJson, {
        issues: [{ path: 'body', message: m.invalidJson, hint: m.invalidJsonHint }],
      });
    }
  }

  function tooLarge(found: number): ArtifactError {
    return new ArtifactError(
      'LIMIT_EXCEEDED',
      t(locale, 'LIMIT_EXCEEDED', { limit: 'maxBodyBytes', max: maxBodyBytes, found }),
      {
        details: { limit: 'maxBodyBytes', max: maxBodyBytes },
      },
    );
  }

  async function bodyObject(request: Request, required: boolean): Promise<Record<string, unknown>> {
    const body = await readJsonBody(request);
    const v = new Validator(m);
    const parsed = v.object(body, 'body', required);
    v.throwIfInvalid(locale);
    return parsed ?? {};
  }

  function applyRequest(id: string, body: Record<string, unknown>) {
    const v = new Validator(m);
    const baseVersion = v.int(body.baseVersion, 'baseVersion', { required: true });
    const operations = Array.isArray(body.operations)
      ? (body.operations as unknown[])
      : v.fail('operations', m.expectedArray);
    const idempotencyKey = v.string(body.idempotencyKey, 'idempotencyKey', { max: MAX_KEY_LENGTH });
    const message = v.string(body.message, 'message');
    v.throwIfInvalid(locale);
    return {
      artifactId: id,
      baseVersion: baseVersion!,
      operations: operations!,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(message ? { message } : {}),
    };
  }

  async function dispatch(route: Route, request: Request, url: URL, scope: Scope): Promise<Response> {
    const method = request.method.toUpperCase();
    const query = url.searchParams;
    switch (route.name) {
      case 'collection': {
        if (method === 'GET') {
          const v = new Validator(m);
          const status = v.oneOf<ArtifactStatus>(
            query.get('status') ?? undefined,
            ARTIFACT_STATUSES,
            'query.status',
          );
          const limit = v.int(query.get('limit') ?? undefined, 'query.limit', { max: 500 });
          const filter: ArtifactFilter = {};
          for (const key of ['kind', 'title', 'tag'] as const) {
            const value = v.string(query.get(key) ?? undefined, `query.${key}`, { max: 200 });
            if (value) filter[key] = value;
          }
          const cursor = v.string(query.get('cursor') ?? undefined, 'query.cursor', { max: MAX_KEY_LENGTH });
          v.throwIfInvalid(locale);
          if (status) filter.status = status;
          return json(
            200,
            await service.list(scope, filter, { ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) }),
          );
        }
        const body = await bodyObject(request, true);
        const v = new Validator(m);
        const kind = v.string(body.kind, 'kind', { required: true, max: 64 });
        const title = v.string(body.title, 'title', { required: true, max: 1000 });
        const inputObject = v.object(body.input, 'input');
        const inputFormat = inputObject
          ? v.string(inputObject.format, 'input.format', { required: true, max: 64 })
          : undefined;
        const artifactLocale = v.string(body.locale, 'locale', { max: 64 });
        const themeId = v.string(body.themeId, 'themeId', { max: 64 });
        let tags: string[] | undefined;
        if (body.tags !== undefined && body.tags !== null) {
          if (!Array.isArray(body.tags)) v.fail('tags', m.expectedArray);
          else
            tags = body.tags.map((tag, i) => v.string(tag, `tags[${i}]`, { required: true, max: 64 }) ?? '');
        }
        const message = v.string(body.message, 'message');
        const idempotencyKey = v.string(body.idempotencyKey, 'idempotencyKey', { max: MAX_KEY_LENGTH });
        v.throwIfInvalid(locale);
        // Only known fields are forwarded: workspace or actor ids in the body are ignored.
        const create: CreateRequest = {
          kind: kind!,
          title: title!,
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(inputObject ? { input: { format: inputFormat!, source: inputObject.source } } : {}),
          ...(artifactLocale ? { locale: artifactLocale } : {}),
          ...(themeId ? { themeId } : {}),
          ...(tags ? { tags } : {}),
          ...(message ? { message } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        };
        return json(200, await service.create(scope, create));
      }

      case 'artifact': {
        const v = new Validator(m);
        const version = v.int(query.get('version') ?? undefined, 'query.version');
        v.throwIfInvalid(locale);
        return json(200, await service.get(scope, route.id, version === undefined ? undefined : { version }));
      }

      case 'read': {
        const v = new Validator(m);
        const mode = v.oneOf(query.get('mode') ?? undefined, READ_MODES, 'query.mode');
        const range = v.string(query.get('range') ?? undefined, 'query.range', { max: 500 });
        const maxTokens = v.int(query.get('maxTokens') ?? undefined, 'query.maxTokens');
        const cursor = v.string(query.get('cursor') ?? undefined, 'query.cursor', { max: MAX_KEY_LENGTH });
        const version = v.int(query.get('version') ?? undefined, 'query.version');
        v.throwIfInvalid(locale);
        return json(
          200,
          await service.read(scope, route.id, {
            ...(mode ? { mode } : {}),
            ...(range !== undefined ? { range } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
            ...(version !== undefined ? { version } : {}),
          }),
        );
      }

      case 'apply':
        return json(200, await service.apply(scope, applyRequest(route.id, await bodyObject(request, true))));

      case 'preview':
        return json(
          200,
          await service.preview(scope, applyRequest(route.id, await bodyObject(request, true))),
        );

      case 'history': {
        const v = new Validator(m);
        const limit = v.int(query.get('limit') ?? undefined, 'query.limit', { max: 500 });
        const cursor = v.string(query.get('cursor') ?? undefined, 'query.cursor', { max: MAX_KEY_LENGTH });
        v.throwIfInvalid(locale);
        return json(
          200,
          await service.history(scope, route.id, {
            ...(limit ? { limit } : {}),
            ...(cursor ? { cursor } : {}),
          }),
        );
      }

      case 'restore': {
        const body = await bodyObject(request, true);
        const v = new Validator(m);
        const version = v.int(body.version, 'version', { required: true });
        const message = v.string(body.message, 'message');
        v.throwIfInvalid(locale);
        return json(200, await service.restore(scope, route.id, version!, message));
      }

      case 'status': {
        const body = await bodyObject(request, true);
        const v = new Validator(m);
        const action = v.oneOf(body.action, STATUS_ACTIONS, 'action', true);
        const message = v.string(body.message, 'message');
        v.throwIfInvalid(locale);
        const run = {
          submit: () => service.submit(scope, route.id, message),
          approve: () => service.approve(scope, route.id, message),
          reject: () => service.reject(scope, route.id, message),
          publish: () => service.publish(scope, route.id),
          archive: () => service.archive(scope, route.id),
        }[action!];
        return json(200, await run());
      }

      case 'lock': {
        if (method === 'GET') return json(200, await service.getLock(scope, route.id));
        if (method === 'POST') {
          const body = await bodyObject(request, false);
          const v = new Validator(m);
          const ttlMs = v.int(body.ttlMs, 'ttlMs', { max: maxLockTtlMs });
          v.throwIfInvalid(locale);
          return json(200, await service.lock(scope, route.id, ttlMs));
        }
        const body = await bodyObject(request, true);
        const v = new Validator(m);
        const token = v.string(body.token, 'token', { required: true, max: MAX_KEY_LENGTH });
        const artifactId = v.string(body.artifactId, 'artifactId', { max: MAX_KEY_LENGTH });
        if (artifactId !== undefined && artifactId !== route.id) v.fail('artifactId', m.lockMismatch);
        const expiresAt = v.string(body.expiresAt, 'expiresAt', { max: 64 });
        v.throwIfInvalid(locale);
        const holder =
          isPlainObject(body.holder) &&
          typeof body.holder.id === 'string' &&
          typeof body.holder.type === 'string'
            ? (body.holder as Lock['holder'])
            : scope.actor;
        // Unlocking is authorized by the token the lock holder received; the path decides the artifact.
        await service.unlock(scope, {
          artifactId: route.id,
          token: token!,
          holder,
          expiresAt: expiresAt ?? new Date(0).toISOString(),
        });
        return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      }

      case 'export': {
        const body = await bodyObject(request, true);
        const v = new Validator(m);
        const format = v.string(body.format, 'format', { required: true, max: 32 });
        const version = v.int(body.version, 'version');
        const exportOptions = v.object(body.options, 'options');
        v.throwIfInvalid(locale);
        const result = await service.export(scope, {
          artifactId: route.id,
          format: format!,
          signal: request.signal,
          ...(version !== undefined ? { version } : {}),
          ...(exportOptions ? { options: exportOptions } : {}),
        });
        return new Response(result.bytes as Uint8Array<ArrayBuffer>, {
          status: 200,
          headers: {
            'content-type': result.mimeType,
            'content-length': String(result.bytes.byteLength),
            'content-disposition': contentDisposition(result.filename),
            'x-artkit-warnings': encodeURIComponent(JSON.stringify(result.warnings)),
            'access-control-expose-headers': 'Content-Disposition, X-Artkit-Warnings',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        });
      }
    }
  }

  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return undefined;
    }
    const route = matchRoute(url.pathname, basePath);
    if (!route) return undefined;
    const method = request.method.toUpperCase();
    const allowed = ALLOWED_METHODS[route.name];
    // CORS preflights belong to the host application.
    if (method === 'OPTIONS') return undefined;
    if (!allowed.includes(method)) {
      const message = m.methodNotAllowed(method, allowed.join(', '));
      return json(
        405,
        { ok: false, error: { code: 'INVALID_OPERATION', message } },
        { allow: allowed.join(', ') },
      );
    }
    try {
      const scope = await options.resolveScope(request);
      if (scope instanceof Response) return scope;
      return await dispatch(route, request, url, scope);
    } catch (error) {
      const payload = toModelError(error, locale);
      const status = httpStatusForError(payload.error.code);
      const fields = { code: payload.error.code, status, method, route: route.name };
      if (status >= 500) logger.error('artkit.http_error', fields);
      else logger.debug('artkit.http_rejected', fields);
      if (!isArtifactError(error))
        logger.error('artkit.http_unexpected', {
          ...fields,
          errorName: error instanceof Error ? error.name : typeof error,
        });
      return json(status, payload);
    }
  };
}

export interface NodeHandlerOptions {
  /** Answer used when the request is not for the artifact routes and no `next` callback is given. */
  notFound?(req: IncomingMessage, res: ServerResponse): void;
}

type NodeRequest = IncomingMessage & { body?: unknown; originalUrl?: string };

/**
 * Adapts a fetch handler to `node:http` (and Connect/Express middleware). Unmatched requests go to
 * `next()` when provided, otherwise to `notFound` (plain 404). Mount it before body parsers; if a
 * parser already consumed the stream, the parsed `req.body` is re-serialized as JSON.
 */
export function toNodeHandler(handler: ArtifactRouteHandler, options: NodeHandlerOptions = {}) {
  return async (req: NodeRequest, res: ServerResponse, next?: (error?: unknown) => void): Promise<void> => {
    try {
      const request = toFetchRequest(req, res);
      const response = await handler(request);
      if (!response) {
        if (next) next();
        else if (options.notFound) options.notFound(req, res);
        else {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end('Not Found');
        }
        return;
      }
      await writeFetchResponse(response, res);
    } catch (error) {
      if (next) {
        next(error);
        return;
      }
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(toModelError(error)));
      } else {
        res.destroy();
      }
    }
  };
}

function toFetchRequest(req: NodeRequest, res: ServerResponse): Request {
  const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
  const host =
    typeof req.headers.host === 'string' && /^[A-Za-z0-9.:[\]-]+$/.test(req.headers.host)
      ? req.headers.host
      : 'localhost';
  // Express strips the mount path from req.url; originalUrl keeps it, so basePath matching still works.
  const url = new URL(req.originalUrl ?? req.url ?? '/', `${protocol}://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(':')) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  const controller = new AbortController();
  // Client disconnects abort long operations such as exports.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const method = (req.method ?? 'GET').toUpperCase();
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: controller.signal };
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined && req.readableEnded) {
      const body = req.body;
      init.body =
        typeof body === 'string'
          ? body
          : body instanceof Uint8Array
            ? (body as Uint8Array<ArrayBuffer>)
            : JSON.stringify(body);
      headers.delete('content-length');
    } else {
      init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
      init.duplex = 'half';
    }
  }
  return new Request(url, init);
}

async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    if (res.destroyed) return;
    if (!res.write(chunk)) await drainOrClose(res);
  }
  res.end();
}

function drainOrClose(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}
