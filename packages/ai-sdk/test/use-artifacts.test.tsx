// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { deriveArtifacts } from '../src/index.js';
import { type PreviewRegistry, useArtifacts } from '../src/react/index.js';

const ref = (version: number) => ({
  id: 'art_A',
  format: 'note',
  title: 'Plan',
  version,
});

// Drops items whose text has not streamed yet, like a format's parsePartial.
const registry: PreviewRegistry = {
  has: (format) => format === 'note',
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
      input: { format: 'note', title: 'Plan' },
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
      input: { format: 'note', title: 'Draft', content: { items: [{ id: 'a', text: 'he' }, { id: 'b' }] } },
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
  it('derives committed versions and previews from message parts, without status or approvals', () => {
    const derived = deriveArtifacts(history, { registry });
    expect(derived.artifacts.map((state) => state.key)).toEqual(['art_A', 'call:c4']);
    const artifact = derived.byId.art_A!;
    expect(artifact).toMatchObject({ id: 'art_A', format: 'note', version: 2, committed: ref(2) });
    expect(artifact).not.toHaveProperty('status');
    expect(artifact).not.toHaveProperty('approval');
    expect(artifact.preview).toMatchObject({
      toolCallId: 'c3',
      toolName: 'artifact_apply',
      operations: [{ op: 'add', text: 'x' }],
    });
    const draft = derived.artifacts[1]!;
    expect(draft.id).toBeUndefined();
    expect(draft.preview).toMatchObject({
      format: 'note',
      title: 'Draft',
      content: { items: [{ id: 'a', text: 'he' }] },
    });
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
});

describe('useArtifacts', () => {
  it('exposes the derived map and follows new committed versions', () => {
    const { result, rerender } = renderHook(({ list }) => useArtifacts(list, { registry }), {
      initialProps: { list: history },
    });
    expect(result.current.byId.art_A?.version).toBe(2);
    const first = result.current;
    rerender({ list: history });
    expect(result.current).toBe(first);
    rerender({ list: [...history, ...messages([{ type: 'data-artifact', id: 'art_A', data: ref(3) }])] });
    expect(result.current.byId.art_A?.version).toBe(3);
  });
});
