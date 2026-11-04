import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Artifact, ArtifactError, type CommitResult, type Lock, type Scope } from '@artkit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifactRoutes, httpStatusForError, toNodeHandler } from '../src/index.js';
import { noteService } from './helpers.js';

const BASE = 'http://app.test/api/artifacts';

function setup(options: Partial<Parameters<typeof createArtifactRoutes>[0]> = {}) {
  const service = noteService();
  const handler = createArtifactRoutes({
    service,
    // The test app authenticates through a header; real apps use sessions or tokens.
    resolveScope: (request): Scope => {
      const actor = request.headers.get('x-actor') ?? 'user:u1';
      const [type, id] = actor.split(':') as ['user' | 'agent', string];
      return { workspaceId: request.headers.get('x-workspace') ?? 'ws_1', actor: { type, id } };
    },
    ...options,
  });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] ??= 'application/json';
    }
    const response = await handler(new Request(`${BASE}${path}`, init));
    if (!response) return { response: undefined, status: 0, json: undefined as never };
    const type = response.headers.get('content-type') ?? '';
    // biome-ignore lint/suspicious/noExplicitAny: test helper returns arbitrary JSON.
    const json: any = type.includes('json') ? await response.json() : undefined;
    return { response, status: response.status, json };
  };
  return { service, handler, call };
}

async function createNote(call: ReturnType<typeof setup>['call'], headers: Record<string, string> = {}) {
  const { status, json } = await call(
    'POST',
    '',
    { kind: 'note', title: 'Plan', content: { items: [{ id: 'a', text: 'x' }] }, tags: ['t'] },
    headers,
  );
  expect(status).toBe(200);
  return json as CommitResult;
}

