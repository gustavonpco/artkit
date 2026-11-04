import { MAX_COLS, MAX_ROWS } from '../address.js';
import { ERR, type FormulaError, isError, type Scalar } from './values.js';
import { cellIndex, type SheetIndex, type WorkbookIndex } from './workbook.js';

/** A rectangular reference produced by evaluating `A1:B9`, `C:C`, a defined name or INDEX. */
export interface RangeRef {
  kind: 'range';
  sheet: SheetIndex;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type Value = Scalar | RangeRef;

export interface EvalContext {
  wb: WorkbookIndex;
  /** Sheet of the formula being evaluated (unprefixed references resolve here). */
  sheet: SheetIndex;
  row: number;
  col: number;
  /** Current value of a cell: freshly computed for formulas recalculated in this pass, cached otherwise. */
  read(sheet: SheetIndex, row: number, col: number): Scalar;
}

export function isRange(value: Value): value is RangeRef {
  return typeof value === 'object' && value !== null && (value as RangeRef).kind === 'range';
}

export function rangeHeight(range: RangeRef): number {
  return range.bottom - range.top + 1;
}

export function rangeWidth(range: RangeRef): number {
  return range.right - range.left + 1;
}

/** Scalar context: a single-cell range yields its value; larger ranges are #VALUE! (no implicit intersection). */
export function toScalar(value: Value, ctx: EvalContext): Scalar {
  if (!isRange(value)) return value;
  if (value.top === value.bottom && value.left === value.right)
    return ctx.read(value.sheet, value.top, value.left);
  return ERR.VALUE;
}

/**
 * Visits the non-empty cells of a range in row-major order. Iterates coordinates for small ranges and the
 * sheet's cell map for large ones (whole columns), so `SUM(C:C)` costs the number of filled cells.
 */
export function forEachCell(
  range: RangeRef,
  ctx: EvalContext,
  visit: (value: Scalar, row: number, col: number) => boolean | undefined,
): void {
  const { sheet } = range;
  const bottom = Math.min(range.bottom, sheet.maxRow);
  const right = Math.min(range.right, sheet.maxCol);
  if (bottom < range.top || right < range.left) return;
  const area = (bottom - range.top + 1) * (right - range.left + 1);
  if (area <= sheet.cells.size * 2) {
    for (let row = range.top; row <= bottom; row++) {
      for (let col = range.left; col <= right; col++) {
        if (!sheet.cells.has(cellIndex(row, col))) continue;
        if (visit(ctx.read(sheet, row, col), row, col) === false) return;
      }
    }
    return;
  }
  const hits: number[] = [];
  for (const key of sheet.cells.keys()) {
    const row = Math.floor(key / MAX_COLS);
    const col = key - row * MAX_COLS;
    if (row >= range.top && row <= bottom && col >= range.left && col <= right) hits.push(key);
  }
  hits.sort((a, b) => a - b);
  for (const key of hits) {
    const row = Math.floor(key / MAX_COLS);
    const col = key - row * MAX_COLS;
    if (visit(ctx.read(sheet, row, col), row, col) === false) return;
  }
}

/** Number of addressable cells in a range (used to count blanks). */
export function rangeArea(range: RangeRef): number {
  return rangeHeight(range) * rangeWidth(range);
}

/** Range clipped to the used area of its sheet, for positional scans (lookups). */
export function clipToUsed(range: RangeRef): RangeRef {
  return {
    ...range,
    bottom: Math.max(range.top - 1, Math.min(range.bottom, range.sheet.maxRow)),
    right: Math.max(range.left - 1, Math.min(range.right, range.sheet.maxCol)),
  };
}

export function makeRange(
  sheet: SheetIndex,
  top: number,
  left: number,
  bottom: number,
  right: number,
): RangeRef | FormulaError {
  if (top < 0 || left < 0 || bottom >= MAX_ROWS || right >= MAX_COLS || top > bottom || left > right)
    return ERR.REF;
  return { kind: 'range', sheet, top, left, bottom, right };
}

/** Flattens arguments for aggregate functions; `fromRange` tells whether the value came from a reference. */
export function forEachArg(
  args: Value[],
  ctx: EvalContext,
  visit: (value: Scalar, fromRange: boolean) => FormulaError | undefined,
): FormulaError | undefined {
  for (const arg of args) {
    if (isRange(arg)) {
      let failure: FormulaError | undefined;
      forEachCell(arg, ctx, (value) => {
        const result = visit(value, true);
        if (result) {
          failure = result;
          return false;
        }
        return true;
      });
      if (failure) return failure;
    } else {
      const result = visit(arg, false);
      if (result) return result;
    }
  }
  return undefined;
}

export function firstError(...values: Scalar[]): FormulaError | undefined {
  for (const value of values) if (isError(value)) return value;
  return undefined;
}
