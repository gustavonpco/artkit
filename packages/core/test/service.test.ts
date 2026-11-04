import { describe, expect, it } from 'vitest';
import {
  ArtifactError,
  type ArtifactEvent,
  createArtifactService,
  createEventBus,
  createMemoryAssetStore,
  createMemoryStore,
  createRegistry,
  type Scope,
} from '../src/index.js';
import { noteKind } from './note-kind.js';

const user: Scope = { workspaceId: 'ws', actor: { type: 'user', id: 'u1' } };
const agent: Scope = { workspaceId: 'ws', actor: { type: 'agent', id: 'a1' } };

function setup(options: Partial<Parameters<typeof createArtifactService>[0]> = {}) {
  const events: ArtifactEvent[] = [];
  const bus = createEventBus();
  bus.on('*', (event) => events.push(event));
  const registry = createRegistry({ kinds: [noteKind] });
  registry.registerExporter({
    kind: 'note',
    format: 'md',
    mimeType: 'text/markdown',
    extension: 'md',
    runtime: 'any',
    async export(content: { items: { text: string }[] }, ctx) {
      ctx.warn('note export is lossy');
      return new TextEncoder().encode(content.items.map((item) => item.text).join('\n'));
    },
  });
  const service = createArtifactService({
    registry,
    store: createMemoryStore(),
    assets: createMemoryAssetStore(),
    events: bus,
    locale: 'en',
    ...options,
  });
  return { service, events };
}

async function rejection(promise: Promise<unknown>): Promise<ArtifactError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected rejection');
}

