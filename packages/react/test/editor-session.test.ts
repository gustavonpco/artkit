import { type Artifact, ArtifactError, type CommitResult } from '@artkit-ai/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ArtifactClient,
  EditorSession,
  type EditorSessionOptions,
  operationsBetween,
  type SendRequest,
} from '../src/index.js';
import { type NoteContent, setup } from './helpers.js';

const texts = (content: unknown) => (content as NoteContent).items.map((item) => item.text);

async function start(
  items: { id: string; text: string }[] = [
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'beta' },
  ],
) {
  const env = setup();
  const created = await env.agentClient.create({ kind: 'note', title: 'Notes', content: { items } });
  return { ...env, artifact: created.artifact };
}

function session(
  registry: EditorSessionOptions['registry'],
  client: ArtifactClient,
  artifact: Artifact,
  extra: Partial<EditorSessionOptions> = {},
) {
  const sent: SendRequest[] = [];
  const committed: CommitResult[] = [];
  let key = 0;
  const instance = new EditorSession({
    registry,
    artifact,
    send: (request) => {
      sent.push(request);
      return client.apply(artifact.id, request);
    },
    load: (version) => client.get(artifact.id, version === undefined ? undefined : { version }),
    createKey: () => `k${++key}`,
    onCommitted: (result) => committed.push(result),
    ...extra,
  });
  return { session: instance, sent, committed };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EditorSession batching', () => {
  it('coalesces typing within the window and applies optimistically', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    expect(s.emit([{ op: 'edit', id: 'a', text: 'a' }], { kind: 'typing' })).toBe(true);
    s.emit([{ op: 'edit', id: 'a', text: 'al' }], { kind: 'typing' });
    expect(texts(s.getSnapshot().view.content)).toEqual(['al', 'beta']);
    expect(s.getSnapshot()).toMatchObject({ status: 'editing', dirty: true, canUndo: true, canRedo: false });

    await vi.advanceTimersByTimeAsync(400);
    s.emit([{ op: 'edit', id: 'a', text: 'alp' }], { kind: 'typing' });
    await vi.advanceTimersByTimeAsync(599);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await s.whenIdle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      baseVersion: 1,
      idempotencyKey: 'k1',
      operations: [
        { op: 'edit', id: 'a', text: 'a' },
        { op: 'edit', id: 'a', text: 'al' },
        { op: 'edit', id: 'a', text: 'alp' },
      ],
    });
    const state = s.getSnapshot();
    expect(state).toMatchObject({ status: 'idle', dirty: false });
    expect(state.confirmed.version).toBe(2);
    expect(state.event).toMatchObject({ type: 'saved', version: 2 });
  });

  it('flushes discrete operations immediately, after pending typing, as separate batches', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'typed' }], { kind: 'typing' });
    s.emit([{ op: 'add', after: 'b', id: 'c', text: 'gamma' }]);
    s.emit([{ op: 'remove', id: 'b' }], { kind: 'continuous' });
    expect(texts(s.getSnapshot().view.content)).toEqual(['typed', 'gamma']);
    await s.whenIdle();
    expect(sent.map((request) => [request.baseVersion, request.operations.length])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(s.getSnapshot().confirmed.version).toBe(4);
    expect(texts(s.getSnapshot().confirmed.content)).toEqual(['typed', 'gamma']);
  });

  it('caps a typing batch with maxGroupingMs and flush()', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact, {
      groupingWindowMs: 500,
      maxGroupingMs: 1200,
    });
    for (let i = 1; i <= 4; i++) {
      s.emit([{ op: 'edit', id: 'a', text: `v${i}` }], { kind: 'typing' });
      await vi.advanceTimersByTimeAsync(400);
    }
    await s.whenIdle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.operations).toHaveLength(4);

    s.emit([{ op: 'edit', id: 'b', text: 'now' }], { kind: 'typing' });
    s.flush();
    await s.whenIdle();
    expect(sent).toHaveLength(2);
  });

  it('rejects locally invalid operations without sending them', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    expect(s.emit([{ op: 'edit', id: 'missing', text: 'x' }])).toBe(false);
    expect(s.emit([])).toBe(false);
    const state = s.getSnapshot();
    expect(state.error?.code).toBe('OPERATION_FAILED');
    expect(state.event?.type).toBe('rejected');
    expect(texts(state.view.content)).toEqual(['alpha', 'beta']);
    expect(sent).toHaveLength(0);
    s.dismissError();
    expect(s.getSnapshot().error).toBeUndefined();
  });
});

