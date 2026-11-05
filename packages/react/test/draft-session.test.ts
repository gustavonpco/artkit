import { describe, expect, it } from 'vitest';
import { DraftSession } from '../src/index.js';
import { setup, user } from './helpers.js';

async function startDraft(content?: { items: { id: string; text: string }[] }) {
  const { service, registry } = setup();
  const created = await service.create(user, {
    format: 'note',
    title: 'Plan',
    content: content ?? { items: [{ id: 'a', text: 'one' }] },
  });
  let clock = 0;
  const draft = new DraftSession({ registry, artifact: created.artifact, now: () => clock });
  return { draft, artifact: created.artifact, service, tick: (ms: number) => (clock += ms) };
}

const texts = (draft: DraftSession) =>
  (draft.getSnapshot().artifact.content as { items: { text: string }[] }).items.map((item) => item.text);

describe('DraftSession', () => {
  it('applies batches locally: the draft changes, the base version does not, and nothing is sent', async () => {
    const { draft, artifact, service } = await startDraft();
    const before = await service.get(user, artifact.id);
    expect(await draft.apply([{ op: 'edit', id: 'a', text: 'two' }])).toBe(true);
    const snapshot = draft.getSnapshot();
    expect(texts(draft)).toEqual(['two']);
    expect(snapshot).toMatchObject({ baseVersion: 1, dirty: true, canUndo: true, canRedo: false });
    expect(snapshot.operations).toEqual([{ op: 'edit', id: 'a', text: 'two' }]);
    // The store still holds the version the draft started from.
    expect((await service.get(user, artifact.id)).content).toEqual(before.content);
  });

  it('rejects an invalid batch: the draft stays, the error is reported and the next valid batch clears it', async () => {
    const { draft } = await startDraft();
    expect(await draft.apply([{ op: 'remove', id: 'missing' }])).toBe(false);
    expect(texts(draft)).toEqual(['one']);
    expect(draft.getSnapshot().error).toMatchObject({ code: 'OPERATION_FAILED' });
    expect(await draft.apply([{ op: 'edit', id: 'a', text: 'ok' }])).toBe(true);
    expect(draft.getSnapshot().error).toBeUndefined();
  });

  it('undoes and redoes locally, and a new edit clears the redo stack', async () => {
    const { draft, tick } = await startDraft();
    await draft.apply([{ op: 'edit', id: 'a', text: 'two' }]);
    tick(5000);
    await draft.apply([{ op: 'edit', id: 'a', text: 'three' }]);
    expect(draft.undo()).toBe(true);
    expect(texts(draft)).toEqual(['two']);
    expect(draft.redo()).toBe(true);
    expect(texts(draft)).toEqual(['three']);
    draft.undo();
    await draft.apply([{ op: 'edit', id: 'a', text: 'other' }]);
    expect(draft.getSnapshot().canRedo).toBe(false);
  });

  it('groups consecutive typing batches into one undo step', async () => {
    const { draft, tick } = await startDraft();
    await draft.apply([{ op: 'edit', id: 'a', text: 'o' }], { kind: 'typing' });
    tick(200);
    await draft.apply([{ op: 'edit', id: 'a', text: 'on' }], { kind: 'typing' });
    tick(200);
    await draft.apply([{ op: 'edit', id: 'a', text: 'one!' }], { kind: 'typing' });
    draft.undo();
    expect(texts(draft)).toEqual(['one']);
    expect(draft.getSnapshot().canUndo).toBe(false);
  });

  it('follows a clean draft to a newer artifact saved by the application', async () => {
    const { draft, artifact, service } = await startDraft();
    const saved = await service.apply(user, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'saved' }],
    });
    draft.load(saved.artifact);
    expect(draft.getSnapshot()).toMatchObject({ baseVersion: 2, dirty: false, canUndo: false });
    expect(texts(draft)).toEqual(['saved']);
  });

  it('keeps unsaved edits when a newer artifact arrives, and moves the base to it', async () => {
    const { draft, artifact, service } = await startDraft();
    await draft.apply([{ op: 'edit', id: 'a', text: 'mine' }]);
    const other = await service.apply(user, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'add', id: 'b', text: 'theirs' }],
    });
    draft.load(other.artifact);
    expect(texts(draft)).toEqual(['mine']);
    expect(draft.getSnapshot()).toMatchObject({ baseVersion: 2, dirty: true });
  });
});
