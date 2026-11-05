// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createArtifactService, createMemoryStore, createRegistry, type Scope } from '../src/index.js';
import { contractText } from './contract-text.js';

const user: Scope = { workspaceId: 'ws_a', actor: { type: 'user', id: 'usr_1' } };
const agent: Scope = { workspaceId: 'ws_a', actor: { type: 'agent', id: 'agt_1' } };

function setup() {
  const registry = createRegistry({ formats: [contractText] });
  const store = createMemoryStore();
  const service = createArtifactService({ registry, store });
  return { service, registry, store };
}

describe('artifact service', () => {
  it('applies a batch on the current version and bumps the version', async () => {
    const { service } = setup();
    const created = await service.create(agent, { format: 'contract-text', title: 'T', content: 'a' });
    const result = await service.apply(agent, {
      artifactId: created.artifact.id,
      baseVersion: 1,
      operations: [{ op: 'append', text: 'b' }],
    });
    expect(result.version).toBe(2);
    expect(result.artifact.content).toBe('ab');
  });

  it('returns VERSION_CONFLICT for any base that is not the current version, without rebasing', async () => {
    const { service } = setup();
    const created = await service.create(user, { format: 'contract-text', title: 'T', content: 'abc' });
    const id = created.artifact.id;
    // The user changes the text; the agent's batch was computed against version 1 and must not be applied silently.
    await service.apply(user, { artifactId: id, baseVersion: 1, operations: [{ op: 'append', text: 'x' }] });
    await expect(
      service.apply(agent, {
        artifactId: id,
        baseVersion: 1,
        operations: [{ op: 'append', text: 'd' }],
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    const current = await service.get(user, id);
    expect(current.content).toBe('abcx');
  });

  it('keeps no history: only the current content is readable', async () => {
    const { service } = setup();
    const created = await service.create(user, { format: 'contract-text', title: 'T', content: 'a' });
    await service.apply(user, {
      artifactId: created.artifact.id,
      baseVersion: 1,
      operations: [{ op: 'append', text: 'b' }],
    });
    const current = await service.get(user, created.artifact.id);
    expect(current.version).toBe(2);
    expect(current.content).toBe('ab');
    expect('history' in service).toBe(false);
    expect('publish' in service).toBe(false);
    expect('archive' in service).toBe(false);
  });

  it('blocks other actors while a lock is held', async () => {
    const { service } = setup();
    const created = await service.create(user, { format: 'contract-text', title: 'T', content: 'a' });
    await service.lock(user, created.artifact.id, 60_000);
    await expect(
      service.apply(agent, {
        artifactId: created.artifact.id,
        baseVersion: 1,
        operations: [{ op: 'append', text: 'b' }],
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('denies actions through the authorization hook', async () => {
    const registry = createRegistry({ formats: [contractText] });
    const service = createArtifactService({
      registry,
      store: createMemoryStore(),
      authorize: (action) => action !== 'create',
    });
    await expect(service.create(user, { format: 'contract-text', title: 'T' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('rejects unknown formats with UNKNOWN_FORMAT', async () => {
    const { service } = setup();
    await expect(service.create(user, { format: 'nope', title: 'T' })).rejects.toMatchObject({
      code: 'UNKNOWN_FORMAT',
    });
  });

  it('exports through the exporter registered for the native format', async () => {
    const registry = createRegistry({
      formats: [contractText],
      exporters: [
        {
          format: 'contract-text',
          target: 'md',
          mimeType: 'text/markdown',
          extension: 'md',
          runtime: 'any',
          export: async (content) => new TextEncoder().encode(String(content)),
        },
      ],
    });
    const service = createArtifactService({ registry, store: createMemoryStore() });
    const created = await service.create(user, {
      format: 'contract-text',
      title: 'Exportar',
      content: 'texto',
    });
    const result = await service.export(user, { artifactId: created.artifact.id, format: 'md' });
    expect(new TextDecoder().decode(result.bytes)).toBe('texto');
    expect(result.filename).toBe('exportar.md');
  });
});
