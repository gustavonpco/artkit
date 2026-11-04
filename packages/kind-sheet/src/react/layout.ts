import {
  cellKey,
  columnLetter,
  MAX_COLS,
  MAX_ROWS,
  parseCellKey,
  parseRange,
  type Rect,
} from '../address.js';
import { DEFAULT_COLUMN_WIDTH } from '../lint.js';
import type { Sheet } from '../schema.js';

/** Default row height in px (≈ 15pt). */
export const DEFAULT_ROW_PX = 22;
export const HEADER_HEIGHT = 24;
export const ROW_HEADER_WIDTH = 48;
/** Rows/columns of empty space shown after the used range. */
const EXTRA_ROWS = 50;
const EXTRA_COLS = 10;

/** Column width in characters → pixels (about 7px per character plus padding, like spreadsheet apps). */
export function columnPx(chars: number): number {
  return Math.round(chars * 7 + 5);
}

/** Row height in points → pixels. */
export function rowPx(points: number): number {
  return Math.round((points * 4) / 3);
}

/** Largest index whose start offset is <= position (offsets are increasing prefix sums). */
export function indexAt(offsets: ArrayLike<number>, position: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= position) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

export interface MergeInfo {
  /** Merge rectangles keyed by anchor (top-left) key. */
  anchors: Map<string, Rect>;
  /** Covered (non-anchor) cell key → anchor key. */
  covered: Map<string, string>;
  rects: Rect[];
}

export function mergeInfo(sheet: Sheet): MergeInfo {
  const anchors = new Map<string, Rect>();
  const covered = new Map<string, string>();
  const rects: Rect[] = [];
  for (const merge of sheet.merges ?? []) {
    const rect = parseRange(merge);
    if (!rect) continue;
    rects.push(rect);
    const anchor = cellKey(rect.top, rect.left);
    anchors.set(anchor, rect);
    for (let row = rect.top; row <= rect.bottom; row++) {
      for (let col = rect.left; col <= rect.right; col++)
        if (row !== rect.top || col !== rect.left) covered.set(cellKey(row, col), anchor);
    }
  }
  return { anchors, covered, rects };
}

export interface Window {
  rows: number[];
  cols: number[];
}

/**
 * Geometry of a sheet: prefix sums of column widths and row heights over the used range plus some empty
 * space, binary search for the visible window, and merge lookup.
 */
export class SheetLayout {
  readonly rowCount: number;
  readonly colCount: number;
  readonly rowOffsets: Float64Array;
  readonly colOffsets: Float64Array;
  readonly frozenRows: number;
  readonly frozenCols: number;
  readonly merges: MergeInfo;

  constructor(
    readonly sheet: Sheet,
    minimum: { rows?: number; cols?: number } = {},
  ) {
    let usedRows = 0;
    let usedCols = 0;
    for (const key of Object.keys(sheet.cells)) {
      const pos = parseCellKey(key);
      if (!pos) continue;
      usedRows = Math.max(usedRows, pos.row + 1);
      usedCols = Math.max(usedCols, pos.col + 1);
    }
    this.merges = mergeInfo(sheet);
    for (const rect of this.merges.rects) {
      usedRows = Math.max(usedRows, rect.bottom + 1);
      usedCols = Math.max(usedCols, rect.right + 1);
    }
    this.frozenRows = sheet.frozen?.rows ?? 0;
    this.frozenCols = sheet.frozen?.cols ?? 0;
    this.rowCount = Math.min(
      MAX_ROWS,
      Math.max(usedRows + EXTRA_ROWS, 100, this.frozenRows + 1, minimum.rows ?? 0),
    );
    this.colCount = Math.min(
      MAX_COLS,
      Math.max(usedCols + EXTRA_COLS, 26, this.frozenCols + 1, minimum.cols ?? 0),
    );
    this.rowOffsets = new Float64Array(this.rowCount + 1);
    for (let row = 0; row < this.rowCount; row++) {
      const height = sheet.rows?.[String(row + 1)]?.height;
      this.rowOffsets[row + 1] =
        this.rowOffsets[row]! + (height === undefined ? DEFAULT_ROW_PX : rowPx(height));
    }
    this.colOffsets = new Float64Array(this.colCount + 1);
    for (let col = 0; col < this.colCount; col++) {
      const width = sheet.columns?.[columnLetter(col)]?.width ?? DEFAULT_COLUMN_WIDTH;
      this.colOffsets[col + 1] = this.colOffsets[col]! + columnPx(width);
    }
  }

  get width(): number {
    return this.colOffsets[this.colCount]!;
  }

  get height(): number {
    return this.rowOffsets[this.rowCount]!;
  }

  get frozenWidth(): number {
    return this.colOffsets[this.frozenCols]!;
  }

  get frozenHeight(): number {
    return this.rowOffsets[this.frozenRows]!;
  }

  rowTop(row: number): number {
    return this.rowOffsets[row]!;
  }

  rowHeight(row: number): number {
    return this.rowOffsets[row + 1]! - this.rowOffsets[row]!;
  }

  colLeft(col: number): number {
    return this.colOffsets[col]!;
  }

  colWidth(col: number): number {
    return this.colOffsets[col + 1]! - this.colOffsets[col]!;
  }

  /** Pixel box of a rectangle of cells (relative to A1). */
  box(rect: Rect): { top: number; left: number; width: number; height: number } {
    const bottom = Math.min(rect.bottom, this.rowCount - 1);
    const right = Math.min(rect.right, this.colCount - 1);
    return {
      top: this.rowTop(rect.top),
      left: this.colLeft(rect.left),
      width: this.colOffsets[right + 1]! - this.colLeft(rect.left),
      height: this.rowOffsets[bottom + 1]! - this.rowTop(rect.top),
    };
  }

  /** Rows and columns to render for a scroll position: frozen ones plus the visible window with overscan. */
  window(scrollTop: number, scrollLeft: number, viewWidth: number, viewHeight: number, overscan = 3): Window {
    const range = (
      offsets: Float64Array,
      count: number,
      frozen: number,
      scroll: number,
      size: number,
      frozenSize: number,
    ) => {
      const out: number[] = [];
      for (let i = 0; i < frozen; i++) out.push(i);
      const start = Math.max(frozen, indexAt(offsets, scroll + frozenSize) - overscan);
      const end = Math.min(count - 1, indexAt(offsets, scroll + size) + overscan);
      for (let i = start; i <= end; i++) out.push(i);
      return out;
    };
    return {
      rows: range(this.rowOffsets, this.rowCount, this.frozenRows, scrollTop, viewHeight, this.frozenHeight),
      cols: range(this.colOffsets, this.colCount, this.frozenCols, scrollLeft, viewWidth, this.frozenWidth),
    };
  }

  /** Cell under a point in content coordinates (relative to A1, without headers). */
  cellAt(x: number, y: number): { row: number; col: number } {
    return { row: indexAt(this.rowOffsets, Math.max(0, y)), col: indexAt(this.colOffsets, Math.max(0, x)) };
  }
}
