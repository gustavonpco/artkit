import type { Projection, ProjectionOptions } from './kind.js';

export const DEFAULT_CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  return Math.ceil(text.length / Math.max(1, charsPerToken));
}

/** One unit of projected text. Truncation only happens between items. */
export interface ProjectionItem {
  id: string;
  /** Full text for `full` and `range` modes. */
  text: string;
  /** One-line summary used for `outline` and for the remaining outline after truncation. */
  outline: string;
}

export interface PaginateOptions {
  header?: string;
  footer?: string;
  maxTokens?: number;
  cursor?: string;
  charsPerToken?: number;
  /** Use outlines instead of full text. */
  outlineOnly?: boolean;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^c(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : 0;
}

/**
 * Joins items under a token budget (spec §9.2). When the budget runs out, the text is cut at an item
 * boundary and a cursor plus the outline of the remaining items is returned.
 */
export function paginate(items: ProjectionItem[], options: PaginateOptions = {}): Projection {
  const start = Math.min(decodeCursor(options.cursor), items.length);
  const charsPerToken = options.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const budget = options.maxTokens;
  const parts: string[] = [];
  if (options.header) parts.push(options.header);
  let used = estimateTokens(parts.join('\n'), charsPerToken);
  let index = start;
  for (; index < items.length; index++) {
    const item = items[index]!;
    const chunk = options.outlineOnly ? item.outline : item.text;
    const cost = estimateTokens(chunk, charsPerToken) + 1;
    // Always emit at least one item so a tiny budget still makes progress.
    if (budget !== undefined && used + cost > budget && index > start) break;
    parts.push(chunk);
    used += cost;
  }
  if (index < items.length) {
    const remaining = items.slice(index).map((item) => item.outline);
    return {
      text: parts.join('\n'),
      truncated: true,
      cursor: `c${index}`,
      remainingOutline: remaining.join('\n'),
    };
  }
  if (options.footer) parts.push(options.footer);
  return { text: parts.join('\n'), truncated: false };
}

/** Wraps a projection between explicit data markers so the model treats it as data, not instructions (spec §16). */
export function delimitProjection(artifactId: string, text: string): string {
  return `<artifact-content id="${artifactId}">\n${text}\n</artifact-content>`;
}

/**
 * Parses a range like "a..c", "3-5", "2" or "a,b" against an ordered id list. Numbers are 1-based positions.
 * Returns the selected ids in document order, or undefined when the range does not match anything.
 */
export function selectRange(ids: readonly string[], range: string | undefined): string[] | undefined {
  if (!range) return [...ids];
  const selected = new Set<string>();
  for (const raw of range.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const between = part.includes('..')
      ? part.split('..')
      : /^\d+-\d+$/.test(part)
        ? part.split('-')
        : undefined;
    if (between && between.length === 2) {
      const from = resolvePosition(ids, between[0]!.trim());
      const to = resolvePosition(ids, between[1]!.trim());
      if (from === undefined || to === undefined) return undefined;
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i++) selected.add(ids[i]!);
      continue;
    }
    const position = resolvePosition(ids, part);
    if (position === undefined) return undefined;
    selected.add(ids[position]!);
  }
  return ids.filter((id) => selected.has(id));
}

function resolvePosition(ids: readonly string[], token: string): number | undefined {
  const byId = ids.indexOf(token);
  if (byId >= 0) return byId;
  if (/^\d+$/.test(token)) {
    const index = Number(token) - 1;
    return index >= 0 && index < ids.length ? index : undefined;
  }
  return undefined;
}

/** Applies mode/range/budget to a list of items. Kinds with simple ordered items can use it directly. */
export function projectItems(
  items: ProjectionItem[],
  options: ProjectionOptions,
  extras: { header?: string; footer?: string } = {},
): Projection {
  let selected = items;
  if (options.mode === 'range') {
    const ids = selectRange(
      items.map((item) => item.id),
      options.range,
    );
    selected = ids ? items.filter((item) => ids.includes(item.id)) : [];
  }
  return paginate(selected, {
    ...extras,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.charsPerToken === undefined ? {} : { charsPerToken: options.charsPerToken }),
    outlineOnly: options.mode === 'outline',
  });
}

/** Shortens a string for one-line outlines. */
export function ellipsis(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
