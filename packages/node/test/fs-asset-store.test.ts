import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { createFsAssetStore } from '../src/index.js';
import { otherWorkspace, PNG, rejection, tempDir, user } from './helpers.js';

describe('createFsAssetStore', () => {
  it('stores content-addressed bytes and dedupes', async () => {
    const dir = await tempDir();
    const store = createFsAssetStore({ dir });
    const first = await store.put(user, PNG, { mimeType: 'image/png', filename: 'a.png' });
    const again = await store.put(user, PNG, { mimeType: 'image/png', filename: 'b.png' });
    const hash = await sha256Hex(PNG);
    expect(first).toEqual({
      ref: `asset://${hash.slice(0, 24)}`,
      mimeType: 'image/png',
      size: PNG.byteLength,
      hash,
      filename: 'a.png',
    });
    expect(again.ref).toBe(first.ref);
    expect(again.filename).toBe('b.png');
    const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.bin'));
    expect(files).toHaveLength(1);
    const read = await createFsAssetStore({ dir }).get(user, first.ref);
    expect(read.mimeType).toBe('image/png');
    expect([...read.bytes]).toEqual([...PNG]);
  });

  it('isolates workspaces', async () => {
    const store = createFsAssetStore({ dir: await tempDir() });
    const { ref } = await store.put(user, PNG, { mimeType: 'image/png' });
    expect((await rejection(store.get(otherWorkspace, ref))).code).toBe('NOT_FOUND');
    expect((await rejection(store.url(otherWorkspace, ref, 60))).code).toBe('NOT_FOUND');
  });

  it('validates with the core policy', async () => {
    const store = createFsAssetStore({ dir: await tempDir(), policy: { maxBytes: 12 } });
    expect((await rejection(store.put(user, PNG, { mimeType: 'image/png' }))).code).toBe('ASSET_REJECTED');
    const strict = createFsAssetStore({ dir: await tempDir() });
    expect((await rejection(strict.put(user, PNG, { mimeType: 'image/jpeg' }))).message).toMatch(
      /does not match/,
    );
    expect(
      (await rejection(strict.put(user, new TextEncoder().encode('MZ'), { mimeType: 'image/png' }))).code,
    ).toBe('ASSET_REJECTED');
    const remote = { mimeType: 'image/png', sourceUrl: 'https://cdn.example.com/x.png' };
    expect((await rejection(strict.put(user, PNG, remote))).message).toMatch(/domain/);
    const allowed = createFsAssetStore({ dir: await tempDir(), policy: { allowedDomains: ['example.com'] } });
    expect((await allowed.put(user, PNG, remote)).mimeType).toBe('image/png');
  });

  it('sanitizes SVG before hashing and storing', async () => {
    const store = createFsAssetStore({ dir: await tempDir() });
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><rect/></svg>',
    );
    const info = await store.put(user, svg, { mimeType: 'image/svg+xml' });
    const stored = new TextDecoder().decode((await store.get(user, info.ref)).bytes);
    expect(stored).not.toMatch(/script|onload/);
    expect(info.hash).toBe(await sha256Hex(new TextEncoder().encode(stored)));
  });

  it('returns data URLs or the configured public URL', async () => {
    const dir = await tempDir();
    const local = createFsAssetStore({ dir });
    const { ref } = await local.put(user, PNG, { mimeType: 'image/png' });
    expect(await local.url(user, ref, 60)).toMatch(/^data:image\/png;base64,/);
    const calls: unknown[] = [];
    const cdn = createFsAssetStore({
      dir,
      publicUrl: (assetRef, ctx) => {
        calls.push([assetRef, ctx.scope.workspaceId, ctx.ttlSeconds, ctx.mimeType]);
        return `https://files.example.com/${assetRef.slice(8)}?ttl=${ctx.ttlSeconds}`;
      },
    });
    expect(await cdn.url(user, ref, 300)).toBe(`https://files.example.com/${ref.slice(8)}?ttl=300`);
    expect(calls).toEqual([[ref, 'ws_1', 300, 'image/png']]);
  });

  it('rejects malformed refs without touching the filesystem', async () => {
    const dir = await tempDir();
    const store = createFsAssetStore({ dir });
    for (const ref of ['asset://../../x', 'asset://ABC', 'file:///etc/passwd', 'asset://']) {
      expect((await rejection(store.get(user, ref))).code).toBe('NOT_FOUND');
    }
    expect(await readdir(dir)).toEqual([]);
    expect(join(dir)).toBe(dir);
  });
});
