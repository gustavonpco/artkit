import { defaultTheme, toJsonSchema } from '@artkit/core';
import { defineKindConformanceTests } from '@artkit/core/testing';
import { describe, expect, it } from 'vitest';
import {
  type DocumentContent,
  documentKind,
  documentOperationTargets,
  parsePartialDocument,
} from '../src/index.js';
import { apply, applyContent, catchError, prepare } from './helpers.js';

const base = {
  cover: { title: 'Proposal', fields: [{ label: 'Client', value: 'Acme' }] },
  blocks: [
    { id: 'intro', type: 'heading', level: 1, runs: [{ text: 'Introduction' }] },
    {
      id: 'p1',
      type: 'paragraph',
      runs: [{ text: 'The portal ' }, { text: 'centralizes', bold: true }, { text: ' suppliers.' }],
    },
    {
      id: 'tbl',
      type: 'table',
      header: [[{ text: 'Module' }], [{ text: 'Hours' }]],
      rows: [[[{ text: 'Login' }], [{ text: '40' }]]],
      footer: [[{ text: 'Total' }], [{ text: '40' }]],
    },
    {
      id: 'lst',
      type: 'list',
      items: [
        { runs: [{ text: 'one' }], children: [{ runs: [{ text: 'nested' }] }] },
        { runs: [{ text: 'two' }] },
      ],
    },
  ],
};

defineKindConformanceTests(
  documentKind,
  [
    {
      title: 'proposal',
      content: base,
      batches: [
        [{ op: 'insert_block', after: 'p1', block: { type: 'paragraph', runs: [{ text: 'More.' }] } }],
        [{ op: 'replace_text', id: 'p1', find: 'centralizes', replace: 'unifies' }],
        [{ op: 'insert_markdown', after: 'intro', markdown: '## Scope\n\n- a\n- b' }],
        [{ op: 'table_insert_row', id: 'tbl', cells: ['Reports', '80'] }],
        [
          { op: 'move_block', id: 'lst', after: 'intro' },
          { op: 'set_page', page: { size: 'Letter', pageNumbers: true } },
        ],
      ],
      rejects: [
        { operations: [{ op: 'remove_block', id: 'missing' }], code: 'OPERATION_FAILED' },
        {
          operations: [{ op: 'replace_text', id: 'p1', find: 'nope', replace: 'x' }],
          code: 'OPERATION_FAILED',
        },
        {
          operations: [{ op: 'table_insert_row', id: 'tbl', cells: ['only one'] }],
          code: 'OPERATION_FAILED',
        },
        {
          operations: [{ op: 'insert_block', block: { type: 'heading', level: 7, runs: [] } }],
          code: 'INVALID_OPERATION',
        },
        {
          operations: [{ op: 'update_block', id: 'tbl', fields: { rows: [[[{ text: 'x' }]]] } }],
          code: 'OPERATION_FAILED',
        },
      ],
    },
    { title: 'empty with cover', content: { cover: { title: 'Only a cover' }, blocks: [] } },
  ],
  { describe, it },
);

