import { createArtifactToolkit } from '@artkit-ai/agent';
import { createMemoryStore, createRegistry, type Scope } from '@artkit-ai/core';
import { describe, expect, it } from 'vitest';
import {
  type ArtifactDataPart,
  artifactContextSchema,
  artifactInstructions,
  artifactTools,
  artifactToolsContext,
  writeArtifactDataPart,
} from '../src/index.js';
import { noteFormat } from './note-format.js';

const scope: Scope = { workspaceId: 'ws-1', actor: { type: 'agent', id: 'a1' } };

function setup(options: Partial<Parameters<typeof createArtifactToolkit>[0]> = {}) {
  const registry = createRegistry({ formats: [noteFormat] });
  return createArtifactToolkit({
    registry,
    store: createMemoryStore(),
    authorize: () => true,
    ...options,
  } as Parameters<typeof createArtifactToolkit>[0]);
}

const execOptions = (context: unknown, toolCallId = 'call-1') =>
  ({ toolCallId, messages: [], context }) as never;

describe('artifactTools', () => {
  it('keeps names, descriptions and JSON Schemas of the neutral toolkit', async () => {
    const toolkit = setup();
    const tools = artifactTools(toolkit);
    expect(Object.keys(tools)).toEqual(toolkit.tools.map((tool) => tool.name));
    for (const neutral of toolkit.tools) {
      const converted = tools[neutral.name]!;
      expect(converted.description).toBe(neutral.description);
      expect(await (converted.inputSchema as { jsonSchema: unknown }).jsonSchema).toEqual(
        neutral.inputSchema,
      );
      expect(converted.contextSchema).toBe(artifactContextSchema);
    }
    expect(Object.keys(artifactTools(toolkit, { include: ['artifact_read'] }))).toEqual(['artifact_read']);
  });

  it('executes with scope and data parts from the tool context', async () => {
    const toolkit = setup();
    const tools = artifactTools(toolkit);
    const written: { type: string; id: string; data: ArtifactDataPart }[] = [];
    const context = { ...scope, writer: { write: (part: (typeof written)[number]) => written.push(part) } };
    const create = tools.artifact_create!.execute!;
    const input = {
      format: 'note',
      title: 'T',
      workspaceId: 'other',
      content: { items: [{ id: 'a', text: 'x' }] },
    };
    const first = (await create(input, execOptions(context))) as { id: string; ok: boolean };
    expect(first.ok).toBe(true);
    expect(written).toEqual([
      {
        type: 'data-artifact',
        id: first.id,
        data: { id: first.id, format: 'note', title: 'T', version: 1 },
      },
    ]);
    const apply = tools.artifact_apply!.execute!;
    const error = (await apply(
      { id: first.id, baseVersion: 1, operations: [{ op: 'nope' }] },
      execOptions(context, 'call-2'),
    )) as { ok: boolean; error: { code: string } };
    expect(error).toMatchObject({ ok: false, error: { code: 'INVALID_OPERATION' } });
    const quiet = artifactTools(toolkit, { dataParts: false });
    await quiet.artifact_apply!.execute!(
      { id: first.id, baseVersion: 1, operations: [{ op: 'remove', id: 'a' }] },
      execOptions(context, 'call-3'),
    );
    expect(written).toHaveLength(1);
    expect((await toolkit.service.list({ workspaceId: 'other', actor: scope.actor })).items).toEqual([]);
  });

  it('validates the context schema', () => {
    expect(artifactContextSchema.safeParse({ ...scope }).success).toBe(true);
    expect(artifactContextSchema.safeParse({ ...scope, writer: {} }).success).toBe(false);
    expect(artifactContextSchema.safeParse({ workspaceId: '', actor: scope.actor }).success).toBe(false);
  });

  it('marks tools strict under the strict profile', () => {
    const toolkit = setup({ schemaProfile: 'strict' });
    const tools = artifactTools(toolkit);
    expect((tools.artifact_read as { strict?: boolean }).strict).toBe(true);
    expect(tools).not.toHaveProperty('artifact_submit');
  });
});

describe('helpers', () => {
  it('builds toolsContext for every tool and forwards instructions', () => {
    const toolkit = setup();
    const tools = artifactTools(toolkit);
    const context = artifactToolsContext(tools, scope);
    expect(Object.keys(context)).toEqual(Object.keys(tools));
    expect(context.artifact_create).toBe(scope);
    expect(artifactInstructions(toolkit, { detail: 'full' })).toBe(toolkit.instructions({ detail: 'full' }));
  });

  it('writes data parts with the artifact id as part id', () => {
    const parts: unknown[] = [];
    writeArtifactDataPart(
      { write: (part) => parts.push(part) },
      { id: 'art_1', format: 'note', title: 'T', version: 3 },
    );
    expect(parts).toEqual([
      {
        type: 'data-artifact',
        id: 'art_1',
        data: { id: 'art_1', format: 'note', title: 'T', version: 3 },
      },
    ]);
  });
});
