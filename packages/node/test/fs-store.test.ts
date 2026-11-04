import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Commit,
  createArtifactService,
  createMemoryStore,
  createRegistry,
  type NewArtifact,
} from '@artkit/core';
import { defineStoreContractTests } from '@artkit/core/testing';
import { describe, expect, it } from 'vitest';
import { createFsStore } from '../src/index.js';
import { agent, otherWorkspace, rejection, tempDir, user } from './helpers.js';
import { noteKind } from './note-kind.js';

defineStoreContractTests('filesystem', async () => createFsStore({ dir: await tempDir() }), { describe, it });

const sample: NewArtifact = {
  kind: 'note',
  schemaVersion: 2,
  title: 'Plan',
  status: 'draft',
  locale: 'en',
  themeId: 'default',
  content: { items: [{ id: 'a', text: 'one' }] },
  tags: ['x'],
};

function change(baseVersion: number, text: string, extra: Partial<Commit> = {}): Commit {
  return {
    baseVersion,
    schemaVersion: 2,
    content: { items: [{ id: 'a', text }] },
    title: 'Plan',
    locale: 'en',
    themeId: 'default',
    operations: [{ op: 'edit', id: 'a', text }],
    diff: [{ type: 'changed', target: 'item:a', summary: text }],
    ...extra,
  };
}

