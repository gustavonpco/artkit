import {
  ellipsis,
  type Projection,
  type ProjectionItem,
  type ProjectionOptions,
  paginate,
} from '@artkit/core';
import { cellKey, formatRange, parseCellKey, parseRange, type Rect, rectContains } from './address.js';
import { resolveCurrency } from './display.js';
import { isoFromSerial } from './formula/dates.js';
import { numberToText } from './formula/values.js';
import { type Cell, isErrorValue, type Sheet, type SheetContent } from './schema.js';

const LABELS = {
  en: {
    sheet: 'Sheet',
    empty: 'empty',
    hidden: 'hidden',
    frozen: (rows: number, cols: number) => `frozen ${rows} row(s), ${cols} col(s)`,
    merges: 'merges',
    validations: 'validations',
    widths: 'widths',
    names: 'Names',
    settings: 'Settings',
    calculationDate: 'calculationDate',
    currency: 'currency',
    cells: (cells: number, formulas: number) => `${cells} cell(s), ${formulas} formula(s)`,
    range: 'range',
    note: 'note',
    notFound: (range: string, sheets: string) =>
      `Range "${range}" not found. Use "Sheet!A1:D20" or a sheet id: ${sheets}.`,
  },
  pt: {
    sheet: 'Aba',
    empty: 'vazia',
    hidden: 'oculta',
    frozen: (rows: number, cols: number) => `congeladas ${rows} linha(s), ${cols} coluna(s)`,
    merges: 'mesclagens',
    validations: 'validações',
    widths: 'larguras',
    names: 'Nomes',
    settings: 'Configurações',
    calculationDate: 'calculationDate',
    currency: 'currency',
    cells: (cells: number, formulas: number) => `${cells} célula(s), ${formulas} fórmula(s)`,
    range: 'intervalo',
    note: 'nota',
    notFound: (range: string, sheets: string) =>
      `Intervalo "${range}" não encontrado. Use "Aba!A1:D20" ou um id de aba: ${sheets}.`,
  },
};

type Labels = (typeof LABELS)['en'];

export function projectionLabels(locale: string): Labels {
  return locale.toLowerCase().startsWith('pt') ? LABELS.pt : LABELS.en;
}

/** Used range of a sheet (A1 to the last filled row/column), undefined when empty. */
export function usedRange(sheet: Sheet): Rect | undefined {
  let bottom = -1;
  let right = -1;
  for (const key of Object.keys(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    if (pos.row > bottom) bottom = pos.row;
    if (pos.col > right) right = pos.col;
  }
  return bottom < 0 ? undefined : { top: 0, left: 0, bottom, right };
}

/** Value as the model reads it: text quoted, dates as ISO, errors as their code. */
export function projectValue(cell: Cell): string {
  const value = cell.v;
  if (value === undefined) return '""';
  if (isErrorValue(value)) return value.error;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return JSON.stringify(value);
  if ((cell.fmt === 'date' || cell.fmt === 'datetime') && value >= 1 && value <= 2_958_465)
    return isoFromSerial(value, cell.fmt === 'datetime');
  return numberToText(value);
}

export function projectCell(key: string, cell: Cell, labels: Labels): string {
  let text = key;
  if (cell.f !== undefined) text += ` =${cell.f} → ${projectValue(cell)}`;
  else if (cell.v !== undefined) text += ` ${projectValue(cell)}`;
  if (cell.fmt && cell.fmt !== 'general') text += ` [${cell.fmt}]`;
  if (cell.note) text += ` (${labels.note}: ${JSON.stringify(ellipsis(cell.note, 120))})`;
  return text;
}

function sheetHeader(sheet: Sheet, labels: Labels): string {
  const range = usedRange(sheet);
  const flags: string[] = [];
  if (sheet.hidden) flags.push(labels.hidden);
  if (sheet.frozen && (sheet.frozen.rows > 0 || sheet.frozen.cols > 0))
    flags.push(labels.frozen(sheet.frozen.rows, sheet.frozen.cols));
  let header = `${labels.sheet} ${JSON.stringify(sheet.name)} (id: ${sheet.id}) ${range ? formatRange(range) : labels.empty}`;
  if (flags.length > 0) header += ` [${flags.join('; ')}]`;
  const details: string[] = [];
  if (sheet.merges?.length) details.push(`${labels.merges}: ${sheet.merges.join(', ')}`);
  if (sheet.validations?.length) {
    details.push(
      `${labels.validations}: ${sheet.validations.map((v) => `${v.range} ∈ [${v.values.map((value) => (typeof value === 'string' ? JSON.stringify(value) : value)).join(', ')}]`).join('; ')}`,
    );
  }
  if (sheet.columns && Object.keys(sheet.columns).length > 0) {
    details.push(
      `${labels.widths}: ${Object.entries(sheet.columns)
        .map(([key, value]) => `${key}=${value.width}`)
        .join(' ')}`,
    );
  }
  return details.length > 0 ? `${header}\n  ${details.join(' | ')}` : header;
}

function sheetSummary(sheet: Sheet, labels: Labels): string {
  const cells = Object.values(sheet.cells);
  const formulas = cells.filter((cell) => cell.f !== undefined).length;
  return `${sheetHeader(sheet, labels).split('\n')[0]} — ${labels.cells(cells.length, formulas)}`;
}

/** Cells of a sheet grouped by row, in row/column order, optionally inside a rectangle. */
function rowsOf(sheet: Sheet, rect?: Rect): Map<number, [number, string, Cell][]> {
  const rows = new Map<number, [number, string, Cell][]>();
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos || (rect && !rectContains(rect, pos.row, pos.col))) continue;
    let list = rows.get(pos.row);
    if (!list) {
      list = [];
      rows.set(pos.row, list);
    }
    list.push([pos.col, key, cell]);
  }
  return new Map(
    [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, list]) => [row, list.sort((a, b) => a[0] - b[0])]),
  );
}

