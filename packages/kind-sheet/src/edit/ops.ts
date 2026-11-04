import { cellKey, columnLetter, formatRange, parseCellKey, type Rect } from '../address.js';
import type { CellPatch, StylePatch } from '../cells.js';
import type { SheetOperation } from '../operations.js';
import type { BorderStyle, CellBorder, NamedFormat, Sheet } from '../schema.js';
import { clipRect } from './selection.js';

export type BorderPreset = 'all' | 'outer' | 'bottom' | 'none';

/** Used size of a sheet (rows, cols), at least 1x1. */
export function usedSize(sheet: Sheet): { rows: number; cols: number } {
  let rows = 1;
  let cols = 1;
  for (const key of Object.keys(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    rows = Math.max(rows, pos.row + 1);
    cols = Math.max(cols, pos.col + 1);
  }
  return { rows, cols };
}

/** Ranges for range operations: whole rows/columns are limited to the used area. */
export function operationRanges(sheet: Sheet, ranges: Rect[]): string[] {
  const used = usedSize(sheet);
  return ranges.map((rect) => formatRange(clipRect(rect, used)));
}

export function clearOps(
  sheet: Sheet,
  ranges: Rect[],
  what: 'contents' | 'formats' | 'all' = 'contents',
): SheetOperation[] {
  return operationRanges(sheet, ranges).map((range) => ({ op: 'clear_range', sheet: sheet.id, range, what }));
}

export function styleOps(sheet: Sheet, ranges: Rect[], style: StylePatch): SheetOperation[] {
  return operationRanges(sheet, ranges).map((range) => ({
    op: 'set_range_style',
    sheet: sheet.id,
    range,
    style,
  }));
}

export function formatOps(sheet: Sheet, ranges: Rect[], fmt: NamedFormat | null): SheetOperation[] {
  return operationRanges(sheet, ranges).map((range) => ({
    op: 'set_range_format',
    sheet: sheet.id,
    range,
    fmt,
  }));
}

/** Borders: `all`/`none` style every cell; `outer` and `bottom` merge sides into each edge cell's border. */
export function borderOps(
  sheet: Sheet,
  ranges: Rect[],
  preset: BorderPreset,
  kind: BorderStyle = 'thin',
): SheetOperation[] {
  if (preset === 'all')
    return styleOps(sheet, ranges, { border: { top: kind, right: kind, bottom: kind, left: kind } });
  if (preset === 'none') return styleOps(sheet, ranges, { border: null });
  const used = usedSize(sheet);
  const cells: Record<string, CellPatch> = {};
  for (const range of ranges) {
    const rect = clipRect(range, used);
    for (let row = rect.top; row <= rect.bottom; row++) {
      for (let col = rect.left; col <= rect.right; col++) {
        const sides: CellBorder = {};
        if (row === rect.bottom) sides.bottom = kind;
        if (preset === 'outer') {
          if (row === rect.top) sides.top = kind;
          if (col === rect.left) sides.left = kind;
          if (col === rect.right) sides.right = kind;
        }
        if (Object.keys(sides).length === 0) continue;
        const key = cellKey(row, col);
        const current = sheet.cells[key]?.s?.border;
        cells[key] = { s: { border: { ...current, ...sides } } };
      }
    }
  }
  return Object.keys(cells).length > 0 ? [{ op: 'set_cells', sheet: sheet.id, cells }] : [];
}

export function insertRowsOp(sheet: Sheet, rect: Rect, where: 'above' | 'below'): SheetOperation {
  const count = rect.bottom - rect.top + 1;
  return {
    op: 'insert_rows',
    sheet: sheet.id,
    at: (where === 'above' ? rect.top : rect.bottom + 1) + 1,
    count: Math.min(count, 10_000),
  };
}

export function deleteRowsOp(sheet: Sheet, rect: Rect): SheetOperation {
  const used = usedSize(sheet);
  const bottom = Math.min(rect.bottom, Math.max(rect.top, used.rows - 1));
  return { op: 'delete_rows', sheet: sheet.id, at: rect.top + 1, count: bottom - rect.top + 1 };
}

export function insertColumnsOp(sheet: Sheet, rect: Rect, where: 'left' | 'right'): SheetOperation {
  const count = rect.right - rect.left + 1;
  return {
    op: 'insert_columns',
    sheet: sheet.id,
    at: columnLetter(where === 'left' ? rect.left : rect.right + 1),
    count: Math.min(count, 1000),
  };
}

export function deleteColumnsOp(sheet: Sheet, rect: Rect): SheetOperation {
  const used = usedSize(sheet);
  const right = Math.min(rect.right, Math.max(rect.left, used.cols - 1));
  return { op: 'delete_columns', sheet: sheet.id, at: columnLetter(rect.left), count: right - rect.left + 1 };
}

/** Fill target from dragging the fill handle from `source` to a cell: extends along the dominant axis. */
export function fillTarget(source: Rect, row: number, col: number): Rect {
  const down = row - source.bottom;
  const up = source.top - row;
  const right = col - source.right;
  const left = source.left - col;
  const vertical = Math.max(down, up);
  const horizontal = Math.max(right, left);
  if (vertical <= 0 && horizontal <= 0) return source;
  if (vertical >= horizontal) return down > 0 ? { ...source, bottom: row } : { ...source, top: row };
  return right > 0 ? { ...source, right: col } : { ...source, left: col };
}

export function fillOp(sheet: Sheet, source: Rect, target: Rect): SheetOperation {
  return { op: 'fill_range', sheet: sheet.id, source: formatRange(source), target: formatRange(target) };
}

/** Unique sheet name like "Sheet2" / "Planilha2". */
export function nextSheetName(names: string[], base: string): string {
  const taken = new Set(names.map((name) => name.toUpperCase()));
  for (let n = names.length + 1; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate.toUpperCase())) return candidate;
  }
}

