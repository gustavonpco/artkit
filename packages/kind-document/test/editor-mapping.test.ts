import { describe, expect, it } from 'vitest';
import {
  blocksToDoc,
  diffBlocksToOperations,
  docToBlocks,
  editorView,
  inlineToRuns,
  isPlaceholderDoc,
  runsToInline,
  updateOperation,
} from '../src/edit/index.js';
import type { Block, DocumentContent } from '../src/index.js';
import { applyContent, prepare } from './helpers.js';

const content = prepare({
  blocks: [
    { id: 'h', type: 'heading', level: 2, runs: [{ text: 'Title' }] },
    {
      id: 'p',
      type: 'paragraph',
      align: 'center',
      runs: [
        { text: 'a ' },
        { text: 'b', bold: true, link: 'https://x.com' },
        { text: '\nline', code: true, italic: true },
      ],
    },
    {
      id: 'l',
      type: 'list',
      ordered: true,
      start: 3,
      items: [
        {
          runs: [{ text: 'one' }],
          children: [{ runs: [{ text: 'sub' }], children: [{ runs: [{ text: 'deep' }] }] }],
          childrenOrdered: false,
        },
        { runs: [] },
      ],
    },
    {
      id: 't',
      type: 'table',
      header: [[{ text: 'A' }], [{ text: 'B' }]],
      rows: [[[{ text: '1' }], []]],
      footer: [[{ text: 'T' }], [{ text: '1', bold: true }]],
      align: ['left', 'right'],
      widths: [2, 1],
      caption: 'Costs',
    },
    {
      id: 'c',
      type: 'callout',
      tone: 'danger',
      title: 'Careful',
      runs: [{ text: 'Hot', superscript: true }],
    },
    { id: 'q', type: 'quote', runs: [{ text: 'Quote\nline 2' }], attribution: 'Ana' },
    { id: 'code', type: 'code', language: 'ts', text: 'let a = 1;\n' },
    { id: 'img', type: 'image', asset: 'asset://img_1', alt: 'Chart of costs', caption: 'Fig 1', width: 0.5 },
    { id: 'd', type: 'divider' },
    { id: 'pb', type: 'pageBreak' },
    { id: 'toc', type: 'toc', maxLevel: 2, title: 'Index' },
  ],
});

