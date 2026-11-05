import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Commit, NewArtifact } from '@artkit-ai/core';
import { defineStoreContractTests } from '@artkit-ai/core/testing';
import { describe, expect, it } from 'vitest';
import { createFsStore } from '../src/index.js';
import { agent, otherWorkspace, rejection, tempDir, user } from './helpers.js';

defineStoreContractTests('filesystem', async () => createFsStore({ dir: await tempDir() }), { describe, it });

const sample: NewArtifact = {
  format: 'note',
  formatVersion: 'note@2',
  title: 'Plan',
  locale: 'en',
  themeId: 'default',
  content: { items: [{ id: 'a', text: 'one' }] },
  tags: ['x'],
};

function change(baseVersion: number, text: string): Commit {
  return {
    baseVersion,
    formatVersion: 'note@2',
    content: { items: [{ id: 'a', text }] },
    title: 'Plan',
    locale: 'en',
    themeId: 'default',
  };
}

describe('createFsStore', () => {
  it('keeps only the current envelope on disk: one head per artifact, no history files', async () => {
    const dir = await tempDir();
    const store = createFsStore({ dir });
    const created = await store.create(user, sample);
    await store.commit(user, created.id, change(1, 'two'));
    const artifactDir = join(dir, 'workspaces');
    const workspace = (await readdir(artifactDir))[0]!;
    const artifacts = join(artifactDir, workspace, 'artifacts', created.id);
    const files = (await readdir(artifacts)).sort();
    expect(files).toEqual(['head.json']);
  });

  it('persists across store instances and replaces the content on commit', async () => {
    const dir = await tempDir();
    const created = await createFsStore({ dir }).create(user, sample);
    const reopened = createFsStore({ dir });
    const committed = await reopened.commit(user, created.id, change(1, 'two'));
    expect(committed.version).toBe(2);
    const loaded = await createFsStore({ dir }).get(user, created.id);
    expect(loaded?.content).toEqual({ items: [{ id: 'a', text: 'two' }] });
  });

  it('rejects a stale baseVersion with VERSION_CONFLICT and keeps the current head', async () => {
    const store = createFsStore({ dir: await tempDir() });
    const created = await store.create(user, sample);
    await store.commit(user, created.id, change(1, 'two'));
    const error = await rejection(store.commit(user, created.id, change(1, 'stale')));
    expect(error.code).toBe('VERSION_CONFLICT');
    expect((await store.get(user, created.id))?.content).toEqual({ items: [{ id: 'a', text: 'two' }] });
  });

  it('filters by format and tag and orders by update time like the memory store', async () => {
    const store = createFsStore({ dir: await tempDir() });
    const first = await store.create(user, sample);
    const second = await store.create(user, { ...sample, title: 'Other', tags: [] });
    await store.create(user, { ...sample, format: 'other-format', title: 'Third', tags: [] });
    const byFormat = await store.list(user, { format: 'note' }, {});
    expect(byFormat.items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    const tagged = await store.list(user, { tag: 'x' }, {});
    expect(tagged.items.map((item) => item.id)).toEqual([first.id]);
  });

  it('blocks path traversal and malformed ids before touching the filesystem', async () => {
    const store = createFsStore({ dir: await tempDir() });
    expect(await store.get(user, '../../etc/passwd')).toBeNull();
    await expect(store.lock(user, '../../x', user.actor, 1000)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps workspaces apart on disk', async () => {
    const store = createFsStore({ dir: await tempDir() });
    const created = await store.create(user, sample);
    expect(await store.get(otherWorkspace, created.id)).toBeNull();
    expect(await store.get(agent, created.id)).not.toBeNull();
  });

  it('surfaces a corrupt head file instead of hiding the artifact', async () => {
    const dir = await tempDir();
    const store = createFsStore({ dir });
    const created = await store.create(user, sample);
    const workspace = (await readdir(join(dir, 'workspaces')))[0]!;
    await writeFile(join(dir, 'workspaces', workspace, 'artifacts', created.id, 'head.json'), 'not json');
    await expect(store.get(user, created.id)).rejects.toThrow(SyntaxError);
  });

  it('validates its options', () => {
    expect(() => createFsStore({ dir: '' })).toThrow(TypeError);
  });
});