function isNumberCell(sheet: Sheet, row: number, col: number): boolean {
  return typeof sheet.cells[cellKey(row, col)]?.v === 'number';
}

/**
 * AutoSum like spreadsheets: with several cells selected, writes SUM under each selected column (or to the
 * right of a single selected row); with one cell, sums the contiguous numbers above it (or to its left).
 */
export function autoSumOps(sheet: Sheet, range: Rect): SheetOperation[] {
  const cells: Record<string, CellPatch> = {};
  const single = range.top === range.bottom && range.left === range.right;
  if (single) {
    const { top: row, left: col } = range;
    let start = row - 1;
    while (start >= 0 && isNumberCell(sheet, start, col)) start--;
    if (start < row - 1) {
      cells[cellKey(row, col)] = { f: `SUM(${columnLetter(col)}${start + 2}:${columnLetter(col)}${row})` };
    } else {
      let left = col - 1;
      while (left >= 0 && isNumberCell(sheet, row, left)) left--;
      if (left === col - 1) return [];
      cells[cellKey(row, col)] = {
        f: `SUM(${columnLetter(left + 1)}${row + 1}:${columnLetter(col - 1)}${row + 1})`,
      };
    }
  } else if (range.top === range.bottom) {
    const target = cellKey(range.top, range.right + 1);
    cells[target] = {
      f: `SUM(${columnLetter(range.left)}${range.top + 1}:${columnLetter(range.right)}${range.top + 1})`,
    };
  } else {
    for (let col = range.left; col <= range.right; col++) {
      cells[cellKey(range.bottom + 1, col)] = {
        f: `SUM(${columnLetter(col)}${range.top + 1}:${columnLetter(col)}${range.bottom + 1})`,
      };
    }
  }
  // Keep the number format of the summed cells.
  for (const [key, patch] of Object.entries(cells)) {
    const pos = parseCellKey(key)!;
    const above = sheet.cells[cellKey(Math.max(0, pos.row - 1), pos.col)];
    if (above?.fmt) patch.fmt = above.fmt;
  }
  return [{ op: 'set_cells', sheet: sheet.id, cells }];
}

/**
 * Sort operation for the selection: a single cell or column sorts the whole data region of the used area
 * (header kept when the first row is text over numbers); otherwise the selected block.
 */
export function sortOps(sheet: Sheet, range: Rect, column: number, descending: boolean): SheetOperation[] {
  const used = usedSize(sheet);
  const singleColumn = range.left === range.right;
  const rect: Rect = singleColumn
    ? { top: 0, bottom: used.rows - 1, left: 0, right: used.cols - 1 }
    : clipRect(range, used);
  if (rect.bottom <= rect.top) return [];
  const first = sheet.cells[cellKey(rect.top, column)];
  const second = sheet.cells[cellKey(rect.top + 1, column)];
  const header =
    typeof first?.v === 'string' && (second === undefined || typeof second.v !== 'string' || singleColumn);
  return [
    {
      op: 'sort_range',
      sheet: sheet.id,
      range: formatRange(rect),
      by: [{ column: columnLetter(column), descending }],
      header,
    },
  ];
}
