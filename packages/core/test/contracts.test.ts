import { describe, expect, it } from 'vitest';
import {
  checkAsset,
  createMemoryStore,
  diffCollection,
  isSafeLink,
  paginate,
  sanitizeSvg,
  selectRange,
  stripNulls,
  toJsonSchema,
} from '../src/index.js';
import { defineKindConformanceTests, defineStoreContractTests } from '../src/testing/index.js';
import { noteKind } from './note-kind.js';

defineStoreContractTests('memory', () => createMemoryStore(), { describe, it });

defineKindConformanceTests(
  noteKind,
  [
    {
      title: 'two notes',
      content: {
        items: [
          { id: 'a', text: 'Alpha' },
          { id: 'b', text: 'Beta' },
        ],
      },
      batches: [[{ op: 'add', after: 'a', text: 'Gamma' }], [{ op: 'remove', id: 'b' }]],
      rejects: [
        { operations: [{ op: 'remove', id: 'missing' }], code: 'OPERATION_FAILED' },
        { operations: [{ op: 'edit', id: 'a' }], code: 'INVALID_OPERATION' },
      ],
    },
  ],
  { describe, it },
);

describe('diffCollection', () => {
  it('reports a single move instead of shifting neighbors', () => {
    const before = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const after = ['a', 'd', 'b', 'c'].map((id) => ({ id }));
    const diff = diffCollection(before, after, { prefix: 'slide', id: (s) => s.id });
    expect(diff).toEqual([{ type: 'moved', target: 'slide:d', summary: 'From position 4 to position 2.' }]);
  });
});

describe('projection helpers', () => {
  it('selects ranges by id, position and list', () => {
    const ids = ['intro', 'scope', 'plan', 'cost'];
    expect(selectRange(ids, 'scope..cost')).toEqual(['scope', 'plan', 'cost']);
    expect(selectRange(ids, '1-2')).toEqual(['intro', 'scope']);
    expect(selectRange(ids, 'cost,intro')).toEqual(['intro', 'cost']);
    expect(selectRange(ids, 'nope')).toBeUndefined();
  });

  it('paginates at item boundaries', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, text: id.repeat(20), outline: `- ${id}` }));
    const first = paginate(items, { maxTokens: 12 });
    expect(first).toMatchObject({ truncated: true, cursor: 'c2', remainingOutline: '- c' });
    expect(paginate(items, { cursor: first.cursor })).toMatchObject({
      truncated: false,
      text: 'c'.repeat(20),
    });
  });
});

describe('security helpers', () => {
  it('only allows safe link protocols', () => {
    expect(isSafeLink('https://example.com')).toBe(true);
    expect(isSafeLink('mailto:a@b.co')).toBe(true);
    expect(isSafeLink('#escopo')).toBe(true);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('data:text/html,hi')).toBe(false);
  });

  it('sanitizes SVG', () => {
    const dirty =
      '<svg onload="x()"><script>alert(1)</script><a xlink:href="https://evil"><rect/></a><use href="#ok"/></svg>';
    const clean = sanitizeSvg(dirty)!;
    expect(clean).not.toMatch(/script|onload|evil/);
    expect(clean).toContain('href="#ok"');
  });

  it('checks assets by magic bytes, not by the declared type', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(checkAsset(png, { mimeType: 'image/png' }).mimeType).toBe('image/png');
    expect(() => checkAsset(png, { mimeType: 'image/jpeg' })).toThrow(/does not match/);
    expect(() => checkAsset(new TextEncoder().encode('MZ...'), { mimeType: 'image/png' })).toThrow(
      /unrecognized/,
    );
    expect(() => checkAsset(png, { mimeType: 'image/png', sourceUrl: 'https://cdn.evil.com/x.png' })).toThrow(
      /domain/,
    );
  });
});

describe('JSON Schema profiles', () => {
  it('makes every property required and nullable in strict mode', () => {
    type Option = { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
    const strict = toJsonSchema(noteKind.operationSchema, 'strict') as { oneOf?: Option[]; anyOf?: Option[] };
    const add = (strict.oneOf ?? strict.anyOf)!.find((option) =>
      JSON.stringify(option.properties.op).includes('"add"'),
    )!;
    expect(add.required).toEqual(['op', 'after', 'id', 'text']);
    expect(add.additionalProperties).toBe(false);
    expect(add.properties.after).toMatchObject({ anyOf: [expect.any(Object), { type: 'null' }] });
    expect(stripNulls({ op: 'add', after: null, id: null, text: 'x' })).toEqual({ op: 'add', text: 'x' });
  });
});
