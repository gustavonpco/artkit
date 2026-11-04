import type { JSONContent } from '@tiptap/core';
import { canonicalBlock } from '../normalize.js';
import { normalizeRuns } from '../runs.js';
import type { Block, CalloutBlock, ListItem, Run, TableBlock } from '../schema.js';

/**
 * Pure, bidirectional mapping between document blocks and ProseMirror JSON (the TipTap schema built by
 * `documentEditorExtensions`). Every top-level node carries its block id in the `blockId` attribute;
 * blocks the editor does not edit as text (image, toc, page break) are atom nodes that keep every field
 * in attributes, so they survive round trips untouched.
 */

const LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;

type Marks = NonNullable<JSONContent['marks']>;

function runMarks(run: Run): Marks {
  const marks: Marks = [];
  if (run.link) marks.push({ type: 'link', attrs: { href: run.link } });
  if (run.bold) marks.push({ type: 'bold' });
  if (run.italic) marks.push({ type: 'italic' });
  if (run.underline) marks.push({ type: 'underline' });
  if (run.strike) marks.push({ type: 'strike' });
  if (run.code) marks.push({ type: 'code' });
  if (run.superscript) marks.push({ type: 'superscript' });
  if (run.subscript) marks.push({ type: 'subscript' });
  return marks;
}

/** Runs as inline nodes; "\n" becomes a hard break. */
export function runsToInline(runs: readonly Run[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of runs) {
    const marks = runMarks(run);
    run.text.split('\n').forEach((line, index) => {
      if (index > 0) out.push({ type: 'hardBreak' });
      if (line) out.push({ type: 'text', text: line, ...(marks.length ? { marks } : {}) });
    });
  }
  return out;
}

/** Inline nodes as canonical runs. */
export function inlineToRuns(nodes: readonly JSONContent[] | undefined): Run[] {
  const runs: Run[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      runs.push({ text: '\n' });
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;
    const run: Run = { text: node.text };
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold':
        case 'italic':
        case 'underline':
        case 'strike':
        case 'code':
        case 'superscript':
        case 'subscript':
          run[mark.type] = true;
          break;
        case 'link':
          if (typeof mark.attrs?.href === 'string' && mark.attrs.href) run.link = mark.attrs.href;
          break;
        default:
          break;
      }
    }
    runs.push(run);
  }
  return normalizeRuns(runs);
}

function paragraph(runs: readonly Run[], attrs?: Record<string, unknown>): JSONContent {
  const content = runsToInline(runs);
  return { type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) };
}

/** Text of block-level children (paragraphs and anything nested), joined with line breaks. */
function blockChildrenToRuns(nodes: readonly JSONContent[] | undefined): Run[] {
  const parts: Run[][] = [];
  const visit = (node: JSONContent) => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'callout')
      parts.push(inlineToRuns(node.content));
    else if (node.type === 'codeBlock') parts.push([{ text: textOf(node), code: true }]);
    else for (const child of node.content ?? []) visit(child);
  };
  for (const node of nodes ?? []) visit(node);
  const out: Run[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ text: '\n' });
    out.push(...part);
  });
  return normalizeRuns(out);
}

function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

function listNode(items: readonly ListItem[], ordered: boolean, attrs: Record<string, unknown>): JSONContent {
  return {
    type: ordered ? 'orderedList' : 'bulletList',
    attrs,
    content: items.map((item) => ({
      type: 'listItem',
      content: [
        paragraph(item.runs),
        ...(item.children?.length ? [listNode(item.children, item.childrenOrdered ?? ordered, {})] : []),
      ],
    })),
  };
}

function tableNode(block: TableBlock): JSONContent {
  const width = block.header.length;
  const cell = (runs: Run[], col: number, header: boolean): JSONContent => {
    const align = block.align?.[col];
    return {
      type: header ? 'tableHeader' : 'tableCell',
      content: [paragraph(runs, align && align !== 'left' ? { textAlign: align } : undefined)],
    };
  };
  const row = (cells: Run[][], header: boolean): JSONContent => ({
    type: 'tableRow',
    content: Array.from({ length: width }, (_, col) => cell(cells[col] ?? [], col, header)),
  });
  return {
    type: 'table',
    attrs: {
      blockId: block.id,
      caption: block.caption ?? null,
      widths: block.widths ?? null,
      hasFooter: Boolean(block.footer),
      hasAlign: Boolean(block.align),
    },
    content: [
      row(block.header, true),
      ...block.rows.map((cells) => row(cells, false)),
      ...(block.footer ? [row(block.footer, false)] : []),
    ],
  };
}

