import type { Block, ListItem, Run } from './schema.js';

export const RUN_FLAGS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
] as const;
export type RunFlag = (typeof RUN_FLAGS)[number];

/** Formatting of a run without its text, with false flags removed (canonical form). */
export function runFormat(run: Run): Omit<Run, 'text'> {
  const format: Omit<Run, 'text'> = {};
  for (const flag of RUN_FLAGS) if (run[flag]) format[flag] = true;
  if (run.link) format.link = run.link;
  return format;
}

export function sameFormat(a: Run, b: Run): boolean {
  for (const flag of RUN_FLAGS) if (Boolean(a[flag]) !== Boolean(b[flag])) return false;
  return (a.link ?? '') === (b.link ?? '');
}

/** Canonical runs: drops empty runs and false flags, merges neighbors with identical formatting. */
export function normalizeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameFormat(last, run)) {
      last.text += run.text;
      continue;
    }
    out.push({ text: run.text, ...runFormat(run) });
  }
  return out;
}

export function runsText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('');
}

export function plainRuns(text: string): Run[] {
  return text ? [{ text }] : [];
}

export function listItemsText(items: readonly ListItem[]): string {
  return items
    .map((item) =>
      [runsText(item.runs), item.children ? listItemsText(item.children) : ''].filter(Boolean).join(' '),
    )
    .join(' ');
}

/** Plain text of a block, used for outlines, lint and search. */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return runsText(block.runs);
    case 'quote':
      return [runsText(block.runs), block.attribution].filter(Boolean).join(' — ');
    case 'callout':
      return [block.title, runsText(block.runs)].filter(Boolean).join(': ');
    case 'list':
      return listItemsText(block.items);
    case 'table':
      return [block.header, ...block.rows, ...(block.footer ? [block.footer] : [])]
        .map((row) => row.map(runsText).join(' | '))
        .join(' / ');
    case 'code':
      return block.text;
    case 'image':
      return block.caption ? `${block.alt} (${block.caption})` : block.alt;
    case 'toc':
      return block.title ?? '';
    case 'divider':
    case 'pageBreak':
      return '';
  }
}

export type ReplaceResult = { runs: Run[] } | { error: 'not_found' } | { error: 'ambiguous'; count: number };

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return count;
    count++;
    from = index + needle.length;
  }
}

/**
 * Replaces the only occurrence of `find` in the concatenated text of `runs`. The replacement takes the
 * formatting of the run where the match starts; runs outside the match keep their formatting.
 */
export function replaceInRuns(runs: readonly Run[], find: string, replacement: string): Run[] {
  const text = runsText(runs);
  const start = text.indexOf(find);
  if (start < 0) return [...runs];
  const end = start + find.length;
  const out: Run[] = [];
  let offset = 0;
  let inserted = false;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    if (runEnd <= start || runStart >= end) {
      // A zero-length match at a run boundary is inserted into the run that ends there.
      out.push({ ...run });
      if (!inserted && find.length === 0 && runEnd === start) {
        out[out.length - 1]!.text += replacement;
        inserted = true;
      }
      continue;
    }
    const before = run.text.slice(0, Math.max(0, start - runStart));
    const after = run.text.slice(Math.max(0, Math.min(run.text.length, end - runStart)));
    const middle = inserted ? '' : replacement;
    inserted = true;
    out.push({ ...run, text: before + middle + after });
  }
  return normalizeRuns(out);
}