describe('createFsStore', () => {
  it('validates its options', () => {
    expect(() => createFsStore({ dir: '' })).toThrow(/dir/);
    expect(() => createFsStore({ dir: '/tmp/x', snapshotEvery: 0 })).toThrow(/snapshotEvery/);
  });

  it('persists across store instances and keeps old versions immutable', async () => {
    const dir = await tempDir();
    const first = createFsStore({ dir });
    const created = await first.create(user, sample);
    await first.commit(user, created.id, change(1, 'two'));
    const second = createFsStore({ dir });
    expect((await second.get(user, created.id))?.content).toEqual({ items: [{ id: 'a', text: 'two' }] });
    expect((await second.get(user, created.id, { version: 1 }))?.content).toEqual(sample.content);
    expect(await second.get(user, created.id, { version: 3 })).toBeNull();
    expect(await second.get(user, created.id, { version: 0 })).toBeNull();
  });

  it('serializes concurrent commits: exactly one wins per base version', async () => {
    const store = createFsStore({ dir: await tempDir() });
    const created = await store.create(user, sample);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => store.commit(user, created.id, change(1, `w${i}`))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(7);
    for (const r of rejected)
      expect(r.reason).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    expect((await store.get(user, created.id))?.version).toBe(2);
  });

  it('serves concurrent service applies through automatic rebase', async () => {
    const registry = createRegistry({ kinds: [noteKind] });
    const service = createArtifactService({
      registry,
      store: createFsStore({ dir: await tempDir() }),
      commitRetries: 10,
    });
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'N',
      content: { items: [{ id: 'a', text: 'x' }] },
    });
    const applies = ['b', 'c', 'd'].map((id) =>
      service.apply(agent, {
        artifactId: artifact.id,
        baseVersion: 1,
        operations: [{ op: 'add', after: 'a', id, text: id }],
      }),
    );
    const results = await Promise.all(applies);
    expect(results.map((r) => r.version).sort()).toEqual([2, 3, 4]);
    const final = await service.get(agent, artifact.id);
    expect((final.content as { items: { id: string }[] }).items.map((i) => i.id).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('blocks path traversal and malformed ids', async () => {
    const store = createFsStore({ dir: await tempDir() });
    for (const id of ['../../etc', 'art_..', '..', 'art_01HZZZZZZZZZZZZZZZZZZZZZZ/x', '']) {
      expect(await store.get(user, id)).toBeNull();
      expect((await rejection(store.commit(user, id, change(1, 'x')))).code).toBe('NOT_FOUND');
      expect((await rejection(store.history(user, id, {}))).code).toBe('NOT_FOUND');
      expect((await rejection(store.lock(user, id, user.actor, 1000))).code).toBe('NOT_FOUND');
    }
  });

  it('isolates workspaces with unsafe names in separate directories', async () => {
    const dir = await tempDir();
    const store = createFsStore({ dir });
    const evil = { workspaceId: '../../escape', actor: user.actor };
    const created = await store.create(evil, sample);
    expect(await store.get(user, created.id)).toBeNull();
    expect((await store.list(otherWorkspace, {}, {})).items).toHaveLength(0);
    expect((await store.list(evil, {}, {})).items).toHaveLength(1);
    const workspaces = await readdir(join(dir, 'workspaces'));
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes snapshots on the first version and every N versions', async () => {
    const store = createFsStore({ dir: await tempDir(), snapshotEvery: 2 });
    const created = await store.create(user, sample);
    for (let v = 1; v <= 4; v++) await store.commit(user, created.id, change(v, `v${v + 1}`));
    const { items } = await store.history(user, created.id, {});
    expect(items.map((e) => [e.version, e.snapshot !== undefined])).toEqual([
      [5, false],
      [4, true],
      [3, false],
      [2, true],
      [1, true],
    ]);
    expect(items[1]?.snapshot?.content).toEqual({ items: [{ id: 'a', text: 'v4' }] });
  });

  it('paginates history with the same cursors as the memory store', async () => {
    const fs = createFsStore({ dir: await tempDir() });
    const memory = createMemoryStore();
    const a = await fs.create(user, sample);
    const b = await memory.create(user, sample);
    for (let v = 1; v <= 4; v++) {
      await fs.commit(user, a.id, change(v, `v${v}`));
      await memory.commit(user, b.id, change(v, `v${v}`));
    }
    for (const page of [
      { limit: 2 },
      { limit: 2, cursor: '2' },
      { limit: 2, cursor: '4' },
      { cursor: '9' },
      {},
    ]) {
      const fromFs = await fs.history(user, a.id, page);
      const fromMemory = await memory.history(user, b.id, page);
      expect(fromFs.items.map((e) => e.version)).toEqual(fromMemory.items.map((e) => e.version));
      expect(fromFs.nextCursor).toEqual(fromMemory.nextCursor);
    }
  });

  it('filters by status and tag and orders by update time like the memory store', async () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
    const fs = createFsStore({ dir: await tempDir(), now });
    const first = await fs.create(user, { ...sample, title: 'Alpha', tags: ['red'] });
    await fs.create(user, { ...sample, title: 'Beta', tags: ['blue'] });
    await fs.setStatus(user, first.id, 'archived', user.actor);
    expect((await fs.list(user, { status: 'archived' }, {})).items.map((s) => s.title)).toEqual(['Alpha']);
    expect((await fs.list(user, { tag: 'blue' }, {})).items.map((s) => s.title)).toEqual(['Beta']);
    expect((await fs.list(user, {}, {})).items.map((s) => s.title)).toEqual(['Alpha', 'Beta']);
  });

  it('keeps the status of superseded versions and of the head history entry', async () => {
    const store = createFsStore({ dir: await tempDir() });
    const created = await store.create(user, sample);
    await store.setStatus(user, created.id, 'published', user.actor);
    expect((await store.history(user, created.id, {})).items[0]?.status).toBe('published');
    await store.commit(user, created.id, change(1, 'next', { status: 'draft' }));
    const v1 = await store.get(user, created.id, { version: 1 });
    expect(v1).toMatchObject({ status: 'published', meta: { publishedVersion: 1 } });
    const head = await store.get(user, created.id);
    expect(head).toMatchObject({ status: 'draft', version: 2, meta: { publishedVersion: 1 } });
  });

  it('records idempotency keys from create and ignores records left by an interrupted commit', async () => {
    const dir = await tempDir();
    const store = createFsStore({ dir });
    const created = await store.create(user, { ...sample, idempotencyKey: 'create-1' });
    expect((await store.findByIdempotencyKey(user, created.id, 'create-1'))?.version).toBe(1);
    // Simulate a crash after the idempotency record was written but before head.json moved to v2.
    const [ws] = await readdir(join(dir, 'workspaces'));
    const idemDir = join(dir, 'workspaces', ws!, 'artifacts', created.id, 'idempotency');
    const [file] = await readdir(idemDir);
    await writeFile(join(idemDir, file!), JSON.stringify({ key: 'create-1', version: 2 }));
    expect(await store.findByIdempotencyKey(user, created.id, 'create-1')).toBeNull();
    expect((await rejection(store.findByIdempotencyKey(otherWorkspace, created.id, 'create-1'))).code).toBe(
      'NOT_FOUND',
    );
  });

  it('unlocks only with the matching token', async () => {
    const store = createFsStore({ dir: await tempDir() });
    const created = await store.create(user, sample);
    const lock = await store.lock(user, created.id, agent.actor, 60_000);
    await store.unlock(user, { ...lock, token: 'forged' });
    expect((await store.getLock(user, created.id))?.token).toBe(lock.token);
    expect((await rejection(store.unlock(otherWorkspace, lock))).code).toBe('NOT_FOUND');
    await store.unlock(user, lock);
    expect(await store.getLock(user, created.id)).toBeNull();
  });

  it('leaves no temporary files behind', async () => {
    const dir = await tempDir();
    const store = createFsStore({ dir });
    const created = await store.create(user, sample);
    await store.commit(user, created.id, change(1, 'two', { idempotencyKey: 'k' }));
    await store.lock(user, created.id, user.actor, 1000);
    const files = await readdir(dir, { recursive: true });
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