describe('EditorSession rollback and locks', () => {
  it('rolls back every unconfirmed operation when the server rejects a batch', async () => {
    const { registry, artifact } = await start();
    const send = vi.fn(async () => {
      throw new ArtifactError('PERMISSION_DENIED', 'Action "apply" denied.');
    });
    const s = new EditorSession({ registry, artifact, send, load: async () => artifact });
    s.emit([{ op: 'edit', id: 'a', text: 'x' }]);
    s.emit([{ op: 'edit', id: 'b', text: 'y' }], { kind: 'typing' });
    expect(texts(s.getSnapshot().view.content)).toEqual(['x', 'y']);
    await s.whenIdle();
    const state = s.getSnapshot();
    expect(send).toHaveBeenCalledTimes(1);
    expect(texts(state.view.content)).toEqual(['alpha', 'beta']);
    expect(state.error?.code).toBe('PERMISSION_DENIED');
    expect(state.event?.type).toBe('rolled_back');
    expect(state.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('turns read-only after LOCKED until the lock expires', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const lock = await agentClient.lock(artifact.id, { ttlMs: 10_000 });
    const { session: s } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'x' }]);
    await s.whenIdle();
    let state = s.getSnapshot();
    expect(state.error?.code).toBe('LOCKED');
    expect(state.lockedUntil).toBe(lock.expiresAt);
    expect(state.canUndo).toBe(false);
    expect(s.emit([{ op: 'edit', id: 'a', text: 'y' }])).toBe(false);

    await agentClient.unlock(artifact.id, lock);
    await vi.advanceTimersByTimeAsync(10_001);
    state = s.getSnapshot();
    expect(state.lockedUntil).toBeUndefined();
    expect(s.emit([{ op: 'edit', id: 'a', text: 'z' }])).toBe(true);
    await s.whenIdle();
    expect(texts(s.getSnapshot().confirmed.content)).toEqual(['z', 'beta']);
  });
});