describe('createArtifactRoutes', () => {
  it('maps every error code to the contract status', () => {
    expect(httpStatusForError('NOT_FOUND')).toBe(404);
    expect(httpStatusForError('PERMISSION_DENIED')).toBe(403);
    expect(httpStatusForError('APPROVAL_REQUIRED')).toBe(403);
    expect(httpStatusForError('VERSION_CONFLICT')).toBe(409);
    expect(httpStatusForError('LOCKED')).toBe(423);
    expect(httpStatusForError('LIMIT_EXCEEDED')).toBe(413);
    for (const code of [
      'INVALID_CONTENT',
      'INVALID_OPERATION',
      'INVALID_ENVELOPE',
      'UNSUPPORTED_VERSION',
      'MIGRATION_FAILED',
      'OPERATION_FAILED',
      'UNKNOWN_KIND',
      'ASSET_REJECTED',
    ] as const) {
      expect(httpStatusForError(code)).toBe(422);
    }
    expect(httpStatusForError('EXPORT_FAILED')).toBe(500);
    expect(httpStatusForError('INTERNAL_ERROR')).toBe(500);
  });

  it('ignores requests outside its routes', async () => {
    const { handler, call } = setup();
    expect(await handler(new Request('http://app.test/other'))).toBeUndefined();
    expect(await handler(new Request('http://app.test/api/artifactsX'))).toBeUndefined();
    expect((await call('GET', '/art_1/unknown')).response).toBeUndefined();
    expect((await call('GET', '/art_1/read/extra')).response).toBeUndefined();
    expect((await call('OPTIONS', '')).response).toBeUndefined();
  });

  it('answers 405 with Allow for known paths', async () => {
    const { call } = setup();
    const { status, response, json } = await call('DELETE', '/art_1');
    expect(status).toBe(405);
    expect(response?.headers.get('allow')).toBe('GET');
    expect(json.ok).toBe(false);
  });

  it('creates, gets, lists and reads', async () => {
    const { call } = setup();
    const created = await createNote(call);
    expect(created).toMatchObject({ version: 1, replayed: false });
    const id = created.artifact.id;
    expect((await call('GET', `/${id}`)).json).toMatchObject({ id, version: 1, title: 'Plan' });
    expect((await call('GET', `/${id}?version=1`)).json.version).toBe(1);
    expect((await call('GET', `/${id}?version=7`)).status).toBe(404);
    const list = await call('GET', '?kind=note&tag=t&title=pla&status=draft&limit=10');
    expect(list.json.items.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await call('GET', '?kind=sheet')).json.items).toEqual([]);
    const read = await call('GET', `/${id}/read?mode=full&maxTokens=200`);
    expect(read.json).toMatchObject({ version: 1, projection: { truncated: false } });
    expect(read.json.text).toContain(`<artifact-content id="${id}">`);
  });

  it('validates query strings with model-readable issues', async () => {
    const { call } = setup();
    const { status, json } = await call('GET', '?status=bogus&limit=0');
    expect(status).toBe(422);
    expect(json.error.code).toBe('INVALID_OPERATION');
    expect(json.error.issues.map((i: { path: string }) => i.path)).toEqual(['query.status', 'query.limit']);
    expect((await call('GET', '/art_1/read?mode=wide')).status).toBe(422);
  });

  it('never trusts workspace or actor ids from the body', async () => {
    const { call } = setup();
    const { json } = await call('POST', '', {
      kind: 'note',
      title: 'Spoof',
      workspaceId: 'ws_2',
      actor: { type: 'user', id: 'root' },
    });
    expect(json.artifact.meta.createdBy).toEqual({ type: 'user', id: 'u1' });
    expect((await call('GET', `/${json.artifact.id}`, undefined, { 'x-workspace': 'ws_2' })).status).toBe(
      404,
    );
  });

  it('applies, previews, conflicts and keeps history', async () => {
    const { call } = setup();
    const id = (await createNote(call)).artifact.id;
    const preview = await call('POST', `/${id}/preview`, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'p' }],
    });
    expect(preview.status).toBe(200);
    expect(preview.json.content).toEqual({ items: [{ id: 'a', text: 'p' }] });
    const applied = await call('POST', `/${id}/apply`, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'y' }],
      idempotencyKey: 'k1',
      message: 'edit',
    });
    expect(applied.json).toMatchObject({ version: 2, rebased: false });
    const replay = await call('POST', `/${id}/apply`, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'y' }],
      idempotencyKey: 'k1',
    });
    expect(replay.json).toMatchObject({ version: 2, replayed: true });
    const conflict = await call('POST', `/${id}/apply`, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'z' }],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    const failed = await call('POST', `/${id}/apply`, {
      baseVersion: 2,
      operations: [{ op: 'remove', id: 'missing' }],
    });
    expect(failed.status).toBe(422);
    expect(failed.json.error.code).toBe('OPERATION_FAILED');
    const history = await call('GET', `/${id}/history?limit=1`);
    expect(history.json).toMatchObject({ items: [{ version: 2, message: 'edit' }], nextCursor: '1' });
    const restored = await call('POST', `/${id}/restore`, { version: 1 });
    expect(restored.json).toMatchObject({
      version: 3,
      artifact: { content: { items: [{ id: 'a', text: 'x' }] } },
    });
  });

  it('rejects malformed bodies with 422 and lists the fields', async () => {
    const { call } = setup();
    const id = (await createNote(call)).artifact.id;
    const missing = await call('POST', `/${id}/apply`, { operations: 'nope', idempotencyKey: 5 });
    expect(missing.status).toBe(422);
    expect(missing.json.error.issues.map((i: { path: string }) => i.path)).toEqual([
      'baseVersion',
      'operations',
      'idempotencyKey',
    ]);
    const badJson = await call('POST', `/${id}/apply`, '{"baseVersion":');
    expect(badJson.status).toBe(422);
    expect(badJson.json.error).toMatchObject({ code: 'INVALID_OPERATION', issues: [{ path: 'body' }] });
    const array = await call('POST', `/${id}/apply`, [1, 2]);
    expect(array.json.error.issues).toEqual([{ path: 'body', message: 'Expected a JSON object.' }]);
    const text = await call('POST', `/${id}/apply`, '{"baseVersion":1}', { 'content-type': 'text/plain' });
    expect(text.status).toBe(422);
    const empty = await call('POST', `/${id}/apply`);
    expect(empty.json.error.issues).toEqual([{ path: 'body', message: 'Required field.' }]);
    expect((await call('POST', '', { kind: 'nope', title: 'X' })).json.error.code).toBe('UNKNOWN_KIND');
    expect((await call('POST', '', { kind: 'note', title: 'X', tags: [1] })).json.error.issues[0].path).toBe(
      'tags[0]',
    );
  });

  it('limits body size by header and by streamed bytes', async () => {
    const { call, handler } = setup({ maxBodyBytes: 64 });
    const big = { kind: 'note', title: 'x'.repeat(100) };
    const declared = await call('POST', '', big);
    expect(declared.status).toBe(413);
    expect(declared.json.error.code).toBe('LIMIT_EXCEEDED');
    // A chunked body without content-length is counted while streaming.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++)
          controller.enqueue(new TextEncoder().encode('{"kind":"note","title":"aaaaaaaaaa"}'));
        controller.close();
      },
    });
    const request = new Request(BASE, {
      method: 'POST',
      body: stream,
      headers: { 'content-type': 'application/json' },
      duplex: 'half',
    } as RequestInit);
    expect((await handler(request))?.status).toBe(413);
  });

  it('runs the lifecycle through status actions', async () => {
    const { call } = setup();
    const agentHeaders = { 'x-actor': 'agent:a1' };
    const id = (await createNote(call, agentHeaders)).artifact.id;
    expect((await call('POST', `/${id}/status`, { action: 'publish' }, agentHeaders)).json.error.code).toBe(
      'APPROVAL_REQUIRED',
    );
    expect(
      (await call('POST', `/${id}/status`, { action: 'submit', message: 'review' }, agentHeaders)).json
        .status,
    ).toBe('pending_approval');
    const denied = await call('POST', `/${id}/status`, { action: 'approve' }, agentHeaders);
    expect(denied.status).toBe(403);
    const approved = await call('POST', `/${id}/status`, { action: 'approve' });
    expect((approved.json as Artifact).meta.publishedVersion).toBe(1);
    expect((await call('POST', `/${id}/status`, { action: 'archive' })).json.status).toBe('archived');
    expect((await call('POST', `/${id}/status`, { action: 'delete' })).json.error.issues[0].path).toBe(
      'action',
    );
  });

  it('locks and unlocks', async () => {
    const { call } = setup();
    const id = (await createNote(call)).artifact.id;
    const agentHeaders = { 'x-actor': 'agent:a1' };
    const locked = await call('POST', `/${id}/lock`, { ttlMs: 60_000 }, agentHeaders);
    const lock = locked.json as Lock;
    expect(lock).toMatchObject({ artifactId: id, holder: { type: 'agent', id: 'a1' } });
    expect((await call('GET', `/${id}/lock`)).json).toMatchObject({ holder: { type: 'agent', id: 'a1' } });
    const blocked = await call('POST', `/${id}/apply`, {
      baseVersion: 1,
      operations: [{ op: 'add', text: 'y' }],
    });
    expect(blocked.status).toBe(423);
    expect(blocked.json.error.code).toBe('LOCKED');
    expect((await call('POST', `/${id}/lock`, { ttlMs: 10 * 60 * 60 * 1000 })).status).toBe(422);
    expect((await call('DELETE', `/${id}/lock`, { ...lock, artifactId: 'art_other' })).status).toBe(422);
    const released = await call('DELETE', `/${id}/lock`, lock, agentHeaders);
    expect(released.status).toBe(204);
    expect((await call('GET', `/${id}/lock`)).json).toBeNull();
    expect(
      (await call('POST', `/${id}/apply`, { baseVersion: 1, operations: [{ op: 'add', text: 'y' }] })).status,
    ).toBe(200);
    // Locking with an empty body uses the default TTL.
    expect((await call('POST', `/${id}/lock`)).status).toBe(200);
  });

  it('exports files with the contract headers', async () => {
    const { call } = setup();
    const created = await call('POST', '', {
      kind: 'note',
      title: 'Relatório Final',
      content: { items: [{ text: 'olá' }] },
    });
    const id = created.json.artifact.id;
    const { response, status } = await call('POST', `/${id}/export`, { format: 'md' });
    expect(status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('text/markdown');
    expect(response?.headers.get('content-disposition')).toBe(
      `attachment; filename="relatorio-final.md"; filename*=UTF-8''relatorio-final.md`,
    );
    expect(JSON.parse(decodeURIComponent(response!.headers.get('x-artkit-warnings')!))).toEqual([
      'note export is lossy',
    ]);
    expect(await response!.text()).toBe('olá');
    expect((await call('POST', `/${id}/export`, { format: 'docx' })).status).toBe(404);
    expect((await call('POST', `/${id}/export`, {})).status).toBe(422);
  });

  it('aborts exports when the client goes away', async () => {
    const { call, handler } = setup();
    const id = (await createNote(call)).artifact.id;
    const controller = new AbortController();
    const pending = handler(
      new Request(`${BASE}/${id}/export`, {
        method: 'POST',
        body: JSON.stringify({ format: 'html' }),
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
      }),
    );
    setTimeout(() => controller.abort(), 20);
    const response = await pending;
    expect(response?.status).toBe(500);
    expect((await response!.json()).error.code).toBe('EXPORT_FAILED');
  });

  it('lets resolveScope deny or answer directly, and never leaks internal errors', async () => {
    const unauthorized = setup({ resolveScope: () => new Response('login', { status: 401 }) });
    expect((await unauthorized.call('GET', '')).status).toBe(401);
    const forbidden = setup({
      resolveScope: () => Promise.reject(new ArtifactError('PERMISSION_DENIED', 'No session.')),
    });
    expect((await forbidden.call('GET', '')).json.error).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'No session.',
    });
    const logs: unknown[] = [];
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error: (message: string, fields: unknown) => logs.push([message, fields]),
    };
    const broken = setup({
      resolveScope: () => Promise.reject(new Error('db password=secret at /srv/app.js')),
      logger,
    });
    const { status, json } = await broken.call('GET', '');
    expect(status).toBe(500);
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(json)).not.toContain('secret');
    expect(JSON.stringify(logs)).not.toContain('secret');
    expect(logs[0]).toEqual([
      'artkit.http_error',
      { code: 'INTERNAL_ERROR', status: 500, method: 'GET', route: 'collection' },
    ]);
  });

  it('supports custom base paths and pt-BR messages', async () => {
    const { handler } = setup({ basePath: 'v1/docs/', locale: 'pt-BR' });
    const response = await handler(new Request('http://app.test/v1/docs?limit=x'));
    expect(response?.status).toBe(422);
    expect((await response!.json()).error.message).toBe('A requisição é inválida.');
    expect(await handler(new Request(BASE))).toBeUndefined();
  });
});