describe('content preparation', () => {
  it('fills missing ids with per-type prefixes and expands shorthands', () => {
    const content = prepare({
      blocks: [
        { type: 'heading', level: 1, text: 'Title' },
        { type: 'paragraph', text: 'Body' },
        { type: 'paragraph', id: 'p1', runs: [] },
        { type: 'list', items: ['a', { text: 'b' }] },
        { type: 'table', header: ['A', 'B'], rows: [['1', '2']] },
        { type: 'divider' },
      ],
    });
    expect(content.blocks.map((block) => block.id)).toEqual(['h1', 'p2', 'p1', 'l1', 't1', 'hr1']);
    expect(content.blocks[1]).toEqual({ id: 'p2', type: 'paragraph', runs: [{ text: 'Body' }] });
    expect(content.blocks[3]).toMatchObject({
      items: [{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }],
    });
    expect(content.blocks[4]).toMatchObject({
      header: [[{ text: 'A' }], [{ text: 'B' }]],
      rows: [[[{ text: '1' }], [{ text: '2' }]]],
    });
  });

  it('validates table shape, list depth and toc level', () => {
    const table = catchError(() =>
      prepare({ blocks: [{ id: 't', type: 'table', header: [[], []], rows: [[[]]], align: ['left'] }] }),
    );
    expect(table.code).toBe('INVALID_CONTENT');
    expect(table.issues.map((issue) => issue.path)).toEqual([
      'content.blocks[0].rows[0]',
      'content.blocks[0].align',
    ]);
    const deep = catchError(() =>
      prepare({
        blocks: [
          {
            type: 'list',
            items: [
              { runs: [], children: [{ runs: [], children: [{ runs: [], children: [{ runs: [] }] }] }] },
            ],
          },
        ],
      }),
    );
    expect(deep.code).toBe('INVALID_CONTENT');
    expect(catchError(() => prepare({ blocks: [{ type: 'toc', maxLevel: 5 }] })).code).toBe(
      'INVALID_CONTENT',
    );
    expect(
      catchError(() => prepare({ blocks: [{ type: 'image', asset: 'https://x.com/a.png', alt: 'x' }] })).code,
    ).toBe('INVALID_CONTENT');
    expect(
      catchError(() =>
        prepare({ blocks: [{ type: 'paragraph', runs: [{ text: 'x', link: 'javascript:alert(1)' }] }] }),
      ).code,
    ).toBe('INVALID_CONTENT');
  });

  it('enforces limits', () => {
    const rows = Array.from({ length: 201 }, () => [[{ text: 'x' }]]);
    const error = catchError(() => prepare({ blocks: [{ type: 'table', header: [[{ text: 'A' }]], rows }] }));
    expect(error.code).toBe('LIMIT_EXCEEDED');
    expect(error.details).toMatchObject({ limit: 'tableRows', max: 200, found: 201 });
    expect(documentKind.measure?.(prepare(base))).toEqual({ blocks: 4, tableRows: 1 });
  });

  it('produces JSON Schemas for content and operations', () => {
    expect(toJsonSchema(documentKind.contentSchema)).toHaveProperty('properties.blocks');
    expect(JSON.stringify(toJsonSchema(documentKind.operationSchema, 'strict'))).toContain('insert_markdown');
  });
});

