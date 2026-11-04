import {
  ellipsis,
  type Projection,
  type ProjectionItem,
  type ProjectionOptions,
  projectItems,
} from '@artkit/core';
import { blockToMarkdown } from './markdown/serialize.js';
import { blockText } from './runs.js';
import type { Block, Cover, DocumentContent, PageSetup } from './schema.js';

/** Inserts the `<!-- #id -->` anchor at the end of the first line of a block (spec §9.3). */
function withAnchor(text: string, id: string): string {
  const anchor = `<!-- #${id} -->`;
  const newline = text.indexOf('\n');
  if (newline < 0) return `${text} ${anchor}`;
  return `${text.slice(0, newline)} ${anchor}${text.slice(newline)}`;
}

function blockSummary(block: Block): string {
  switch (block.type) {
    case 'table':
      return `${block.header.length} cols × ${block.rows.length} rows${block.footer ? ' + footer' : ''}: ${ellipsis(blockText({ ...block, rows: [], footer: undefined } as Block), 60)}`;
    case 'list':
      return `${block.ordered ? 'ordered' : 'bulleted'}, ${block.items.length} items: ${ellipsis(blockText(block), 60)}`;
    case 'callout':
      return `${block.tone}: ${ellipsis(blockText(block), 60)}`;
    case 'code':
      return `${block.language ?? 'text'}, ${block.text.split('\n').length} lines`;
    case 'image':
      return `${block.asset} "${ellipsis(block.alt, 50)}"`;
    case 'toc':
      return `levels 1-${block.maxLevel ?? 3}`;
    case 'divider':
    case 'pageBreak':
      return '';
    default:
      return ellipsis(blockText(block), 70);
  }
}

/** One outline line: headings keep their Markdown level, other blocks become an indented summary. */
export function outlineLine(block: Block): string {
  if (block.type === 'heading')
    return `${'#'.repeat(block.level)} ${ellipsis(blockText(block), 100)} <!-- #${block.id} -->`;
  const summary = blockSummary(block);
  return `  - ${block.id} (${block.type})${summary ? `: ${summary}` : ''}`;
}

export function coverLines(cover: Cover | undefined, page: PageSetup | undefined): string[] {
  const lines: string[] = [];
  if (cover) {
    const parts = [`Cover: "${cover.title}"`];
    if (cover.eyebrow) parts.push(`eyebrow "${cover.eyebrow}"`);
    if (cover.subtitle) parts.push(`subtitle "${cover.subtitle}"`);
    if (cover.fields?.length)
      parts.push(`fields: ${cover.fields.map((field) => `${field.label}: ${field.value}`).join('; ')}`);
    lines.push(`<!-- ${parts.join(' | ').replace(/--/g, '—')} -->`);
  }
  if (page) lines.push(`<!-- Page: ${JSON.stringify(page)} -->`);
  return lines;
}

export function projectionItems(content: DocumentContent): ProjectionItem[] {
  let previous: Block | undefined;
  return content.blocks.map((block) => {
    const markdown = blockToMarkdown(block, { previous });
    previous = block;
    const text =
      markdown === '' ? `(empty ${block.type}) <!-- #${block.id} -->` : withAnchor(markdown, block.id);
    return { id: block.id, text, outline: outlineLine(block) };
  });
}

/** Markdown with an id anchor per block; outline lists headings and one line per other block. */
export function projectDocument(content: DocumentContent, options: ProjectionOptions): Projection {
  const items = projectionItems(content);
  const showHeader = !options.cursor && options.mode !== 'range';
  const header = showHeader ? coverLines(content.cover, content.page).join('\n') : '';
  const projection = projectItems(items, options, header ? { header } : {});
  if (projection.text === '' && items.length === 0)
    return { ...projection, text: '(empty document: no blocks yet)' };
  return projection;
}