describe('ProseMirror mapping', () => {
  it('maps runs to inline nodes and back, with hard breaks', () => {
    const runs = [
      { text: 'x\ny', bold: true },
      { text: 'z', subscript: true, strike: true, underline: true },
    ];
    const inline = runsToInline(runs);
    expect(inline.map((node) => node.type)).toEqual(['text', 'hardBreak', 'text', 'text']);
    expect(inlineToRuns(inline)).toEqual([
      { text: 'x', bold: true },
      { text: '\n' },
      { text: 'y', bold: true },
      { text: 'z', underline: true, strike: true, subscript: true },
    ]);
  });

  it('round-trips every block type with its id', () => {
    const doc = blocksToDoc(content.blocks);
    expect(doc.content?.map((node) => node.attrs?.blockId)).toEqual(content.blocks.map((block) => block.id));
    const back = docToBlocks(doc, () => 'unused');
    // Hard breaks inside a run lose the run's marks on the break itself only.
    const expected = structuredClone(content.blocks) as Block[];
    (expected[1] as { runs: unknown }).runs = [
      { text: 'a ' },
      { text: 'b', bold: true, link: 'https://x.com' },
      { text: '\n' },
      { text: 'line', italic: true, code: true },
    ];
    expect(back).toEqual(expected);
    expect(editorView(back)).toEqual(back);
  });

  it('assigns ids to new or duplicated nodes and handles the placeholder', () => {
    const doc = blocksToDoc(content.blocks.slice(0, 2));
    doc.content!.push(
      { type: 'paragraph', attrs: { blockId: 'h' }, content: [{ type: 'text', text: 'copy' }] },
      { type: 'paragraph' },
    );
    let n = 0;
    const blocks = docToBlocks(doc, (type) => `${type}-${++n}`);
    expect(blocks.map((block) => block.id)).toEqual(['h', 'p', 'paragraph-1', 'paragraph-2']);
    expect(isPlaceholderDoc(blocksToDoc([]))).toBe(true);
    expect(editorView([])).toEqual([]);
  });

  it('normalizes what the schema cannot hold: deep lists, spans and ragged tables', () => {
    const list = docToBlocks(
      {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            attrs: { blockId: 'l' },
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          { type: 'paragraph', content: [{ type: 'text', text: '2' }] },
                          {
                            type: 'orderedList',
                            content: [
                              {
                                type: 'listItem',
                                content: [
                                  { type: 'paragraph', content: [{ type: 'text', text: '3' }] },
                                  {
                                    type: 'bulletList',
                                    content: [
                                      {
                                        type: 'listItem',
                                        content: [
                                          { type: 'paragraph', content: [{ type: 'text', text: '4' }] },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'table',
            attrs: { blockId: 't' },
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    attrs: { colspan: 2 },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AB' }] }],
                  },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [
                      { type: 'paragraph' },
                      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      () => 'new',
    );
    expect(list[0]).toEqual({
      id: 'l',
      type: 'list',
      items: [
        {
          runs: [{ text: '1' }],
          children: [
            {
              runs: [{ text: '2' }],
              children: [{ runs: [{ text: '3' }] }, { runs: [{ text: '4' }] }],
              childrenOrdered: true,
            },
          ],
        },
      ],
    });
    expect(list[1]).toEqual({
      id: 't',
      type: 'table',
      header: [[{ text: 'AB' }], []],
      rows: [[[{ text: '\nx' }], []]],
    });
    expect(() => prepare({ blocks: list })).not.toThrow();
  });
});

describe('block diff to operations', () => {
  it('emits field-level updates with unset', () => {
    const before = content.blocks[1]!;
    const after = { ...before, runs: [{ text: 'new' }] } as Block;
    delete (after as { align?: string }).align;
    expect(updateOperation(before, after)).toEqual({
      op: 'update_block',
      id: 'p',
      fields: { runs: [{ text: 'new' }] },
      unset: ['align'],
    });
    expect(updateOperation(before, structuredClone(before))).toBeUndefined();
    const heading: Block = { id: 'p', type: 'heading', level: 1, runs: [] };
    expect(updateOperation(before, heading)).toEqual({
      op: 'update_block',
      id: 'p',
      fields: { type: 'heading', level: 1, runs: [] },
    });
  });

  it('produces operations that transform before into after (generated cases)', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const base: DocumentContent = { blocks: content.blocks };
    let counter = 0;
    for (let round = 0; round < 200; round++) {
      const after: Block[] = [];
      for (const block of base.blocks) {
        const roll = random();
        if (roll < 0.15) continue;
        if (roll < 0.3) after.push({ id: block.id, type: 'paragraph', runs: [{ text: `changed ${round}` }] });
        else after.push(block);
      }
      for (let i = after.length - 1; i > 0; i--) {
        if (random() < 0.3) {
          const j = Math.floor(random() * (i + 1));
          [after[i], after[j]] = [after[j]!, after[i]!];
        }
      }
      const inserts = Math.floor(random() * 3);
      for (let i = 0; i < inserts; i++) {
        after.splice(Math.floor(random() * (after.length + 1)), 0, {
          id: `new${++counter}`,
          type: 'paragraph',
          runs: [{ text: 'inserted' }],
        });
      }
      const ops = diffBlocksToOperations(base.blocks, after);
      const result = ops.length ? applyContent(base, ops) : base;
      expect(result.blocks).toEqual(after);
    }
  });

  it('reports a single move for one moved block', () => {
    const ids = ['a', 'b', 'c', 'd'].map((id): Block => ({ id, type: 'divider' }));
    const ops = diffBlocksToOperations(ids, [ids[0]!, ids[3]!, ids[1]!, ids[2]!]);
    expect(ops).toEqual([{ op: 'move_block', id: 'd', after: 'a' }]);
  });
});
