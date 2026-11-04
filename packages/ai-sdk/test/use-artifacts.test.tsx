// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { deriveArtifacts } from '../src/index.js';
import { type PreviewRegistry, useArtifacts } from '../src/react/index.js';

const ref = (version: number, status = 'draft') => ({
  id: 'art_A',
  kind: 'note',
  title: 'Plan',
  version,
  status,
});

// Drops items whose text has not streamed yet, like a kind's parsePartial.
const registry: PreviewRegistry = {
  has: (kind) => kind === 'note',
  get: () => ({
    parsePartial: (raw) => ({
      items: ((raw as { items?: { text?: unknown }[] }).items ?? []).filter(
        (item) => typeof item?.text === 'string',
      ),
    }),
  }),
};

function messages(...parts: unknown[][]): UIMessage[] {
  return parts.map((list, index) => ({
    id: `m${index}`,
    role: 'assistant',
    parts: list as UIMessage['parts'],
  }));
}

const history = messages(
  [
    {
      type: 'tool-artifact_create',
      toolCallId: 'c1',
      state: 'output-available',
      input: { kind: 'note', title: 'Plan' },
      output: { ok: true, ...ref(1) },
    },
    { type: 'data-artifact', id: 'art_A', data: ref(1) },
  ],
  [
    { type: 'data-artifact', id: 'art_A', data: ref(2) },
    {
      type: 'tool-artifact_apply',
      toolCallId: 'c3',
      state: 'input-streaming',
      input: { id: 'art_A', baseVersion: 2, operations: [{ op: 'add', text: 'x' }, { op: 'ed' }] },
    },
    {
      type: 'tool-artifact_create',
      toolCallId: 'c4',
      state: 'input-streaming',
      input: { kind: 'note', title: 'Draft', content: { items: [{ id: 'a', text: 'he' }, { id: 'b' }] } },
    },
    {
      type: 'tool-artifact_submit',
      toolCallId: 'c5',
      state: 'approval-requested',
      input: { id: 'art_A' },
      approval: { id: 'ap-1', requestReason: 'Publishing needs review' },
    },
    {
      type: 'tool-weather',
      toolCallId: 'w1',
      state: 'output-available',
      input: {},
      output: { ok: true, ...ref(9) },
    },
  ],
);

describe('deriveArtifacts', () => {
  it('derives committed versions, previews and approvals from message parts', () => {
    const derived = deriveArtifacts(history, { registry });
    expect(derived.artifacts.map((state) => state.key)).toEqual(['art_A', 'call:c4']);
    const artifact = derived.byId.art_A!;
    expect(artifact).toMatchObject({
      id: 'art_A',
      kind: 'note',
      version: 2,
      status: 'draft',
      committed: ref(2),
    });
    expect(artifact.preview).toMatchObject({
      toolCallId: 'c3',
      toolName: 'artifact_apply',
      operations: [{ op: 'add', text: 'x' }],
    });
    expect(artifact.approval).toMatchObject({
      approvalId: 'ap-1',
      state: 'approval-requested',
      toolName: 'artifact_submit',
      requestReason: 'Publishing needs review',
    });
    const draft = derived.artifacts[1]!;
    expect(draft.id).toBeUndefined();
    expect(draft.preview).toMatchObject({
      kind: 'note',
      title: 'Draft',
      content: { items: [{ id: 'a', text: 'he' }] },
    });
    expect(derived.pendingApprovals.map((approval) => approval.approvalId)).toEqual(['ap-1']);
  });

  it('keeps only complete operations while an apply is streaming', () => {
    const derived = deriveArtifacts(history.slice(0, 1).concat(messages([history[1]!.parts[1]!])));
    expect(derived.byId.art_A!.preview).toMatchObject({
      toolName: 'artifact_apply',
      state: 'input-streaming',
      baseVersion: 2,
      operations: [{ op: 'add', text: 'x' }],
    });
  });

  it('tracks decisions, denials, errors and status changes at the same version', () => {
    const derived = deriveArtifacts(
      messages(
        [{ type: 'data-artifact', id: 'art_A', data: ref(1) }],
        [
          {
            type: 'tool-artifact_apply',
            toolCallId: 'c2',
            state: 'output-available',
            input: { id: 'art_A', baseVersion: 1, operations: [] },
            output: { ok: false, error: { code: 'VERSION_CONFLICT', message: 'changed' } },
          },
        ],
        [
          {
            type: 'tool-artifact_submit',
            toolCallId: 'c3',
            state: 'approval-responded',
            input: { id: 'art_A' },
            approval: { id: 'ap-2', approved: true },
          },
        ],
      ),
    );
    expect(derived.byId.art_A).toMatchObject({
      error: { code: 'VERSION_CONFLICT', toolCallId: 'c2' },
      approval: { approvalId: 'ap-2', state: 'approved' },
    });
    expect(derived.pendingApprovals).toEqual([]);
    const done = deriveArtifacts(
      messages([
        { type: 'data-artifact', id: 'art_A', data: ref(1) },
        {
          type: 'tool-artifact_submit',
          toolCallId: 'c3',
          state: 'output-available',
          input: { id: 'art_A' },
          output: { ok: true, ...ref(1, 'pending_approval') },
          approval: { id: 'ap-2', approved: true },
        },
        {
          type: 'tool-artifact_apply',
          toolCallId: 'c4',
          state: 'output-denied',
          input: { id: 'art_A' },
          approval: { id: 'ap-3', approved: false, reason: 'no' },
        },
        { type: 'data-artifact', id: 'art_A', data: ref(0) },
      ]),
    );
    expect(done.byId.art_A).toMatchObject({
      status: 'pending_approval',
      version: 1,
      approval: { approvalId: 'ap-3', state: 'rejected', reason: 'no' },
    });
  });
});

describe('useArtifacts', () => {
  it('exposes the derived map and binds approve/reject to addToolApprovalResponse', async () => {
    const addToolApprovalResponse = vi.fn();
    const { result, rerender } = renderHook(
      ({ list }) => useArtifacts(list, { registry, addToolApprovalResponse }),
      { initialProps: { list: history } },
    );
    expect(result.current.byId.art_A?.version).toBe(2);
    expect(result.current.pendingApprovals).toHaveLength(1);
    await act(() => result.current.approve('ap-1'));
    expect(addToolApprovalResponse).toHaveBeenLastCalledWith({ id: 'ap-1', approved: true });
    await act(() => result.current.reject('ap-1', 'Not yet'));
    expect(addToolApprovalResponse).toHaveBeenLastCalledWith({
      id: 'ap-1',
      approved: false,
      reason: 'Not yet',
    });
    const first = result.current;
    rerender({ list: history });
    expect(result.current).toBe(first);
    rerender({ list: [...history, ...messages([{ type: 'data-artifact', id: 'art_A', data: ref(3) }])] });
    expect(result.current.byId.art_A?.version).toBe(3);
  });

  it('fails loudly when approvals cannot be answered', async () => {
    const { result } = renderHook(() => useArtifacts(history));
    await expect(result.current.approve('ap-1')).rejects.toThrow(/addToolApprovalResponse/);
  });
});