describe('EditorSession undo and redo', () => {
  it('undoes and redoes the user batches as new versions', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'one' }]);
    s.emit([{ op: 'set_title', title: 'Renamed' }]);
    await s.whenIdle();
    expect(s.getSnapshot().confirmed.version).toBe(3);

    s.undo();
    await s.whenIdle();
    let state = s.getSnapshot();
    expect(state.confirmed).toMatchObject({ version: 4, title: 'Notes' });
    expect(sent[2]?.operations).toEqual([{ op: 'set_title', title: 'Notes' }]);
    expect(state.event).toMatchObject({ type: 'undone', version: 4 });

    s.undo();
    await s.whenIdle();
    state = s.getSnapshot();
    expect(state.confirmed.version).toBe(5);
    expect(texts(state.confirmed.content)).toEqual(['alpha', 'beta']);
    expect(sent[3]?.operations).toEqual([
      {
        op: 'replace_content',
        content: {
          items: [
            { id: 'a', text: 'alpha' },
            { id: 'b', text: 'beta' },
          ],
        },
      },
    ]);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);

    s.redo();
    await s.whenIdle();
    expect(texts(s.getSnapshot().confirmed.content)).toEqual(['one', 'beta']);
    expect(s.getSnapshot().event).toMatchObject({ type: 'redone', version: 6 });

    // A new edit clears the redo stack.
    s.emit([{ op: 'edit', id: 'b', text: 'two' }]);
    expect(s.getSnapshot().canRedo).toBe(false);
    await s.whenIdle();
  });

  it('undo while typing sends the typing batch first, then reverts it', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'draft' }], { kind: 'typing' });
    s.undo();
    await s.whenIdle();
    expect(sent).toHaveLength(2);
    expect(texts(s.getSnapshot().confirmed.content)).toEqual(['alpha', 'beta']);
    expect(s.getSnapshot().confirmed.version).toBe(3);
  });

  it('reports a conflict instead of undoing over a newer agent version', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'mine' }]);
    await s.whenIdle();
    const agentCommit = await agentClient.apply(artifact.id, {
      baseVersion: 2,
      operations: [{ op: 'edit', id: 'b', text: 'agent' }],
    });
    s.receive(agentCommit.artifact);
    expect(s.getSnapshot().event).toMatchObject({ type: 'rebased', version: 3 });

    s.undo();
    await s.whenIdle();
    let state = s.getSnapshot();
    expect(state.status).toBe('conflict');
    expect(state.conflict).toMatchObject({
      reason: 'undo',
      changes: [expect.objectContaining({ target: 'item:b' })],
    });
    expect(sent).toHaveLength(1);
    expect(s.emit([{ op: 'edit', id: 'a', text: 'blocked' }])).toBe(false);

    s.resolveConflict('reapply');
    await s.whenIdle();
    state = s.getSnapshot();
    expect(state.conflict).toBeUndefined();
    expect(texts(state.confirmed.content)).toEqual(['alpha', 'beta']);
    expect(state.confirmed.version).toBe(4);
  });

  it('keeps the agent version when the undo conflict is resolved that way', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'mine' }]);
    await s.whenIdle();
    const agentCommit = await agentClient.apply(artifact.id, {
      baseVersion: 2,
      operations: [{ op: 'edit', id: 'a', text: 'agent' }],
    });
    s.receive(agentCommit.artifact);
    s.undo();
    await s.whenIdle();
    s.resolveConflict('keep-theirs');
    await s.whenIdle();
    const state = s.getSnapshot();
    expect(sent).toHaveLength(1);
    expect(texts(state.view.content)).toEqual(['agent', 'beta']);
    expect(state.canUndo).toBe(false);
    expect(state.event).toMatchObject({ type: 'conflict_resolved', choice: 'keep-theirs' });
  });

  it('undoes a rebased commit to the server version before it, keeping the agent change', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s } = session(registry, client, artifact);
    // The agent commits v2 behind the session's back; the user's batch is rebased by the server.
    await agentClient.apply(artifact.id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'b', text: 'agent' }],
    });
    s.emit([{ op: 'edit', id: 'a', text: 'mine' }]);
    await s.whenIdle();
    expect(texts(s.getSnapshot().confirmed.content)).toEqual(['mine', 'agent']);
    s.undo();
    await s.whenIdle();
    const state = s.getSnapshot();
    expect(state.confirmed.version).toBe(4);
    expect(texts(state.confirmed.content)).toEqual(['alpha', 'agent']);
  });

  it('builds envelope operations between two states', () => {
    const from = { content: { items: [] }, title: 'A', themeId: 'default', locale: 'en' };
    expect(operationsBetween(from, { ...from })).toEqual([]);
    expect(
      operationsBetween(from, {
        content: { items: [{ id: 'x', text: 'y' }] },
        title: 'B',
        themeId: 'dark',
        locale: 'pt-BR',
      }),
    ).toEqual([
      { op: 'replace_content', content: { items: [{ id: 'x', text: 'y' }] } },
      { op: 'set_title', title: 'B' },
      { op: 'set_theme', themeId: 'dark' },
      { op: 'set_locale', locale: 'pt-BR' },
    ]);
  });
});

