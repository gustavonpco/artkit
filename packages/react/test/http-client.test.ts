import { ArtifactError } from '@artkit-ai/core';
import { describe, expect, it, vi } from 'vitest';
import { createHttpClient, filenameFromDisposition } from '../src/index.js';

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function mockFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected rejection');
}

describe('createHttpClient', () => {
  it('maps every method to the HTTP contract', async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ ok: true }),
    );
    const client = createHttpClient({ baseUrl: '/base/', fetch, headers: { Authorization: 'Bearer t' } });
    const lock = {
      artifactId: 'a b',
      holder: { type: 'user' as const, id: 'u' },
      token: 'tk',
      expiresAt: '2030-01-01T00:00:00Z',
    };

    await client.list({ kind: 'note', status: 'draft', title: 'Plan', tag: 'x' }, { limit: 5, cursor: 'c1' });
    await client.create({ kind: 'note', title: 'T' });
    await client.get('a b', { version: 3 });
    await client.read('a b', { mode: 'range', range: 'a..b', maxTokens: 100, cursor: 'c2', version: 2 });
    await client.apply('a b', {
      baseVersion: 2,
      operations: [{ op: 'remove', id: 'x' }],
      idempotencyKey: 'k',
    });
    await client.preview('a b', { baseVersion: 2, operations: [] });
    await client.history('a b', { limit: 10, cursor: 'h' });
    await client.restore('a b', 1, 'back');
    await client.setStatus('a b', 'reject', 'too long');
    await client.lock('a b', { ttlMs: 1000 });
    await expect(client.unlock('a b', lock)).resolves.toBeUndefined();

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /base?kind=note&status=draft&title=Plan&tag=x&limit=5&cursor=c1',
      'POST /base',
      'GET /base/a%20b?version=3',
      'GET /base/a%20b/read?mode=range&range=a..b&maxTokens=100&cursor=c2&version=2',
      'POST /base/a%20b/apply',
      'POST /base/a%20b/preview',
      'GET /base/a%20b/history?limit=10&cursor=h',
      'POST /base/a%20b/restore',
      'POST /base/a%20b/status',
      'POST /base/a%20b/lock',
      'DELETE /base/a%20b/lock',
    ]);
    expect(calls[1]?.body).toEqual({ kind: 'note', title: 'T' });
    expect(calls[4]?.body).toEqual({
      baseVersion: 2,
      operations: [{ op: 'remove', id: 'x' }],
      idempotencyKey: 'k',
    });
    expect(calls[7]?.body).toEqual({ version: 1, message: 'back' });
    expect(calls[8]?.body).toEqual({ action: 'reject', message: 'too long' });
    expect(calls[9]?.body).toEqual({ ttlMs: 1000 });
    expect(calls[10]?.body).toEqual(lock);
    expect(calls[1]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls.every((call) => call.headers.get('Authorization') === 'Bearer t')).toBe(true);
  });

  it('uses the default base path and resolves headers per request', async () => {
    let token = 0;
    const { fetch, calls } = mockFetch(() => json({ items: [] }));
    const client = createHttpClient({ fetch, headers: async () => ({ 'X-Token': String(++token) }) });
    await client.list();
    await client.list();
    expect(calls[0]?.url).toBe('/api/artifacts');
    expect(calls.map((call) => call.headers.get('X-Token'))).toEqual(['1', '2']);
  });

  it('rebuilds ArtifactError from ModelErrorPayload responses', async () => {
    const payload = {
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'The artifact changed.',
        issues: [{ path: 'baseVersion', message: 'stale', hint: 'Read again.' }, { bogus: true }],
        details: {
          currentVersion: 4,
          changesSinceBase: [{ type: 'changed', target: 'item:a', summary: 'x' }],
        },
      },
    };
    const { fetch } = mockFetch(() => json(payload, 409));
    const error = await rejection(createHttpClient({ fetch }).apply('a', { baseVersion: 1, operations: [] }));
    expect(error).toBeInstanceOf(ArtifactError);
    const artifactError = error as ArtifactError;
    expect(artifactError.code).toBe('VERSION_CONFLICT');
    expect(artifactError.message).toBe('The artifact changed.');
    expect(artifactError.issues).toEqual([{ path: 'baseVersion', message: 'stale', hint: 'Read again.' }]);
    expect(artifactError.details).toMatchObject({ currentVersion: 4, status: 409 });
  });

  it.each([
    [404, 'NOT_FOUND'],
    [403, 'PERMISSION_DENIED'],
    [409, 'VERSION_CONFLICT'],
    [413, 'LIMIT_EXCEEDED'],
    [422, 'INVALID_CONTENT'],
    [423, 'LOCKED'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
  ])('falls back to the status code mapping for %i without a payload', async (status, code) => {
    const { fetch } = mockFetch(() => new Response('<html>gateway</html>', { status }));
    const error = (await rejection(createHttpClient({ fetch }).get('a'))) as ArtifactError;
    expect(error.code).toBe(code);
    expect(error.details.status).toBe(status);
  });

  it('keeps APPROVAL_REQUIRED and maps unknown codes by status', async () => {
    const { fetch } = mockFetch((call) =>
      call.url.endsWith('status')
        ? json({ ok: false, error: { code: 'APPROVAL_REQUIRED', message: 'needs approval' } }, 403)
        : json({ ok: false, error: { code: 'WHATEVER', message: 'odd' } }, 423),
    );
    const client = createHttpClient({ fetch });
    expect(((await rejection(client.setStatus('a', 'publish'))) as ArtifactError).code).toBe(
      'APPROVAL_REQUIRED',
    );
    expect(((await rejection(client.get('a'))) as ArtifactError).code).toBe('LOCKED');
  });

  it('wraps network failures and lets aborts through', async () => {
    const network = createHttpClient({
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    const error = (await rejection(network.get('a'))) as ArtifactError;
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.details.network).toBe(true);

    const abort = new DOMException('aborted', 'AbortError');
    const aborted = createHttpClient({
      fetch: (async () => {
        throw abort;
      }) as unknown as typeof fetch,
    });
    expect(await rejection(aborted.get('a'))).toBe(abort);
  });

  it('reads export bytes, filename and warnings from the response headers', async () => {
    const warnings = encodeURIComponent(JSON.stringify(['Fonts were replaced', 'Comments dropped']));
    const { fetch, calls } = mockFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=binary',
            'Content-Disposition': `attachment; filename="fallback.docx"; filename*=UTF-8''Proposta%20t%C3%A9cnica.docx`,
            'X-Artkit-Warnings': warnings,
          },
        }),
    );
    const result = await createHttpClient({ fetch }).export('doc-1', {
      format: 'docx',
      version: 2,
      options: { toc: true },
    });
    expect(calls[0]?.body).toEqual({ format: 'docx', version: 2, options: { toc: true } });
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.filename).toBe('Proposta técnica.docx');
    expect(result.warnings).toEqual(['Fonts were replaced', 'Comments dropped']);
  });

  it('falls back to a generated filename and ignores malformed warnings', async () => {
    const { fetch } = mockFetch(() => new Response('a,b', { headers: { 'X-Artkit-Warnings': '%E0%A4%A' } }));
    const result = await createHttpClient({ fetch }).export('doc-1', { format: 'csv' });
    expect(result.filename).toBe('doc-1.csv');
    expect(result.warnings).toEqual([]);
  });
});

describe('filenameFromDisposition', () => {
  it('parses plain, quoted and extended forms and strips paths', () => {
    expect(filenameFromDisposition('attachment; filename=report.pdf')).toBe('report.pdf');
    expect(filenameFromDisposition('attachment; filename="my report.pdf"')).toBe('my report.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''a%2Fb%2F..%2Fevil.sh")).toBe('evil.sh');
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(filenameFromDisposition(null)).toBeUndefined();
    expect(filenameFromDisposition('inline')).toBeUndefined();
  });
});