describe('ArtifactService', () => {
  it('creates from content and from an alternative input', async () => {
    const { service, events } = setup();
    const created = await service.create(agent, {
      kind: 'note',
      title: 'Notes',
      content: { items: [{ text: 'one' }] },
    });
    expect(created.version).toBe(1);
    expect(created.createdIds).toEqual(['n1']);
    const fromInput = await service.create(agent, {
      kind: 'note',
      title: 'Lines',
      input: { format: 'lines', source: 'a\nb' },
    });
    expect(fromInput.artifact.content).toEqual({
      items: [
        { id: 'l1', text: 'a' },
        { id: 'l2', text: 'b' },
      ],
    });
    expect(events.filter((e) => e.type === 'artifact.created')).toHaveLength(2);
    const noted = await service.create(agent, {
      kind: 'note',
      title: 'Gaps',
      input: { format: 'lines', source: 'a\n\nb' },
    });
    expect(noted.lint).toContainEqual({
      code: 'input-note',
      severity: 'info',
      target: 'input:lines',
      message: 'Skipped 1 empty line(s).',
    });
    const bad = await rejection(
      service.create(agent, { kind: 'note', title: 'X', input: { format: 'yaml', source: '' } }),
    );
    expect(bad.issues[0]?.hint).toContain('lines');
  });

  it('reads delimited projections with pagination', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'N',
      content: {
        items: [
          { id: 'a', text: 'x'.repeat(40) },
          { id: 'b', text: 'y'.repeat(40) },
        ],
      },
    });
    const read = await service.read(agent, artifact.id, { mode: 'full', maxTokens: 12 });
    expect(read.projection.truncated).toBe(true);
    expect(read.text).toContain(`<artifact-content id="${artifact.id}">`);
    expect(read.text).toContain('continue with cursor "c1"');
    const next = await service.read(agent, artifact.id, { mode: 'full', cursor: read.projection.cursor });
    expect(next.projection.text).toContain('#b');
  });

  it('applies with baseVersion, idempotency and replays', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'N',
      content: { items: [{ id: 'a', text: 'x' }] },
    });
    const first = await service.apply(agent, {
      artifactId: artifact.id,
      baseVersion: 1,
      idempotencyKey: 'call_1',
      operations: [{ op: 'add', after: 'a', text: 'y' }],
    });
    expect(first.version).toBe(2);
    const again = await service.apply(agent, {
      artifactId: artifact.id,
      baseVersion: 1,
      idempotencyKey: 'call_1',
      operations: [{ op: 'add', after: 'a', text: 'y' }],
    });
    expect(again).toMatchObject({ version: 2, replayed: true, createdIds: ['n1'] });
    expect((await service.get(agent, artifact.id)).version).toBe(2);
  });

  it('rebases automatically when touched items did not change', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'N',
      content: {
        items: [
          { id: 'a', text: 'x' },
          { id: 'b', text: 'y' },
        ],
      },
    });
    await service.apply(user, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'user edit' }],
    });
    const rebased = await service.apply(agent, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'b', text: 'agent edit' }],
    });
    expect(rebased).toMatchObject({ version: 3, rebased: true });
    expect(rebased.artifact.content).toEqual({
      items: [
        { id: 'a', text: 'user edit' },
        { id: 'b', text: 'agent edit' },
      ],
    });
  });

  it('returns VERSION_CONFLICT with the diff when the same item changed', async () => {
    const { service, events } = setup();
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'N',
      content: { items: [{ id: 'a', text: 'x' }] },
    });
    await service.apply(user, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'user' }],
    });
    const conflict = await rejection(
      service.apply(agent, {
        artifactId: artifact.id,
        baseVersion: 1,
        operations: [{ op: 'edit', id: 'a', text: 'agent' }],
      }),
    );
    expect(conflict.code).toBe('VERSION_CONFLICT');
    expect(conflict.details.changesSinceBase).toEqual([
      expect.objectContaining({ target: 'item:a', type: 'changed' }),
    ]);
    expect(events.some((e) => e.type === 'artifact.conflict')).toBe(true);
  });

  it('respects locks held by other actors', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, { kind: 'note', title: 'N' });
    const lock = await service.lock(agent, artifact.id, 60_000);
    const locked = await rejection(
      service.apply(user, {
        artifactId: artifact.id,
        baseVersion: 1,
        operations: [{ op: 'add', text: 'x' }],
      }),
    );
    expect(locked.code).toBe('LOCKED');
    await service.apply(agent, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'add', text: 'x' }],
    });
    await service.unlock(agent, lock);
    await service.apply(user, {
      artifactId: artifact.id,
      baseVersion: 2,
      operations: [{ op: 'add', text: 'y' }],
    });
  });

  it('runs the approval lifecycle and turns edits of published artifacts into drafts', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, { kind: 'note', title: 'N' });
    expect((await rejection(service.publish(agent, artifact.id))).code).toBe('APPROVAL_REQUIRED');
    await service.submit(agent, artifact.id, 'please review');
    expect((await rejection(service.approve(agent, artifact.id))).code).toBe('PERMISSION_DENIED');
    const published = await service.approve(user, artifact.id);
    expect(published.status).toBe('published');
    expect(published.meta.publishedVersion).toBe(1);
    const edited = await service.apply(agent, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'add', text: 'x' }],
    });
    expect(edited.artifact.status).toBe('draft');
    expect(edited.artifact.meta.publishedVersion).toBe(1);
  });

  it('keeps the rejection reason in history and exposes the lock holder', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, { kind: 'note', title: 'N' });
    await service.submit(agent, artifact.id, 'ready');
    await service.reject(user, artifact.id, 'missing totals');
    const [entry] = (await service.history(user, artifact.id)).items;
    expect(entry?.statusLog?.map((c) => [c.status, c.message])).toEqual([
      ['pending_approval', 'ready'],
      ['draft', 'missing totals'],
    ]);
    expect(await service.getLock(user, artifact.id)).toBeNull();
    await service.lock(agent, artifact.id, 60_000);
    expect((await service.getLock(user, artifact.id))?.holder).toEqual(agent.actor);
  });

  it('enforces authorization', async () => {
    const { service } = setup({
      authorize: (action, _artifact, scope) => !(action === 'apply' && scope.actor.type === 'agent'),
    });
    const { artifact } = await service.create(agent, { kind: 'note', title: 'N' });
    const denied = await rejection(
      service.apply(agent, {
        artifactId: artifact.id,
        baseVersion: 1,
        operations: [{ op: 'add', text: 'x' }],
      }),
    );
    expect(denied.code).toBe('PERMISSION_DENIED');
  });

  it('restores an old version as a new version', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'N',
      content: { items: [{ id: 'a', text: 'v1' }] },
    });
    await service.apply(agent, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'v2' }],
    });
    const restored = await service.restore(user, artifact.id, 1);
    expect(restored.version).toBe(3);
    expect(restored.artifact.content).toEqual({ items: [{ id: 'a', text: 'v1' }] });
    const history = await service.history(user, artifact.id);
    expect(history.items[0]).toMatchObject({ version: 3, restoredFrom: 1 });
  });

  it('exports with warnings and stores the file as an asset', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, {
      kind: 'note',
      title: 'Relatório Final',
      content: { items: [{ text: 'a' }] },
    });
    await expect(service.export(agent, { artifactId: artifact.id, format: 'docx' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const result = await service.export(agent, { artifactId: artifact.id, format: 'md' });
    expect(result.filename).toBe('relatorio-final.md');
    expect(result.warnings).toEqual(['note export is lossy']);
    expect(new TextDecoder().decode(result.bytes)).toBe('a');
  });

  it('deduplicates create calls with the same idempotency key', async () => {
    const { service } = setup();
    const first = await service.create(agent, {
      kind: 'note',
      title: 'N',
      idempotencyKey: 'call_9',
      content: { items: [{ text: 'a' }] },
    });
    const again = await service.create(agent, {
      kind: 'note',
      title: 'N',
      idempotencyKey: 'call_9',
      content: { items: [{ text: 'a' }] },
    });
    expect(again).toMatchObject({ replayed: true, version: 1, createdIds: ['n1'] });
    expect(again.artifact.id).toBe(first.artifact.id);
    expect((await service.list(agent)).items).toHaveLength(1);
  });

  it('saves generated exports as assets even when the type is not an image', async () => {
    const { service } = setup();
    service.registry.registerExporter({
      kind: 'note',
      format: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      runtime: 'any',
      export: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    });
    const { artifact } = await service.create(agent, { kind: 'note', title: 'N' });
    const result = await service.export(agent, {
      artifactId: artifact.id,
      format: 'docx',
      saveToAssets: true,
    });
    expect(result.asset?.ref).toMatch(/^asset:\/\//);
    const withoutAssets = createArtifactService({ registry: service.registry, store: createMemoryStore() });
    const other = await withoutAssets.create(agent, { kind: 'note', title: 'N' });
    await expect(
      withoutAssets.export(agent, { artifactId: other.artifact.id, format: 'docx', saveToAssets: true }),
    ).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
    });
  });

  it('isolates workspaces', async () => {
    const { service } = setup();
    const { artifact } = await service.create(agent, { kind: 'note', title: 'N' });
    const other: Scope = { workspaceId: 'other', actor: { type: 'agent', id: 'a1' } };
    expect((await rejection(service.get(other, artifact.id))).code).toBe('NOT_FOUND');
  });
});
