// @vitest-environment jsdom
import { defaultTheme, type RenderContext } from '@artkit-ai/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DocumentEditor, documentEditorCss } from '../src/edit/index.js';
import type { DocumentContent, DocumentOperation } from '../src/index.js';
import { DocumentRenderer, documentCss } from '../src/react/index.js';
import { applyContent, prepare } from './helpers.js';

const ctx: RenderContext = {
  theme: defaultTheme,
  locale: 'en',
  mode: 'screen',
  resolveAssetUrl: (ref) => (ref === 'asset://img_1' ? 'data:image/png;base64,AAAA' : undefined),
};

const content = prepare({
  cover: {
    eyebrow: 'Proposal',
    title: 'Portal',
    subtitle: 'Acme',
    fields: [{ label: 'Client', value: 'Acme' }],
  },
  page: { header: 'Confidential', footer: 'Acme', pageNumbers: true },
  blocks: [
    { id: 'toc', type: 'toc', maxLevel: 2 },
    { id: 'scope', type: 'heading', level: 1, runs: [{ text: 'Scope' }] },
    {
      id: 'p1',
      type: 'paragraph',
      runs: [
        { text: 'See ' },
        { text: 'costs', link: '#costs' },
        { text: ' and ' },
        { text: 'site', link: 'https://example.com', bold: true },
        { text: '. <script>alert(1)</script>\nNext line' },
      ],
    },
    { id: 'costs', type: 'heading', level: 2, runs: [{ text: 'Costs' }] },
    {
      id: 't1',
      type: 'table',
      header: [[{ text: 'Module' }], [{ text: 'Hours' }]],
      rows: [[[{ text: 'Login' }], [{ text: '40' }]]],
      footer: [[{ text: 'Total' }], [{ text: '40' }]],
      align: ['left', 'right'],
      widths: [3, 1],
      caption: 'Estimate',
    },
    { id: 'c1', type: 'callout', tone: 'warning', title: 'Note', runs: [{ text: 'Prices change.' }] },
    { id: 'q1', type: 'quote', runs: [{ text: 'Great.' }], attribution: 'Ana' },
    { id: 'code1', type: 'code', language: 'ts', text: 'const a = 1;' },
    { id: 'img1', type: 'image', asset: 'asset://img_1', alt: 'Flow chart', caption: 'Flow', width: 0.5 },
    { id: 'img2', type: 'image', asset: 'asset://missing', alt: 'Missing chart' },
    {
      id: 'l1',
      type: 'list',
      ordered: true,
      start: 2,
      items: [{ runs: [{ text: 'two' }], children: [{ runs: [{ text: 'sub' }] }], childrenOrdered: false }],
    },
    { id: 'hr', type: 'divider' },
    { id: 'pb', type: 'pageBreak' },
  ],
});

afterEach(() => cleanup());

describe('DocumentRenderer', () => {
  it('renders semantic, escaped HTML with anchors, computed toc and assets', () => {
    const { container } = render(<DocumentRenderer content={content} ctx={ctx} className="custom" />);
    const article = container.querySelector('article.ak-document.custom')!;
    expect(article.getAttribute('style')).toContain('--ak-doc-page-width: 210mm');
    expect(screen.getByRole('heading', { level: 1, name: 'Portal' })).toBeTruthy();
    expect(screen.getByText('Confidential')).toBeTruthy();
    const toc = screen.getByRole('navigation', { name: 'Contents' });
    expect([...toc.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Scope', '#ak-scope'],
      ['Costs', '#ak-costs'],
    ]);
    expect(container.querySelector('#ak-costs')?.tagName).toBe('H2');
    expect(screen.getByText('costs').getAttribute('href')).toBe('#ak-costs');
    const external = screen.getByText('site').closest('a')!;
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
    expect(external.getAttribute('target')).toBe('_blank');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('#ak-p1 br')).not.toBeNull();
    const table = container.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent).toBe('Estimate');
    expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('scope'))).toEqual([
      'col',
      'col',
    ]);
    expect((table.querySelector('tbody td:nth-child(2)') as HTMLElement).style.textAlign).toBe('right');
    expect(table.querySelector('tfoot')?.textContent).toBe('Total40');
    expect((table.querySelector('col') as HTMLElement).style.width).toBe('75%');
    expect(screen.getByRole('note', { name: 'Note' }).className).toContain('ak-document-callout--warning');
    expect(container.querySelector('figcaption')?.textContent).toBe('— Ana');
    expect(container.querySelector('pre code')?.className).toBe('language-ts');
    expect(screen.getByAltText('Flow chart').getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(screen.getByRole('img', { name: 'Missing chart' }).className).toBe(
      'ak-document-image-placeholder',
    );
    expect(container.querySelector('#ak-l1')?.getAttribute('start')).toBe('2');
    expect(container.querySelector('#ak-l1 > li > ul')).not.toBeNull();
    expect(screen.getByRole('separator', { name: 'Page break' })).toBeTruthy();
  });

  it('renders the print layout with @page rules', () => {
    const { container } = render(
      <DocumentRenderer
        content={content}
        ctx={{ ...ctx, mode: 'print', locale: 'pt-BR', provisional: true }}
      />,
    );
    const style = container.querySelector('style')!.textContent!;
    expect(style).toContain('@page { size: 210mm 297mm;');
    expect(style).toContain('@top-center { content: "Confidential"');
    expect(style).toContain('counter(page)');
    expect(container.querySelector('.ak-document--print.ak-document--provisional')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Sumário' })).toBeTruthy();
    expect(screen.queryByText('Confidential')).toBeNull();
  });

  it('exports CSS strings with prefixed classes', () => {
    expect(documentCss).toContain('.ak-document-callout--danger');
    expect(documentCss).toContain('var(--ak-color-accent');
    expect(documentEditorCss).toContain('.ak-tb-button');
    expect(documentEditorCss).toContain('.ak-document-editor-content');
  });
});