describe('toNodeHandler', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function listen(handle: Parameters<typeof createServer>[1]): Promise<string> {
    server = createServer(handle);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('serves the routes over node:http', async () => {
    const { handler } = setup();
    const origin = await listen(toNodeHandler(handler));
    const created = await fetch(`${origin}/api/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', title: 'Over HTTP', content: { items: [{ text: 'hi' }] } }),
    });
    expect(created.status).toBe(200);
    const { artifact } = (await created.json()) as CommitResult;
    const exported = await fetch(`${origin}/api/artifacts/${artifact.id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'md' }),
    });
    expect(exported.headers.get('content-disposition')).toContain('over-http.md');
    expect(exported.headers.get('x-artkit-warnings')).toBe(encodeURIComponent('["note export is lossy"]'));
    expect(await exported.text()).toBe('hi');
    const conflict = await fetch(`${origin}/api/artifacts/${artifact.id}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseVersion: 9, operations: [{ op: 'add', text: 'x' }] }),
    });
    expect(conflict.status).toBe(409);
    const missing = await fetch(`${origin}/elsewhere`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('Not Found');
  });

  it('falls through to next() and reuses bodies parsed by middleware', async () => {
    const { handler } = setup();
    const node = toNodeHandler(handler);
    let fellThrough = 0;
    const origin = await listen((req, res) => {
      if (req.url?.startsWith('/parsed')) {
        // Simulates express.json(): consume the stream, then mount the artifact routes under a prefix.
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          Object.assign(req, {
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            originalUrl: '/api/artifacts',
          });
          void node(req, res);
        });
        return;
      }
      void node(req, res, () => {
        fellThrough++;
        res.statusCode = 418;
        res.end();
      });
    });
    expect((await fetch(`${origin}/nothing-here`)).status).toBe(418);
    expect(fellThrough).toBe(1);
    const parsed = await fetch(`${origin}/parsed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', title: 'Parsed' }),
    });
    expect(parsed.status).toBe(200);
    expect(((await parsed.json()) as CommitResult).artifact.title).toBe('Parsed');
  });
});
