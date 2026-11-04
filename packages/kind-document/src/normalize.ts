import type { IdContext } from '@artkit/core';
import { normalizeRuns } from './runs.js';
import { type Block, type BlockInput, ID_PREFIX, type ListItem, type Run } from './schema.js';

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function idPrefix(type: unknown): string {
  return typeof type === 'string' && type in ID_PREFIX ? ID_PREFIX[type as keyof typeof ID_PREFIX] : 'b';
}

/**
 * Lenient preparation of raw content before validation (never throws): fills missing block ids and
 * accepts a few shorthands models often use — `text` instead of `runs`, strings as list items and table
 * cells. Everything else is left for the schema to report.
 */
export function normalizeContent(raw: unknown, ctx: IdContext): unknown {
  if (!isObject(raw) || !Array.isArray(raw.blocks)) return raw;
  for (const block of raw.blocks) {
    if (!isObject(block)) continue;
    expandShorthands(block);
    if (typeof block.id !== 'string' || block.id === '') block.id = ctx.nextId(idPrefix(block.type));
  }
  return raw;
}

function toRuns(value: unknown): unknown {
  return typeof value === 'string' ? (value ? [{ text: value }] : []) : value;
}

function expandShorthands(block: Loose): void {
  if (block.runs === undefined && typeof block.text === 'string' && block.type !== 'code') {
    block.runs = toRuns(block.text);
    delete block.text;
  }
  if (typeof block.runs === 'string') block.runs = toRuns(block.runs);
  if (block.type === 'list' && Array.isArray(block.items)) block.items = block.items.map(expandItem);
  if (block.type === 'table') {
    if (Array.isArray(block.header)) block.header = block.header.map(toRuns);
    if (Array.isArray(block.footer)) block.footer = block.footer.map(toRuns);
    if (Array.isArray(block.rows))
      block.rows = block.rows.map((row) => (Array.isArray(row) ? row.map(toRuns) : row));
  }
}

function expandItem(item: unknown): unknown {
  if (typeof item === 'string') return { runs: toRuns(item) };
  if (!isObject(item)) return item;
  if (item.runs === undefined && typeof item.text === 'string') {
    item.runs = toRuns(item.text);
    delete item.text;
  }
  if (Array.isArray(item.children)) item.children = item.children.map(expandItem);
  return item;
}

function canonicalItems(items: readonly ListItem[]): ListItem[] {
  return items.map((item) => {
    const out: ListItem = { runs: normalizeRuns(item.runs) };
    if (item.children?.length) out.children = canonicalItems(item.children);
    if (item.childrenOrdered !== undefined && item.children?.length)
      out.childrenOrdered = item.childrenOrdered;
    return out;
  });
}

const cells = (row: readonly Run[][]) => row.map((cell) => normalizeRuns(cell));

/** Returns the block with canonical runs (merged neighbors, no empty runs or false flags). */
export function canonicalBlock<T extends Block | BlockInput>(block: T): T {
  const copy = { ...block } as Block;
  switch (copy.type) {
    case 'heading':
    case 'paragraph':
    case 'callout':
    case 'quote':
      copy.runs = normalizeRuns(copy.runs);
      break;
    case 'list':
      copy.items = canonicalItems(copy.items);
      break;
    case 'table':
      copy.header = cells(copy.header);
      copy.rows = copy.rows.map(cells);
      if (copy.footer) copy.footer = cells(copy.footer);
      break;
    default:
      break;
  }
  return copy as T;
}