describe('operations', () => {
  const content = prepare(base);

  it('insert_block at the start, after an id, with an explicit id', () => {
    const result = apply(content, [
      { op: 'insert_block', block: { type: 'paragraph', runs: [{ text: 'first' }] } },
      {
        op: 'insert_block',
        after: 'tbl',
        block: { id: 'note', type: 'callout', tone: 'warning', runs: [{ text: 'careful' }] },
      },
    ]);
    const ids = (result.content as DocumentContent).blocks.map((block) => block.id);
    expect(ids).toEqual(['p2', 'intro', 'p1', 'tbl', 'note', 'lst']);
    expect(result.createdIds).toEqual(['p2', 'note']);
    expect(result.diff.map((change) => change.target)).toEqual(['block:p2', 'block:note']);
  });

  it('rejects duplicate ids and unknown anchors with paths', () => {
    const dupe = catchError(() =>
      apply(content, [{ op: 'insert_block', block: { id: 'p1', type: 'divider' } }]),
    );
    expect(dupe.code).toBe('OPERATION_FAILED');
    expect(dupe.issues[0]?.path).toBe('operations[0].block.id');
    const missing = catchError(() =>
      apply(content, [{ op: 'insert_block', after: 'nope', block: { type: 'divider' } }]),
    );
    expect(missing.issues[0]?.path).toBe('operations[0].after');
    const badTable = catchError(() =>
      apply(content, [{ op: 'insert_block', block: { type: 'table', header: [[], []], rows: [[[]]] } }]),
    );
    expect(badTable.issues[0]?.path).toBe('operations[0].block.rows[0]');
  });

  it('insert_markdown converts and assigns ids, honoring anchors', () => {
    const next = applyContent(content, [
      {
        op: 'insert_markdown',
        after: 'p1',
        markdown: '## Scope <!-- #scope -->\n\nText with **bold**.\n\n| A | B |\n|---|--:|\n| 1 | 2 |',
      },
    ]);
    expect(next.blocks.map((block) => block.id)).toEqual(['intro', 'p1', 'scope', 'p2', 't1', 'tbl', 'lst']);
    expect(next.blocks[4]).toMatchObject({ type: 'table', align: ['left', 'right'] });
  });

  it('insert_markdown rejects external images, front matter, empty input and taken anchors', () => {
    const image = catchError(() =>
      apply(content, [{ op: 'insert_markdown', markdown: '![x](https://example.com/x.png)' }]),
    );
    expect(image.code).toBe('OPERATION_FAILED');
    expect(image.issues[0]).toMatchObject({ path: 'operations[0].markdown' });
    expect(image.issues[0]?.hint).toContain('asset://');
    expect(
      catchError(() => apply(content, [{ op: 'insert_markdown', markdown: '---\ntitle: X\n---\n\nHi' }]))
        .code,
    ).toBe('OPERATION_FAILED');
    expect(
      catchError(() => apply(content, [{ op: 'insert_markdown', markdown: '<!-- only a comment -->' }])).code,
    ).toBe('OPERATION_FAILED');
    expect(
      catchError(() => apply(content, [{ op: 'insert_markdown', markdown: '# X <!-- #p1 -->' }])).code,
    ).toBe('OPERATION_FAILED');
  });

  it('update_block merges fields, unsets optional ones and changes type', () => {
    const next = applyContent(content, [
      { op: 'update_block', id: 'intro', fields: { level: 2 } },
      { op: 'update_block', id: 'tbl', fields: { caption: 'Costs' } },
      { op: 'update_block', id: 'tbl', fields: {}, unset: ['footer'] },
      {
        op: 'update_block',
        id: 'p1',
        fields: { type: 'quote', runs: [{ text: 'Said.' }], attribution: 'Ana' },
      },
    ]);
    expect(next.blocks[0]).toEqual({
      id: 'intro',
      type: 'heading',
      level: 2,
      runs: [{ text: 'Introduction' }],
    });
    expect(next.blocks[2]).toMatchObject({ caption: 'Costs' });
    expect(next.blocks[2]).not.toHaveProperty('footer');
    expect(next.blocks[1]).toEqual({
      id: 'p1',
      type: 'quote',
      runs: [{ text: 'Said.' }],
      attribution: 'Ana',
    });
  });

  it('update_block reports invalid results on the operation', () => {
    const wrongField = catchError(() =>
      apply(content, [{ op: 'update_block', id: 'p1', fields: { level: 2 } }]),
    );
    expect(wrongField.code).toBe('OPERATION_FAILED');
    expect(wrongField.issues[0]?.path).toBe('operations[0].fields');
    const typeChange = catchError(() =>
      apply(content, [{ op: 'update_block', id: 'p1', fields: { type: 'image' } }]),
    );
    expect(typeChange.issues[0]?.hint).toContain('required');
  });

  it('remove_block and move_block', () => {
    const next = applyContent(content, [
      { op: 'remove_block', id: 'tbl' },
      { op: 'move_block', id: 'lst' },
      { op: 'move_block', id: 'intro', after: 'p1' },
    ]);
    expect(next.blocks.map((block) => block.id)).toEqual(['lst', 'p1', 'intro']);
    expect(
      catchError(() => apply(content, [{ op: 'move_block', id: 'p1', after: 'p1' }])).issues[0]?.path,
    ).toBe('operations[0].after');
  });

  it('replace_text across runs keeps the formatting of the starting run', () => {
    const next = applyContent(content, [
      { op: 'replace_text', id: 'p1', find: 'centralizes sup', replace: 'joins sup' },
    ]);
    expect((next.blocks[1] as { runs: unknown }).runs).toEqual([
      { text: 'The portal ' },
      { text: 'joins sup', bold: true },
      { text: 'pliers.' },
    ]);
    const cell = applyContent(content, [
      { op: 'replace_text', id: 'tbl', find: 'Login', replace: 'Sign-in' },
    ]);
    expect((cell.blocks[2] as { rows: unknown }).rows).toEqual([[[{ text: 'Sign-in' }], [{ text: '40' }]]]);
    const nested = applyContent(content, [
      { op: 'replace_text', id: 'lst', find: 'nested', replace: 'deep' },
    ]);
    expect(JSON.stringify(nested.blocks[3])).toContain('deep');
  });

  it('replace_text fails when the anchor is ambiguous', () => {
    const error = catchError(() =>
      apply(content, [{ op: 'replace_text', id: 'tbl', find: '40', replace: '50' }], 'pt-BR'),
    );
    expect(error.issues[0]).toMatchObject({ path: 'operations[0].find' });
    expect(error.issues[0]?.message).toContain('2 vezes');
  });

  it('set_cover and set_page set and remove', () => {
    const next = applyContent(content, [
      { op: 'set_cover' },
      { op: 'set_page', page: { orientation: 'landscape' } },
    ]);
    expect(next.cover).toBeUndefined();
    expect(next.page).toEqual({ orientation: 'landscape' });
    const diff = apply(content, [{ op: 'set_cover', cover: { title: 'New' } }]).diff;
    expect(diff).toEqual([{ type: 'changed', target: 'cover', summary: "Cover changed 'New'." }]);
  });

  it('table_set_cells, table_insert_row and table_remove_row', () => {
    const next = applyContent(content, [
      {
        op: 'table_set_cells',
        id: 'tbl',
        cells: [
          { section: 'header', col: 1, value: 'Effort' },
          { row: 0, col: 1, value: [{ text: '45', bold: true }] },
        ],
      },
      { op: 'table_insert_row', id: 'tbl', index: 0, cells: ['Setup', '5'] },
      { op: 'table_set_cells', id: 'tbl', cells: [{ section: 'footer', col: 1, value: '50' }] },
      { op: 'table_remove_row', id: 'tbl', index: 1 },
    ]);
    expect(next.blocks[2]).toMatchObject({
      header: [[{ text: 'Module' }], [{ text: 'Effort' }]],
      rows: [[[{ text: 'Setup' }], [{ text: '5' }]]],
      footer: [[{ text: 'Total' }], [{ text: '50' }]],
    });
  });

  it('table operations reject bad coordinates and non-tables', () => {
    const col = catchError(() =>
      apply(content, [{ op: 'table_set_cells', id: 'tbl', cells: [{ row: 0, col: 5, value: 'x' }] }]),
    );
    expect(col.issues[0]?.path).toBe('operations[0].cells[0].col');
    const row = catchError(() =>
      apply(content, [{ op: 'table_set_cells', id: 'tbl', cells: [{ col: 0, value: 'x' }] }]),
    );
    expect(row.issues[0]?.path).toBe('operations[0].cells[0].row');
    expect(
      catchError(() => apply(content, [{ op: 'table_remove_row', id: 'tbl', index: 3 }])).issues[0]?.path,
    ).toBe('operations[0].index');
    expect(
      catchError(() => apply(content, [{ op: 'table_remove_row', id: 'p1', index: 0 }])).issues[0]?.path,
    ).toBe('operations[0].id');
    const noFooter = applyContent(content, [
      { op: 'update_block', id: 'tbl', fields: {}, unset: ['footer'] },
    ]);
    expect(
      catchError(() =>
        apply(noFooter, [
          { op: 'table_set_cells', id: 'tbl', cells: [{ section: 'footer', col: 0, value: 'x' }] },
        ]),
      ).code,
    ).toBe('OPERATION_FAILED');
  });

  it('declares targets in the diff vocabulary', () => {
    expect(documentOperationTargets({ op: 'remove_block', id: 'a' })).toEqual(['block:a']);
    expect(documentOperationTargets({ op: 'insert_block', block: { id: 'x', type: 'divider' } })).toEqual([
      'block:x',
    ]);
    expect(documentOperationTargets({ op: 'insert_markdown', markdown: '# a' })).toEqual([]);
    expect(documentOperationTargets({ op: 'set_cover' })).toEqual(['cover']);
    expect(documentOperationTargets({ op: 'set_page' })).toEqual(['page']);
  });
});

