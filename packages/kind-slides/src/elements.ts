import type { ChartElement, Paragraph, SlideElement, TableElement } from './schema.js';
import { type NormalizedParagraph, normalizeParagraphs } from './text.js';

type TableFields = Pick<TableElement, 'header' | 'rows' | 'widths'>;
type ChartFields = Pick<ChartElement, 'chartType' | 'categories' | 'series'>;

export function tableColumnCount(table: TableFields): number {
  return Math.max(table.header?.length ?? 0, ...table.rows.map((row) => row.length), 1);
}

/** Column widths in inches for a table of total width `width`. */
export function tableColumnWidths(table: TableFields, width: number): number[] {
  const count = tableColumnCount(table);
  const weights =
    table.widths && table.widths.length === count ? table.widths : new Array<number>(count).fill(1);
  const total = weights.reduce((sum, value) => sum + value, 0) || count;
  return weights.map((value) => (value / total) * width);
}

/** Paragraphs of a text element, with list markers applied for `bullets`. */
export function textElementParagraphs(element: {
  paragraphs?: Paragraph[];
  bullets?: Paragraph[];
}): NormalizedParagraph[] {
  if (element.bullets) return normalizeParagraphs(element.bullets, 'bullet');
  return normalizeParagraphs(element.paragraphs ?? []);
}

export interface FieldProblem {
  /** Path relative to the checked object, e.g. "rows[2]". */
  path: string;
  message: string;
  hint?: string;
}

/** Table integrity: every row and the header have the same number of cells; widths match the columns. */
export function checkTableFields(table: TableFields): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const count = table.header?.length ?? table.rows[0]?.length ?? 0;
  if (count === 0) {
    problems.push({
      path: 'rows',
      message: 'The table has no columns.',
      hint: 'Give at least one header cell or one row.',
    });
    return problems;
  }
  table.rows.forEach((row, index) => {
    if (row.length !== count) {
      problems.push({
        path: `rows[${index}]`,
        message: `The row has ${row.length} cells and the table has ${count} columns.`,
        hint: `Give exactly ${count} cells in each row (use "" for empty cells).`,
      });
    }
  });
  if (table.widths && table.widths.length !== count) {
    problems.push({
      path: 'widths',
      message: `"widths" has ${table.widths.length} values and the table has ${count} columns.`,
      hint: `Give ${count} relative widths or omit "widths".`,
    });
  }
  return problems;
}

/** Chart integrity: one value per category in every series; pie charts take a single series. */
export function checkChartFields(chart: ChartFields): FieldProblem[] {
  const problems: FieldProblem[] = [];
  chart.series.forEach((series, index) => {
    if (series.values.length !== chart.categories.length) {
      problems.push({
        path: `series[${index}].values`,
        message: `Series "${series.name}" has ${series.values.length} values and there are ${chart.categories.length} categories.`,
        hint: `Give exactly ${chart.categories.length} values, one per category.`,
      });
    }
  });
  if (chart.chartType === 'pie' && chart.series.length !== 1) {
    problems.push({
      path: 'series',
      message: 'A pie chart takes exactly one series.',
      hint: 'Keep one series or use a column chart.',
    });
  }
  if (chart.chartType === 'pie' && chart.series[0]?.values.some((value) => value < 0)) {
    problems.push({
      path: 'series[0].values',
      message: 'Pie chart values cannot be negative.',
      hint: 'Use a bar or column chart for negative values.',
    });
  }
  return problems;
}

const DEGENERATE_ALLOWED = new Set(['line', 'arrow']);

/** Geometry and per-type integrity of a free element. Paths are relative to the element. */
export function checkElement(
  element: SlideElement,
  canvas: { width: number; height: number },
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const eps = 0.001;
  if (element.x < -eps || element.y < -eps) {
    problems.push({
      path: element.x < -eps ? 'x' : 'y',
      message: `Element "${element.id}" starts outside the slide (x=${element.x}, y=${element.y}).`,
      hint: 'x and y must be ≥ 0.',
    });
  }
  if (element.x + element.w > canvas.width + eps) {
    problems.push({
      path: 'w',
      message: `Element "${element.id}" ends at x=${round(element.x + element.w)}, beyond the slide width ${canvas.width}.`,
      hint: `Keep x + w ≤ ${canvas.width}: reduce w to at most ${round(Math.max(0, canvas.width - element.x))} or move it left.`,
    });
  }
  if (element.y + element.h > canvas.height + eps) {
    problems.push({
      path: 'h',
      message: `Element "${element.id}" ends at y=${round(element.y + element.h)}, beyond the slide height ${canvas.height}.`,
      hint: `Keep y + h ≤ ${canvas.height}: reduce h to at most ${round(Math.max(0, canvas.height - element.y))} or move it up.`,
    });
  }
  const degenerate = element.type === 'shape' && DEGENERATE_ALLOWED.has(element.shape);
  if (!degenerate && (element.w <= eps || element.h <= eps)) {
    problems.push({
      path: element.w <= eps ? 'w' : 'h',
      message: `Element "${element.id}" has zero size.`,
      hint: 'Give w and h greater than 0.',
    });
  }
  if (degenerate && element.w <= eps && element.h <= eps) {
    problems.push({
      path: 'w',
      message: `Line "${element.id}" has zero length.`,
      hint: 'Give w or h greater than 0.',
    });
  }
  if (element.type === 'table') problems.push(...checkTableFields(element));
  if (element.type === 'chart') problems.push(...checkChartFields(element));
  return problems;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