/** One block as a top-level ProseMirror node. */
export function blockToNode(block: Block): JSONContent {
  const id = block.id;
  switch (block.type) {
    case 'heading':
      return {
        type: 'heading',
        attrs: { blockId: id, level: block.level },
        content: runsToInline(block.runs),
      };
    case 'paragraph':
      return paragraph(block.runs, {
        blockId: id,
        textAlign: block.align && block.align !== 'left' ? block.align : null,
      });
    case 'list':
      return listNode(
        block.items,
        Boolean(block.ordered),
        block.ordered ? { blockId: id, start: block.start ?? 1 } : { blockId: id },
      );
    case 'table':
      return tableNode(block);
    case 'callout':
      return {
        type: 'callout',
        attrs: { blockId: id, tone: block.tone, title: block.title ?? null },
        content: runsToInline(block.runs),
      };
    case 'quote':
      return {
        type: 'blockquote',
        attrs: { blockId: id, attribution: block.attribution ?? null },
        content: [paragraph(block.runs)],
      };
    case 'code':
      return {
        type: 'codeBlock',
        attrs: { blockId: id, language: block.language ?? null },
        ...(block.text ? { content: [{ type: 'text', text: block.text }] } : {}),
      };
    case 'image':
      return {
        type: 'docImage',
        attrs: {
          blockId: id,
          asset: block.asset,
          alt: block.alt,
          caption: block.caption ?? null,
          width: block.width ?? null,
        },
      };
    case 'divider':
      return { type: 'horizontalRule', attrs: { blockId: id } };
    case 'pageBreak':
      return { type: 'pageBreak', attrs: { blockId: id } };
    case 'toc':
      return {
        type: 'toc',
        attrs: { blockId: id, maxLevel: block.maxLevel ?? null, title: block.title ?? null },
      };
  }
}

/** The whole document as ProseMirror JSON. An empty document gets one empty paragraph (ProseMirror needs one). */
export function blocksToDoc(blocks: readonly Block[]): JSONContent {
  const content = blocks.map(blockToNode);
  return {
    type: 'doc',
    content:
      content.length > 0 ? content : [{ type: 'paragraph', attrs: { blockId: null, textAlign: null } }],
  };
}

function listItems(list: JSONContent, depth: number): { items: ListItem[]; ordered: boolean } {
  const ordered = list.type === 'orderedList';
  const items: ListItem[] = [];
  for (const itemNode of list.content ?? []) {
    if (itemNode.type !== 'listItem') continue;
    const textNodes = (itemNode.content ?? []).filter(
      (child) => child.type !== 'bulletList' && child.type !== 'orderedList',
    );
    const nested = (itemNode.content ?? []).filter(
      (child) => child.type === 'bulletList' || child.type === 'orderedList',
    );
    const item: ListItem = { runs: blockChildrenToRuns(textNodes) };
    const children: ListItem[] = [];
    let childOrdered: boolean | undefined;
    for (const sub of nested) {
      const result = listItems(sub, depth + 1);
      childOrdered ??= result.ordered;
      children.push(...result.items);
    }
    if (children.length > 0 && depth >= 3) {
      // The schema allows 3 levels: deeper items become siblings at the third level.
      items.push(item, ...children);
      continue;
    }
    if (children.length > 0) {
      item.children = children;
      if (childOrdered !== ordered) item.childrenOrdered = Boolean(childOrdered);
    }
    items.push(item);
  }
  return { items, ordered };
}