describe('projection', () => {
  const content = prepare({
    ...base,
    blocks: [
      ...base.blocks,
      { id: 'code1', type: 'code', language: 'ts', text: 'const a = 1;' },
      { id: 'e', type: 'paragraph', runs: [] },
    ],
  });

  it('renders Markdown with an anchor on the first line of every block (spec §9.3)', () => {
    const { text, truncated } = documentKind.project(content, { mode: 'full', locale: 'en' });
    expect(truncated).toBe(false);
    expect(text).toContain('# Introduction <!-- #intro -->');
    expect(text).toContain('The portal **centralizes** suppliers. <!-- #p1 -->');
    expect(text).toContain('| Module | Hours | <!-- #tbl -->');
    expect(text).toContain('```ts <!-- #code1 -->');
    expect(text).toContain('(empty paragraph) <!-- #e -->');
    expect(text.split('\n')[0]).toContain('Cover: "Proposal"');
  });

  it('outline lists headings with ids and one line per other block', () => {
    const { text } = documentKind.project(content, { mode: 'outline', locale: 'en' });
    expect(text).toContain('# Introduction <!-- #intro -->');
    expect(text).toContain('  - tbl (table): 2 cols × 1 rows + footer');
    expect(text).toContain('  - lst (list): bulleted, 2 items');
    expect(text).not.toContain('| Module | Hours |');
  });

  it('selects ranges and paginates on block boundaries', () => {
    const range = documentKind.project(content, { mode: 'range', range: 'p1..tbl', locale: 'en' });
    expect(range.text).toContain('#p1');
    expect(range.text).toContain('#tbl');
    expect(range.text).not.toContain('#intro');
    expect(range.text).not.toContain('Cover');
    const page = documentKind.project(content, { mode: 'full', locale: 'en', maxTokens: 30 });
    expect(page.truncated).toBe(true);
    expect(page.remainingOutline).toContain('(table)');
    const rest = documentKind.project(content, { mode: 'full', locale: 'en', cursor: page.cursor });
    expect(rest.text).not.toContain('Cover');
  });
});

