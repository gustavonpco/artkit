import type { Paragraph, Run } from './schema.js';

/** Paragraph in canonical form, used by renderers, exporters, lint and the editor. */
export interface NormalizedParagraph {
  runs: Run[];
  list?: 'bullet' | 'number';
  level: number;
}

export function normalizeParagraph(
  paragraph: Paragraph,
  defaultList?: 'bullet' | 'number',
): NormalizedParagraph {
  if (typeof paragraph === 'string') {
    return { runs: [{ text: paragraph }], level: 0, ...(defaultList ? { list: defaultList } : {}) };
  }
  const runs = paragraph.runs ?? [{ text: paragraph.text ?? '' }];
  const list = paragraph.list ?? defaultList;
  return { runs, level: paragraph.level ?? 0, ...(list ? { list } : {}) };
}

export function normalizeParagraphs(
  paragraphs: readonly Paragraph[],
  defaultList?: 'bullet' | 'number',
): NormalizedParagraph[] {
  return paragraphs.map((paragraph) => normalizeParagraph(paragraph, defaultList));
}

export function paragraphText(paragraph: Paragraph | NormalizedParagraph): string {
  if (typeof paragraph === 'string') return paragraph;
  if ('runs' in paragraph && paragraph.runs) return paragraph.runs.map((run) => run.text).join('');
  return (paragraph as { text?: string }).text ?? '';
}

/** Turns canonical paragraphs back into the most compact schema form (plain strings when possible). */
export function denormalizeParagraph(
  paragraph: NormalizedParagraph,
  defaultList?: 'bullet' | 'number',
): Paragraph {
  const runs = mergeRuns(paragraph.runs);
  const first = runs[0] ?? { text: '' };
  const plain = runs.length === 1 && Object.keys(first).length === 1;
  const listDiffers = paragraph.list !== undefined && paragraph.list !== defaultList;
  if (plain && !listDiffers && paragraph.level === 0) return first.text;
  return {
    ...(plain ? { text: first.text } : { runs }),
    ...(listDiffers ? { list: paragraph.list } : {}),
    ...(paragraph.level > 0 ? { level: paragraph.level } : {}),
  };
}

function sameMarks(a: Run, b: Run): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    a.color === b.color &&
    a.link === b.link
  );
}

/** Merges adjacent runs with identical formatting and drops empty runs (keeps at least one run). */
export function mergeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, run)) out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push(cleanRun(run));
  }
  return out.length > 0 ? out : [{ text: '' }];
}

function cleanRun(run: Run): Run {
  const out: Run = { text: run.text };
  if (run.bold) out.bold = true;
  if (run.italic) out.italic = true;
  if (run.underline) out.underline = true;
  if (run.color) out.color = run.color;
  if (run.link) out.link = run.link;
  return out;
}

/** Projection-friendly text: **bold**, _italic_, list markers and indentation. */
export function paragraphMarkdown(paragraph: NormalizedParagraph, ordinal: number): string {
  const text = paragraph.runs
    .map((run) => {
      let value = run.text;
      if (!value.trim()) return value;
      if (run.italic) value = `_${value}_`;
      if (run.bold) value = `**${value}**`;
      return value;
    })
    .join('');
  const indent = '  '.repeat(paragraph.level);
  if (paragraph.list === 'bullet') return `${indent}- ${text}`;
  if (paragraph.list === 'number') return `${indent}${ordinal}. ${text}`;
  return `${indent}${text}`;
}

/** Number shown for each numbered paragraph: counts consecutive numbered items per level. */
export function listOrdinals(paragraphs: readonly NormalizedParagraph[]): number[] {
  const counters: number[] = [];
  return paragraphs.map((paragraph) => {
    if (paragraph.list !== 'number') {
      if (paragraph.list === undefined) counters.length = 0;
      return 0;
    }
    counters.length = paragraph.level + 1;
    counters[paragraph.level] = (counters[paragraph.level] ?? 0) + 1;
    return counters[paragraph.level]!;
  });
}