function tableBlock(node: JSONContent, id: string): TableBlock {
  const rows: Run[][][] = [];
  const headerAlign: (string | null)[] = [];
  (node.content ?? []).forEach((rowNode, rowIndex) => {
    const cells: Run[][] = [];
    for (const cellNode of rowNode.content ?? []) {
      const span = Math.max(1, Number(cellNode.attrs?.colspan ?? 1));
      if (rowIndex === 0) {
        const align = cellNode.content?.[0]?.attrs?.textAlign;
        headerAlign.push(typeof align === 'string' ? align : null);
        for (let i = 1; i < span; i++) headerAlign.push(null);
      }
      cells.push(blockChildrenToRuns(cellNode.content));
      for (let i = 1; i < span; i++) cells.push([]);
    }
    rows.push(cells);
  });
  const width = Math.max(1, ...rows.map((row) => row.length));
  const fit = (row: Run[][]) => [
    ...row.slice(0, width),
    ...Array.from({ length: Math.max(0, width - row.length) }, () => [] as Run[]),
  ];
  const [header = [], ...rest] = rows.map(fit);
  const block: TableBlock = { id, type: 'table', header: fit(header), rows: rest };
  if (node.attrs?.hasFooter && block.rows.length > 0) block.footer = block.rows.pop()!;
  const align = Array.from({ length: width }, (_, col) => {
    const value = headerAlign[col];
    return value === 'center' || value === 'right' ? value : 'left';
  });
  if (node.attrs?.hasAlign || align.some((value) => value !== 'left')) block.align = align;
  const widths = node.attrs?.widths;
  if (Array.isArray(widths) && widths.length > 0 && widths.every((w) => typeof w === 'number' && w > 0)) {
    block.widths =
      widths.length === width
        ? widths
        : Array.from({ length: width }, (_, col) => widths[col] ?? widths[widths.length - 1]);
  }
  if (typeof node.attrs?.caption === 'string' && node.attrs.caption) block.caption = node.attrs.caption;
  return block;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** One top-level node as a block, or undefined for nodes without a block equivalent. Ids must be set. */
export function nodeToBlock(node: JSONContent, id: string): Block | undefined {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'heading': {
      const level = Math.min(4, Math.max(1, Number(attrs.level ?? 1)));
      return { id, type: 'heading', level, runs: inlineToRuns(node.content) };
    }
    case 'paragraph': {
      const align = attrs.textAlign;
      return {
        id,
        type: 'paragraph',
        runs: inlineToRuns(node.content),
        ...(align === 'center' || align === 'right' || align === 'justify' ? { align } : {}),
      };
    }
    case 'bulletList':
    case 'orderedList': {
      const { items, ordered } = listItems(node, 1);
      const start = Number(attrs.start ?? 1);
      return {
        id,
        type: 'list',
        ...(ordered ? { ordered: true } : {}),
        ...(ordered && Number.isInteger(start) && start !== 1 && start >= 0 ? { start } : {}),
        items: items.length > 0 ? items : [{ runs: [] }],
      };
    }
    case 'table':
      return tableBlock(node, id);
    case 'callout': {
      const tone = (['info', 'warning', 'success', 'danger'] as const).includes(attrs.tone)
        ? (attrs.tone as CalloutBlock['tone'])
        : 'info';
      const title = str(attrs.title);
      return { id, type: 'callout', tone, ...(title ? { title } : {}), runs: inlineToRuns(node.content) };
    }
    case 'blockquote': {
      const attribution = str(attrs.attribution);
      return {
        id,
        type: 'quote',
        runs: blockChildrenToRuns(node.content),
        ...(attribution ? { attribution } : {}),
      };
    }
    case 'codeBlock': {
      const language = str(attrs.language);
      return {
        id,
        type: 'code',
        ...(language && LANGUAGE.test(language) ? { language } : {}),
        text: textOf(node),
      };
    }
    case 'docImage': {
      const asset = str(attrs.asset);
      if (!asset) return undefined;
      const caption = str(attrs.caption);
      const width =
        typeof attrs.width === 'number' && attrs.width >= 0.1 && attrs.width <= 1 ? attrs.width : undefined;
      return {
        id,
        type: 'image',
        asset,
        alt: str(attrs.alt) ?? asset.slice('asset://'.length),
        ...(caption ? { caption } : {}),
        ...(width !== undefined ? { width } : {}),
      };
    }
    case 'horizontalRule':
      return { id, type: 'divider' };
    case 'pageBreak':
      return { id, type: 'pageBreak' };
    case 'toc': {
      const maxLevel = Number(attrs.maxLevel);
      const title = str(attrs.title);
      return {
        id,
        type: 'toc',
        ...(Number.isInteger(maxLevel) && maxLevel >= 1 && maxLevel <= 4 ? { maxLevel } : {}),
        ...(title ? { title } : {}),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Converts the editor document into blocks. Nodes without a `blockId` (or repeating one) get ids from
 * `newId`, which must return ids unused in the document.
 */
export function docToBlocks(doc: JSONContent, newId: (type: Block['type']) => string): Block[] {
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const node of doc.content ?? []) {
    const probe = nodeToBlock(node, 'probe');
    if (!probe) continue;
    let id = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : '';
    if (!id || seen.has(id)) id = newId(probe.type);
    seen.add(id);
    blocks.push(canonicalBlock({ ...probe, id } as Block));
  }
  return blocks;
}

/** Content blocks as the editor would return them, used as the comparison baseline. */
export function editorView(blocks: readonly Block[]): Block[] {
  if (blocks.length === 0) return [];
  return docToBlocks(blocksToDoc(blocks), () => {
    throw new Error('every block already has an id');
  });
}

/** True for the single empty paragraph ProseMirror keeps in an empty document. */
export function isPlaceholderDoc(doc: JSONContent): boolean {
  const only = doc.content?.length === 1 ? doc.content[0] : undefined;
  return Boolean(only && only.type === 'paragraph' && !only.attrs?.blockId && !(only.content ?? []).length);
}