describe('lint', () => {
  it('reports the document rules', () => {
    const content = prepare({
      blocks: [
        { id: 'a', type: 'heading', level: 1, runs: [{ text: 'A' }] },
        { id: 'b', type: 'heading', level: 3, runs: [{ text: 'B' }] },
        { id: 'c', type: 'paragraph', runs: [{ text: '  ' }] },
        { id: 'd', type: 'image', asset: 'asset://img_1', alt: 'image' },
        { id: 'e', type: 'table', header: [[], []], rows: [[[{ text: '1' }], []]] },
        { id: 'f', type: 'paragraph', runs: [{ text: 'see', link: '#missing' }] },
        { id: 'g', type: 'toc', maxLevel: 1 },
        { id: 'h', type: 'pageBreak' },
      ],
    });
    const codes = documentKind
      .lint(content, { locale: 'en', theme: defaultTheme })
      .map((issue) => `${issue.code}@${issue.target}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'heading_level_skip@block:b',
        'empty_paragraph@block:c',
        'image_alt@block:d',
        'table_without_header@block:e',
        'broken_anchor@block:f',
        'trailing_page_break@block:h',
      ]),
    );
    expect(codes).not.toContain('toc_without_headings@block:g');
    const sections = prepare({
      blocks: [
        { id: 'x', type: 'heading', level: 2, runs: [{ text: 'X' }] },
        { id: 'y', type: 'heading', level: 2, runs: [{ text: 'Y' }] },
        { id: 'z', type: 'toc', maxLevel: 1 },
      ],
    });
    const more = documentKind
      .lint(sections, { locale: 'en', theme: defaultTheme })
      .map((issue) => `${issue.code}@${issue.target}`);
    expect(more).toEqual(expect.arrayContaining(['empty_section@block:x', 'toc_without_headings@block:z']));
    const pt = documentKind.lint(content, { locale: 'pt-BR', theme: defaultTheme });
    expect(pt.find((issue) => issue.code === 'empty_paragraph')?.message).toBe('Parágrafo vazio.');
  });
});

describe('diff', () => {
  it('summarizes changes readably', () => {
    const before = prepare(base);
    const after = applyContent(before, [
      { op: 'replace_text', id: 'p1', find: 'centralizes', replace: 'unifies' },
      { op: 'table_insert_row', id: 'tbl', cells: ['R', '1'] },
      { op: 'update_block', id: 'intro', fields: { level: 2 } },
      { op: 'remove_block', id: 'lst' },
    ]);
    const diff = documentKind.diff(before, after);
    expect(diff).toEqual([
      { type: 'removed', target: 'block:lst', summary: "Removed: List 'one nested two'." },
      { type: 'changed', target: 'block:intro', summary: "Heading 'Introduction': level 1 to 2." },
      {
        type: 'changed',
        target: 'block:p1',
        summary: "Paragraph: 'The portal centralizes suppliers.' to 'The portal unifies suppliers.'.",
      },
      { type: 'changed', target: 'block:tbl', summary: 'Table: rows 1 to 2.' },
    ]);
  });

  it('ignores run splits that render the same', () => {
    const a = prepare({ blocks: [{ id: 'p', type: 'paragraph', runs: [{ text: 'ab' }] }] });
    const b = prepare({
      blocks: [{ id: 'p', type: 'paragraph', runs: [{ text: 'a' }, { text: 'b', bold: false }] }],
    });
    expect(documentKind.diff(a, b)).toEqual([]);
  });
});

describe('parsePartial', () => {
  it('keeps complete blocks and drops the incomplete tail', () => {
    const partial = parsePartialDocument({
      cover: { title: 'Streaming' },
      blocks: [
        { type: 'heading', level: 1, runs: [{ text: 'Done' }] },
        { id: 'x', type: 'paragraph', runs: [{ text: 'Also done' }] },
        { type: 'table', header: [[{ text: 'A' }]], rows: [[[{ text: '1' }], ['half' as unknown]]] },
      ],
    });
    expect(partial?.cover).toEqual({ title: 'Streaming' });
    expect(partial?.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'table']);
    expect(partial?.blocks[2]).toMatchObject({ rows: [] });
    const cut = parsePartialDocument({
      blocks: [
        { type: 'heading', level: 1, runs: [{ text: 'A' }] },
        { type: 'list', items: [{ runs: [{ tex: 'x' }] }] },
      ],
    });
    expect(cut?.blocks).toHaveLength(1);
    expect(parsePartialDocument({ blocks: [{ type: 'heading' }] })?.blocks).toEqual([]);
    expect(parsePartialDocument('nope')).toBeUndefined();
    expect(parsePartialDocument({})).toEqual({ blocks: [] });
  });
});
