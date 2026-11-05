import { ArtifactError } from '@artkit-ai/core';
import { describe, expect, it } from 'vitest';
import { createServiceClient } from '../src/index.js';
import { setup, user } from './helpers.js';

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
  it('runs the lifecycle through the in-process service', async () => {
    const { client, agentClient } = setup();
    const created = await agentClient.create({
      format: 'note',
      title: 'Plan',
      content: { items: [{ id: 'a', text: 'one' }] },
    });
    const id = created.artifact.id;
    expect((await client.list({ format: 'note' })).items.map((item) => item.id)).toEqual([id]);
    const applied = await client.apply(id, {
      baseVersion: 1,
      operations: [{ op: 'add', after: 'a', id: 'b', text: 'two' }],
    });
    expect(applied.version).toBe(2);
    expect((await client.get(id)).content).toEqual({
      items: [
        { id: 'a', text: 'one' },
        { id: 'b', text: 'two' },
      ],
    });
    expect((await client.read(id, { mode: 'full' })).text).toContain('two');
    const preview = await client.preview(id, {
      baseVersion: 2,
      operations: [{ op: 'edit', id: 'a', text: 'x' }],
    });
    expect(preview.content).toEqual({
      items: [
        { id: 'a', text: 'x' },
        { id: 'b', text: 'two' },
      ],
    });
    expect((await client.get(id)).version).toBe(2);
  });

  it('surfaces core errors as ArtifactError and honors locks per scope', async () => {
    const { client, agentClient } = setup();
    const created = await client.create({
      format: 'note',
      title: 'T',
      content: { items: [{ id: 'a', text: 'x' }] },
    });
    const id = created.artifact.id;
    await expect(
      client.apply(id, { baseVersion: 1, operations: [{ op: 'remove', id: 'missing' }] }),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
    await expect(client.apply(id, { baseVersion: 9, operations: [] })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    await expect(client.get('art_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const lock = await client.lock(id, { ttlMs: 60_000 });
    const batch = { baseVersion: 1, operations: [{ op: 'add', id: 'z', text: 'z' }] };
    await expect(agentClient.apply(id, batch)).rejects.toMatchObject({ code: 'LOCKED' });
    await client.unlock(id, lock);
    expect((await agentClient.apply(id, batch)).version).toBe(2);
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