describe('EditorSession concurrency with the agent', () => {
  it('shows the server conflict and reapplies the local edit on request', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    await agentClient.apply(artifact.id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'agent' }],
    });
    s.emit([{ op: 'edit', id: 'a', text: 'mine' }]);
    s.emit([{ op: 'edit', id: 'b', text: 'queued' }], { kind: 'typing' });
    await s.whenIdle();

    let state = s.getSnapshot();
    expect(state.status).toBe('conflict');
    expect(state.conflict?.reason).toBe('server');
    expect(state.conflict?.changes).toEqual([expect.objectContaining({ type: 'changed', target: 'item:a' })]);
    expect(state.conflict?.operations).toEqual([
      { op: 'edit', id: 'a', text: 'mine' },
      { op: 'edit', id: 'b', text: 'queued' },
    ]);
    expect(state.confirmed.version).toBe(2);
    expect(texts(state.view.content)).toEqual(['agent', 'beta']);

    s.resolveConflict('reapply');
    expect(texts(s.getSnapshot().view.content)).toEqual(['mine', 'queued']);
    await s.whenIdle();
    state = s.getSnapshot();
    expect(sent.at(-1)?.baseVersion).toBe(2);
    expect(state.confirmed.version).toBe(3);
    expect(texts(state.confirmed.content)).toEqual(['mine', 'queued']);
  });

  it('drops the local edit when keeping the agent version', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    await agentClient.apply(artifact.id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'agent' }],
    });
    s.emit([{ op: 'edit', id: 'a', text: 'mine' }]);
    await s.whenIdle();
    s.resolveConflict('keep-theirs');
    await s.whenIdle();
    expect(sent).toHaveLength(1);
    expect(texts(s.getSnapshot().view.content)).toEqual(['agent', 'beta']);
    expect(s.getSnapshot().status).toBe('idle');
  });

  it('rebases pending typing on a newer version that touches other items', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'mine' }], { kind: 'typing' });
    const agentCommit = await agentClient.apply(artifact.id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'b', text: 'agent' }],
    });
    s.receive(agentCommit.artifact);
    expect(texts(s.getSnapshot().view.content)).toEqual(['mine', 'agent']);
    s.flush();
    await s.whenIdle();
    expect(sent[0]?.baseVersion).toBe(2);
    expect(texts(s.getSnapshot().confirmed.content)).toEqual(['mine', 'agent']);
  });

  it('moves pending operations into a rebase conflict when they no longer apply', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'b', text: 'mine' }], { kind: 'typing' });
    const agentCommit = await agentClient.apply(artifact.id, {
      baseVersion: 1,
      operations: [{ op: 'remove', id: 'b' }],
    });
    s.receive(agentCommit.artifact);
    let state = s.getSnapshot();
    expect(state.conflict).toMatchObject({
      reason: 'rebase',
      operations: [{ op: 'edit', id: 'b', text: 'mine' }],
    });
    expect(state.conflict?.changes).toEqual([expect.objectContaining({ type: 'removed', target: 'item:b' })]);
    expect(texts(state.view.content)).toEqual(['alpha']);

    // Reapplying is impossible: the item is gone. The error is shown and nothing is sent.
    s.resolveConflict('reapply');
    state = s.getSnapshot();
    expect(state.error?.code).toBe('OPERATION_FAILED');
    expect(state.conflict).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(0);
  });

  it('defers a remote version that arrives while a batch is in flight', async () => {
    const { registry, client, agentClient, artifact } = await start();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { session: s } = session(registry, client, artifact, {
      send: async (request) => {
        await gate;
        return client.apply(artifact.id, request);
      },
    });
    s.emit([{ op: 'add', after: 'b', id: 'c', text: 'gamma' }]);
    const agentCommit = await agentClient.apply(artifact.id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'agent' }],
    });
    s.receive(agentCommit.artifact);
    // Not applied yet: the optimistic view still shows exactly one "gamma".
    expect(texts(s.getSnapshot().view.content)).toEqual(['alpha', 'beta', 'gamma']);
    release?.();
    await s.whenIdle();
    const state = s.getSnapshot();
    expect(state.confirmed.version).toBe(3);
    expect(texts(state.view.content)).toEqual(['agent', 'beta', 'gamma']);
  });

  it('ignores stale versions and updates the status of the same version', async () => {
    const { registry, client, agentClient, artifact } = await start();
    const { session: s } = session(registry, client, artifact);
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);
    s.receive({ ...artifact, version: 0 });
    expect(listener).not.toHaveBeenCalled();
    const submitted = await agentClient.setStatus(artifact.id, 'submit');
    s.receive(submitted);
    expect(s.getSnapshot().confirmed.status).toBe('pending_approval');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('flushes buffered typing on dispose', async () => {
    const { registry, client, artifact } = await start();
    const { session: s, sent } = session(registry, client, artifact);
    s.emit([{ op: 'edit', id: 'a', text: 'last words' }], { kind: 'typing' });
    s.dispose();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(s.emit([{ op: 'edit', id: 'a', text: 'after' }])).toBe(false);
  });
});
