// @vitest-environment node

import { createMemoryAssetStore, createMemoryStore, createRegistry, type Scope } from '@artkit-ai/core';
import { describe, expect, it } from 'vitest';
import { createArtifactToolkit, guideBody, renderInstructions, renderSkills } from '../src/index.js';
import { noteFormat } from './note-format.js';

const scope: Scope = { workspaceId: 'ws_1', actor: { type: 'agent', id: 'agent_1' } };

function setup(options: Partial<Parameters<typeof createArtifactToolkit>[0]> = {}) {
  const registry = createRegistry({ formats: [noteFormat] });
  const toolkit = createArtifactToolkit({
    registry,
    store: createMemoryStore(),
    authorize: () => true,
    assets: createMemoryAssetStore(),
    ...options,
  } as Parameters<typeof createArtifactToolkit>[0]);
  const call = async (
    name: string,
    input: unknown,
    ctx: Partial<{ scope: Scope; idempotencyKey: string }> = {},
  ) => {
    const tool = toolkit.tool(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.execute(input, { scope, ...ctx }) as Promise<Record<string, unknown>>;
  };
  return { toolkit, call };
}

describe('artifact tools', () => {
  it('exposes the six tools of the core: create, read, apply, export, list and guide', () => {
    const { toolkit } = setup();
    expect(toolkit.tools.map((tool) => tool.name).sort()).toEqual([
      'artifact_apply',
      'artifact_create',
      'artifact_export',
      'artifact_guide',
      'artifact_list',
      'artifact_read',
    ]);
  });

  it('creates, reads, applies and lists in the native format', async () => {
    const { call } = setup();
    const created = await call('artifact_create', {
      format: 'note',
      title: 'Plano',
      content: { items: [{ id: 'a', text: 'Oi' }] },
    });
    expect(created.ok).toBe(true);
    expect(created.format).toBe('note');
    const read = await call('artifact_read', { id: created.id, mode: 'full' });
    expect(read.text).toContain('Oi');
    const applied = await call('artifact_apply', {
      id: created.id,
      baseVersion: created.version,
      operations: [{ op: 'add', after: 'a', text: 'Mundo' }],
    });
    expect(applied.ok).toBe(true);
    expect(applied.version).toBe(2);
    expect(applied.createdRefs).toHaveLength(1);
    const listed = await call('artifact_list', { format: 'note' });
    expect(listed.items).toHaveLength(1);
  });

  it('refuses a call without a scope and never throws for domain errors', async () => {
    const { call } = setup();
    const result = await call(
      'artifact_create',
      { format: 'note', title: 'X' },
      { scope: undefined as never },
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PERMISSION_DENIED');
    const unknown = await call('artifact_create', { format: 'slides', title: 'X' });
    expect(unknown.ok).toBe(false);
  });

  it('reports a stale base as a version conflict with the current version', async () => {
    const { call } = setup();
    const created = await call('artifact_create', {
      format: 'note',
      title: 'T',
      content: { items: [{ id: 'a', text: 'x' }] },
    });
    await call('artifact_apply', {
      id: created.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'y' }],
    });
    const stale = await call('artifact_apply', {
      id: created.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'z' }],
    });
    expect(stale.error.code).toBe('VERSION_CONFLICT');
    expect(stale.error.details.currentVersion).toBe(2);
  });

  it('exports to a target of a registered exporter and stores the file as an asset', async () => {
    const registry = createRegistry({ formats: [noteFormat] });
    registry.registerExporter({
      format: 'note',
      target: 'md',
      mimeType: 'text/markdown',
      extension: 'md',
      runtime: 'any',
      export: async (content: { items: { text: string }[] }) =>
        new TextEncoder().encode(content.items.map((i) => i.text).join('\n')),
    });
    const { call } = setup({ registry });
    const created = await call('artifact_create', {
      format: 'note',
      title: 'Nota',
      content: { items: [{ id: 'a', text: 'Ola' }] },
    });
    const exported = await call('artifact_export', { id: created.id, target: 'md' });
    expect(exported.ok).toBe(true);
    expect(exported.asset.filename).toBe('nota.md');
    expect(exported.asset.ref).toMatch(/^asset:\/\//);
  });

  it('has no status, approval or history tools', () => {
    const { toolkit } = setup();
    expect(toolkit.tools.map((tool) => tool.name)).not.toContain('artifact_submit');
    expect(toolkit.tools.map((tool) => tool.name)).not.toContain('artifact_publish');
  });

  it('marks read-only tools', () => {
    const { toolkit } = setup();
    expect(toolkit.tool('artifact_read')!.readOnly).toBe(true);
    expect(toolkit.tool('artifact_apply')!.readOnly).toBe(false);
  });

  it('per-format mode generates one apply tool per format and checks the format', async () => {
    const { toolkit, call } = setup({ applyMode: 'per-format' });
    expect(toolkit.tool('artifact_apply_note')?.format).toBe('note');
    const created = await call('artifact_create', { format: 'note', title: 'N' });
    const wrong = await toolkit
      .tool('artifact_apply_note')!
      .execute({ id: created.id, baseVersion: 1, operations: [{ op: 'add', text: 'x' }] }, { scope });
    expect(wrong.ok).toBe(true);
  });

  it('guides and skills come from the adapters', () => {
    const { toolkit } = setup();
    expect(toolkit.guideTopics()).toEqual(expect.arrayContaining(['overview', 'note', 'themes', 'errors']));
    expect(toolkit.guide('note')).toContain('Note');
    expect(guideBody(toolkit.registry, 'nada')).toBeUndefined();
    const files = toolkit.skills();
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'artkit-artefatos/SKILL.md',
        'artkit-artefatos/references/note.md',
        'artkit-integracao/SKILL.md',
      ]),
    );
    expect(renderSkills(toolkit.registry, { formats: ['note'] }).length).toBeGreaterThan(3);
  });

  it('instructions list the enabled formats only', () => {
    const { toolkit } = setup({ formats: ['note'] });
    const text = renderInstructions({ registry: toolkit.registry, formats: ['note'], locale: 'en' });
    expect(text).toContain('note');
    expect(toolkit.instructions()).toContain('Formats');
  });
});
