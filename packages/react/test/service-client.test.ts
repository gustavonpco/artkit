import { ArtifactError } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { createServiceClient } from '../src/index.js';
import { agent, setup, user } from './helpers.js';

async function rejection(promise: Promise<unknown>): Promise<ArtifactError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected rejection');
}

describe('createServiceClient', () => {
  it('runs the full lifecycle through the in-process service', async () => {
    const { client, agentClient } = setup();
    const created = await agentClient.create({
      kind: 'note',
      title: 'Plan',
      content: { items: [{ id: 'a', text: 'one' }] },
    });
    const id = created.artifact.id;
    expect((await client.list({ kind: 'note' })).items.map((item) => item.id)).toEqual([id]);
    const applied = await client.apply(id, {
      baseVersion: 1,
      operations: [{ op: 'add', after: 'a', id: 'b', text: 'two' }],
    });
    expect(applied.version).toBe(2);
    expect((await client.get(id, { version: 1 })).version).toBe(1);
    expect((await client.read(id, { mode: 'full' })).text).toContain('two');
    const preview = await client.preview(id, { baseVersion: 2, operations: [{ op: 'remove', id: 'a' }] });
    expect(preview.diff).toEqual([expect.objectContaining({ type: 'removed', target: 'item:a' })]);
    expect((await client.history(id)).items.map((entry) => entry.version)).toEqual([2, 1]);
    const restored = await client.restore(id, 1);
    expect(restored.version).toBe(3);
    expect(restored.artifact.content).toEqual({ items: [{ id: 'a', text: 'one' }] });

    expect((await agentClient.setStatus(id, 'submit')).status).toBe('pending_approval');
    expect((await client.setStatus(id, 'reject', 'needs work')).status).toBe('draft');
    await agentClient.setStatus(id, 'submit');
    const approved = await client.setStatus(id, 'approve');
    expect(approved.status).toBe('published');
    expect(approved.meta.publishedVersion).toBe(3);
    expect((await client.setStatus(id, 'archive')).status).toBe('archived');

    const exported = await client.export(id, { format: 'md' });
    expect(new TextDecoder().decode(exported.bytes)).toBe('- one');
    expect(exported).toMatchObject({
      mimeType: 'text/markdown',
      filename: 'plan.md',
      warnings: ['note export is lossy'],
    });
  });

  it('surfaces core errors as ArtifactError and honors locks per scope', async () => {
    const { client, agentClient, service } = setup();
    const { artifact } = await agentClient.create({ kind: 'note', title: 'Locked' });
    const lock = await agentClient.lock(artifact.id, { ttlMs: 60_000 });
    const locked = await rejection(
      client.apply(artifact.id, { baseVersion: 1, operations: [{ op: 'add', text: 'x' }] }),
    );
    expect(locked.code).toBe('LOCKED');
    expect((await client.getLock(artifact.id))?.holder.type).toBe('agent');
    await agentClient.unlock(artifact.id, lock);
    expect(await client.getLock(artifact.id)).toBeNull();
    await expect(
      client.apply(artifact.id, { baseVersion: 1, operations: [{ op: 'add', text: 'x' }] }),
    ).resolves.toMatchObject({ version: 2 });

    expect((await rejection(client.get('missing'))).code).toBe('NOT_FOUND');
    expect((await rejection(client.setStatus(artifact.id, 'publish'))).code).toBe('APPROVAL_REQUIRED');
    expect((await rejection(client.setStatus(artifact.id, 'bogus' as 'submit'))).code).toBe(
      'INVALID_OPERATION',
    );

    // Scope can be resolved per call.
    let scope = user;
    const dynamic = createServiceClient(service, () => scope);
    await dynamic.get(artifact.id);
    scope = { ...agent, workspaceId: 'other' };
    expect((await rejection(dynamic.get(artifact.id))).code).toBe('NOT_FOUND');
  });

  it('wraps unexpected failures as INTERNAL_ERROR', async () => {
    const { service } = setup();
    const broken = createServiceClient({ ...service, get: () => Promise.reject(new Error('db down')) }, user);
    const error = await rejection(broken.get('a'));
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).not.toContain('db down');
    expect((error.cause as Error).message).toBe('db down');
  });
});
