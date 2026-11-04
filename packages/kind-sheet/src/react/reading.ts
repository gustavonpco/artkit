import { cellKey, parseCellKey, type Rect } from '../address.js';
import { type DisplayOptions, formatCellValue } from '../display.js';
import type { Sheet } from '../schema.js';

export interface SelectionStats {
  /** Non-empty cells. */
  count: number;
  /** Numeric cells. */
  numbers: number;
  sum: number;
  average?: number;
  min?: number;
  max?: number;
}

/** Status-bar statistics of a range, like spreadsheets show for the selection. */
export function selectionStats(sheet: Sheet, rect: Rect): SelectionStats {
  let count = 0;
  let numbers = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  // Iterate filled cells only: whole-column selections stay cheap.
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos || pos.row < rect.top || pos.row > rect.bottom || pos.col < rect.left || pos.col > rect.right)
      continue;
    if (cell.v === undefined || cell.v === '') continue;
    count++;
    if (typeof cell.v === 'number') {
      numbers++;
      sum += cell.v;
      min = Math.min(min, cell.v);
      max = Math.max(max, cell.v);
    }
  }
  return numbers > 0 ? { count, numbers, sum, average: sum / numbers, min, max } : { count, numbers, sum };
}

/**
 * Cells whose displayed text (or formula) contains the query, case- and accent-insensitive, in reading
 * order (rows, then columns).
 */
export function findCells(
  sheet: Sheet,
  query: string,
  display: DisplayOptions,
): { row: number; col: number }[] {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return [];
  const hits: { row: number; col: number }[] = [];
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    const shown = formatCellValue(cell.v, cell.fmt, display);
    if (fold(shown).includes(needle) || (cell.f !== undefined && fold(cell.f).includes(needle)))
      hits.push(pos);
  }
  return hits.sort((a, b) => a.row - b.row || a.col - b.col);
}

export function rectOf(a: { row: number; col: number }, b: { row: number; col: number }): Rect {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

export { cellKey };