function workbookItem(content: SheetContent, labels: Labels, locale: string): ProjectionItem {
  const lines: string[] = [];
  if (content.names?.length)
    lines.push(`${labels.names}: ${content.names.map((name) => `${name.name}=${name.ref}`).join(', ')}`);
  const settings: string[] = [`${labels.currency} ${resolveCurrency(content, locale)}`];
  if (content.settings?.calculationDate)
    settings.unshift(`${labels.calculationDate} ${content.settings.calculationDate}`);
  lines.push(`${labels.settings}: ${settings.join(', ')}`);
  const text = lines.join('\n');
  return { id: 'workbook', text, outline: text };
}

/** Resolves "Sheet!A1:D20", "'My sheet'!A:C"-less forms, a sheet id or a sheet name. */
function resolveRange(content: SheetContent, range: string): { sheet: Sheet; rect?: Rect } | undefined {
  const trimmed = range.trim();
  const bang = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(trimmed);
  const findSheet = (ref: string) =>
    content.sheets.find((sheet) => sheet.id === ref) ??
    content.sheets.find((sheet) => sheet.name.toUpperCase() === ref.toUpperCase());
  if (bang) {
    const sheet = findSheet(bang[1]?.replace(/''/g, "'") ?? bang[2]!);
    const rect = parseRange(bang[3]!);
    return sheet && rect ? { sheet, rect } : undefined;
  }
  const sheet = findSheet(trimmed);
  if (sheet) return { sheet };
  const rect = parseRange(trimmed);
  const first = content.sheets[0];
  return rect && first ? { sheet: first, rect } : undefined;
}

/**
 * Text projection (spec §9.3): one header per sheet (`Sheet "Resumo" (id: resumo) A1:D6`) followed by one line
 * per row (`A2 "Tech Lead" | B2 =SUM(C2:C9) → 120 | C2 165 [currency]`). Cut at row boundaries.
 */
export function projectSheet(content: SheetContent, options: ProjectionOptions): Projection {
  const labels = projectionLabels(options.locale);
  const pageOptions = {
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.charsPerToken === undefined ? {} : { charsPerToken: options.charsPerToken }),
  };
  const workbook = workbookItem(content, labels, options.locale);

  if (options.mode === 'outline') {
    const items: ProjectionItem[] = content.sheets.map((sheet) => ({
      id: sheet.id,
      text: sheetSummary(sheet, labels),
      outline: sheetSummary(sheet, labels),
    }));
    items.push(workbook);
    return paginate(items, { ...pageOptions, outlineOnly: true });
  }

  let targets: { sheet: Sheet; rect?: Rect }[] = content.sheets.map((sheet) => ({ sheet }));
  if (options.mode === 'range' && options.range) {
    const resolved = resolveRange(content, options.range);
    if (!resolved)
      return {
        text: labels.notFound(options.range, content.sheets.map((sheet) => sheet.id).join(', ')),
        truncated: false,
      };
    targets = [resolved];
  }

  const items: ProjectionItem[] = [];
  if (options.mode === 'full') items.push(workbook);
  for (const { sheet, rect } of targets) {
    const header = sheetHeader(sheet, labels);
    items.push({
      id: sheet.id,
      text: rect ? `${header}\n  ${labels.range}: ${formatRange(rect)}` : header,
      outline: sheetSummary(sheet, labels),
    });
    for (const [row, cells] of rowsOf(sheet, rect)) {
      const first = cells[0]!;
      const last = cells[cells.length - 1]!;
      items.push({
        id: `${sheet.id}!${row + 1}`,
        text: cells.map(([, key, cell]) => projectCell(key, cell, labels)).join(' | '),
        outline: `${sheet.name}!${cellKey(row, first[0])}:${cellKey(row, last[0])}`,
      });
    }
  }
  return paginate(items, pageOptions);
}