describe('DocumentEditor (jsdom smoke)', () => {
  beforeAll(() => {
    // ProseMirror measures layout; jsdom has no layout engine.
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    };
    Range.prototype.getBoundingClientRect = () => rect as DOMRect;
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
    document.elementFromPoint = () => null;
  });

  function editorOf(container: HTMLElement): Editor {
    const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor?: Editor };
    expect(dom?.editor).toBeDefined();
    return dom.editor!;
  }

  it('mounts, emits block operations for edits and absorbs external commits', async () => {
    const emitted: { ops: DocumentOperation[]; kind?: string }[] = [];
    const emit = vi.fn((ops: DocumentOperation[], options?: { kind?: string }) =>
      emitted.push({ ops, ...(options?.kind ? { kind: options.kind } : {}) }),
    );
    const { container, rerender } = render(
      <DocumentEditor content={content} ctx={ctx} emit={emit} readOnly={false} lint={[]} />,
    );
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
    const editor = editorOf(container);
    expect(container.querySelector('[data-block-id="scope"]')?.textContent).toBe('Scope');
    expect(container.querySelector('figure[data-ak-image] img')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA',
    );

    // Typing inside the heading → update_block with typing grouping.
    let scopeEnd = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs.blockId === 'scope') scopeEnd = offset + node.nodeSize - 1;
    });
    act(() => {
      editor.chain().setTextSelection(scopeEnd).insertContent(' and goals').run();
    });
    expect(emitted.at(-1)).toEqual({
      ops: [{ op: 'update_block', id: 'scope', fields: { runs: [{ text: 'Scope and goals' }] } }],
      kind: 'typing',
    });

    // Splitting the heading creates a new paragraph block with a fresh id.
    act(() => {
      editor.commands.splitBlock();
    });
    const insert = emitted.at(-1)!;
    expect(insert.kind).toBe('discrete');
    expect(insert.ops).toEqual([
      { op: 'insert_block', after: 'scope', block: { id: 'p2', type: 'paragraph', runs: [] } },
    ]);

    // The host applies the operations and passes the content back: nothing is emitted again.
    let next = content;
    for (const entry of emitted) next = applyContent(next, entry.ops);
    const count = emitted.length;
    rerender(<DocumentEditor content={next} ctx={ctx} emit={emit} readOnly={false} lint={[]} />);
    expect(emitted).toHaveLength(count);

    // An agent commit changes another block: the editor updates without emitting.
    const agent = applyContent(next, [
      { op: 'replace_text', id: 'c1', find: 'Prices change.', replace: 'Prices are fixed.' },
    ]);
    rerender(
      <DocumentEditor
        content={agent}
        ctx={ctx}
        emit={emit}
        readOnly={false}
        lint={[{ code: 'x', severity: 'warning', target: 'block:q1', message: 'Lint here' }]}
      />,
    );
    expect(emitted).toHaveLength(count);
    expect(container.querySelector('[data-block-id="c1"]')?.textContent).toContain('Prices are fixed.');
    expect(container.querySelector('[data-block-id="q1"]')?.className).toContain('ak-document-editor-lint');
    expect(editor.state.selection.from).toBeGreaterThan(0);

    // Removing a block from the editor emits remove_block.
    act(() => {
      let from = 0;
      let to = 0;
      editor.state.doc.forEach((node, offset) => {
        if (node.attrs.blockId === 'hr') {
          from = offset;
          to = offset + node.nodeSize;
        }
      });
      editor.chain().deleteRange({ from, to }).run();
    });
    expect(emitted.at(-1)?.ops).toEqual([{ op: 'remove_block', id: 'hr' }]);

    // Read-only hides the toolbar and disables editing.
    rerender(<DocumentEditor content={agent} ctx={ctx} emit={emit} readOnly={true} />);
    expect(editor.isEditable).toBe(false);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('converts a paragraph into a list keeping its id', () => {
    const emit = vi.fn();
    const simple: DocumentContent = prepare({
      blocks: [{ id: 'p1', type: 'paragraph', runs: [{ text: 'item' }] }],
    });
    const { container } = render(<DocumentEditor content={simple} ctx={ctx} emit={emit} readOnly={false} />);
    const editor = editorOf(container);
    act(() => {
      editor.chain().setTextSelection(2).toggleBulletList().run();
    });
    expect(emit).toHaveBeenLastCalledWith(
      [{ op: 'update_block', id: 'p1', fields: { type: 'list', items: [{ runs: [{ text: 'item' }] }] } }],
      { kind: 'discrete' },
    );
  });

  it('starts from an empty document and inserts the first block when typing', () => {
    const emit = vi.fn();
    const { container } = render(
      <DocumentEditor
        content={{ blocks: [] }}
        ctx={{ ...ctx, locale: 'pt-BR' }}
        emit={emit}
        readOnly={false}
      />,
    );
    expect(screen.getByRole('toolbar', { name: 'Formatação' })).toBeTruthy();
    const editor = editorOf(container);
    act(() => {
      editor.chain().setTextSelection(1).insertContent('Olá').run();
    });
    expect(emit).toHaveBeenLastCalledWith(
      [{ op: 'insert_block', block: { id: 'p1', type: 'paragraph', runs: [{ text: 'Olá' }] } }],
      { kind: 'discrete' },
    );
  });
});
