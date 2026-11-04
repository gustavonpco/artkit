import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ArtifactError,
  applyOperations,
  createRegistry,
  defineKind,
  IdAllocator,
  migrateContent,
  prepareContent,
  toModelError,
} from '../src/index.js';
import { noteKind } from './note-kind.js';

const registry = createRegistry({ kinds: [noteKind] });
const base = {
  kind: 'note',
  content: { items: [{ id: 'a', text: 'Alpha' }] },
  title: 'T',
  themeId: 'default',
  locale: 'pt-BR',
};

function catchError(fn: () => unknown): ArtifactError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected an ArtifactError');
}

describe('IdAllocator', () => {
  it('derives the next id from existing numeric suffixes', () => {
    const ids = new IdAllocator(['p1', 'p7', 'n2', 'intro']);
    expect(ids.next('p')).toBe('p8');
    expect(ids.next('p')).toBe('p9');
    expect(ids.next('n')).toBe('n3');
    expect(ids.next('x')).toBe('x1');
  });
});

describe('applyOperations', () => {
  it('applies a batch, reports created ids, diff and lint', () => {
    const result = applyOperations(registry, base, [
      { op: 'add', after: 'a', text: 'Beta' },
      { op: 'add', after: 'n1', id: 'c', text: '' },
      { op: 'set_title', title: 'Novo' },
    ]);
    expect(result.content).toEqual({
      items: [
        { id: 'a', text: 'Alpha' },
        { id: 'n1', text: 'Beta' },
        { id: 'c', text: '' },
      ],
    });
    expect(result.createdIds).toEqual(['n1', 'c']);
    expect(result.title).toBe('Novo');
    expect(result.diff.map((d) => d.target)).toEqual(['envelope:title', 'item:n1', 'item:c']);
    expect(result.lint).toHaveLength(1);
    expect(base.content.items).toHaveLength(1);
  });

  it('rejects the whole batch with the index of the invalid operation', () => {
    const error = catchError(() =>
      applyOperations(registry, base, [
        { op: 'edit', id: 'a', text: 'ok' },
        { op: 'paint', id: 'a' },
      ]),
    );
    expect(error.code).toBe('INVALID_OPERATION');
    expect(error.message).toBe('A operação 1 é inválida.');
    expect(error.issues[0]).toMatchObject({ path: 'operations[1].op' });
    expect(error.issues[0]?.hint).toContain('edit');
  });

  it('reports OPERATION_FAILED with a hint when the target does not exist', () => {
    const error = catchError(() => applyOperations(registry, base, [{ op: 'remove', id: 'zzz' }]));
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues[0]).toMatchObject({
      path: 'operations[0].id',
      hint: 'Use an id from the projection.',
    });
  });

  it('enforces kind limits after applying', () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({ op: 'add', text: `x${i}` }));
    const error = catchError(() => applyOperations(registry, base, ops));
    expect(error.code).toBe('LIMIT_EXCEEDED');
    expect(error.details).toMatchObject({ limit: 'items', max: 5, found: 6 });
  });

  it('enforces the operations-per-batch limit', () => {
    const small = createRegistry({ kinds: [noteKind], batch: { maxOperations: 2 } });
    const error = catchError(() =>
      applyOperations(small, base, [
        { op: 'edit', id: 'a', text: '1' },
        { op: 'edit', id: 'a', text: '2' },
        { op: 'edit', id: 'a', text: '3' },
      ]),
    );
    expect(error.code).toBe('LIMIT_EXCEEDED');
  });

  it('lets a batch reuse an id it removed, but never generates it again', () => {
    const result = applyOperations(registry, base, [
      { op: 'remove', id: 'a' },
      { op: 'add', id: 'a', text: 'again' },
      { op: 'add', text: 'generated' },
    ]);
    expect(result.content).toEqual({
      items: [
        { id: 'n1', text: 'generated' },
        { id: 'a', text: 'again' },
      ],
    });
  });

  it('stores schema defaults applied by validation', () => {
    const withDefaults = defineKind({
      ...noteKind,
      kind: 'tagged',
      version: 1,
      migrations: [],
      contentSchema: z.object({
        items: z.array(z.object({ id: z.string(), text: z.string(), tag: z.string().default('none') })),
      }),
      instructions: { ...noteKind.instructions, examples: [] },
    } as typeof noteKind);
    const reg = createRegistry({ kinds: [withDefaults] });
    const result = applyOperations(reg, { ...base, kind: 'tagged' }, [
      { op: 'add', after: 'a', id: 'b', text: 'x' },
    ]);
    expect(result.content).toEqual({
      items: [
        { id: 'a', text: 'Alpha', tag: 'none' },
        { id: 'b', text: 'x', tag: 'none' },
      ],
    });
  });

  it('sanitizes control characters and normalizes NFC', () => {
    const result = applyOperations(registry, base, [{ op: 'edit', id: 'a', text: 'Café\u0007' }]);
    expect((result.content as { items: { text: string }[] }).items[0]!.text).toBe('Café');
  });

  it('validates replace_content through the schema', () => {
    const error = catchError(() =>
      applyOperations(registry, base, [{ op: 'replace_content', content: { items: 'nope' } }]),
    );
    expect(error.code).toBe('INVALID_OPERATION');
    expect(error.issues[0]?.path).toBe('operations[0].content.items');
  });

  it('rejects unknown themes in set_theme', () => {
    const error = catchError(() =>
      applyOperations(registry, base, [{ op: 'set_theme', themeId: 'missing' }]),
    );
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues[0]?.hint).toContain('default');
  });
});

describe('prepareContent', () => {
  it('fills missing ids deterministically without colliding with explicit ones', () => {
    const prepared = prepareContent(registry, 'note', {
      items: [{ text: 'a' }, { id: 'n1', text: 'b' }, { text: 'c' }],
    });
    expect(prepared.ids).toEqual(['n2', 'n1', 'n3']);
  });

  it('rejects duplicate ids as INVALID_CONTENT', () => {
    const error = catchError(() =>
      prepareContent(registry, 'note', {
        items: [
          { id: 'a', text: '' },
          { id: 'a', text: '' },
        ],
      }),
    );
    expect(error.code).toBe('INVALID_CONTENT');
    expect(error.issues[0]?.message).toContain('"a"');
  });
});

describe('migrations', () => {
  it('migrates older content in chain and rejects newer versions', () => {
    const result = migrateContent(noteKind, { lines: ['x', 'y'] }, 1);
    expect(result).toMatchObject({ migrated: true, schemaVersion: 2 });
    expect(result.content).toEqual({
      items: [
        { id: 'm1', text: 'x' },
        { id: 'm2', text: 'y' },
      ],
    });
    expect(catchError(() => migrateContent(noteKind, {}, 3)).code).toBe('UNSUPPORTED_VERSION');
  });
});

describe('registry and contract', () => {
  it('rejects duplicate kinds and broken definitions', () => {
    expect(catchError(() => registry.register(noteKind)).code).toBe('DUPLICATE_KIND');
    expect(() => defineKind({ ...noteKind, kind: 'Bad Name' })).toThrow(/kind must match/);
    expect(() => defineKind({ ...noteKind, migrations: [], version: 1 })).not.toThrow();
    expect(() => defineKind({ ...noteKind, migrations: [{ from: 2, to: 3, migrate: (c) => c }] })).toThrow(
      /chain/,
    );
  });

  it('turns unknown errors into INTERNAL_ERROR without leaking details', () => {
    const payload = toModelError(new Error('/srv/secret/path exploded'), 'en');
    expect(payload).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal error while processing the request.' },
    });
  });
});
