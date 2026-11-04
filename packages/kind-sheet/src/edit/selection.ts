import { type CellPos, MAX_COLS, MAX_ROWS, type Rect, rectContains } from '../address.js';

/**
 * Spreadsheet selection: one or more ranges, the active cell (where typing goes) and the moving corner
 * (`focus`) of the last range, which Shift+arrows extend.
 */
export interface Selection {
  ranges: Rect[];
  active: CellPos;
  anchor: CellPos;
  focus: CellPos;
}

export interface Bounds {
  maxRow: number;
  maxCol: number;
}

export const GRID_BOUNDS: Bounds = { maxRow: MAX_ROWS - 1, maxCol: MAX_COLS - 1 };

export function rectOf(a: CellPos, b: CellPos): Rect {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function singleSelection(pos: CellPos): Selection {
  return { ranges: [rectOf(pos, pos)], active: pos, anchor: pos, focus: pos };
}

function clamp(pos: CellPos, bounds: Bounds): CellPos {
  return {
    row: Math.min(Math.max(0, pos.row), bounds.maxRow),
    col: Math.min(Math.max(0, pos.col), bounds.maxCol),
  };
}

/** Last (current) range. */
export function currentRange(selection: Selection): Rect {
  return selection.ranges[selection.ranges.length - 1]!;
}

/** Moves to a cell; `extend` grows the current range from its anchor (Shift). */
export function selectTo(
  selection: Selection,
  pos: CellPos,
  extend: boolean,
  bounds: Bounds = GRID_BOUNDS,
): Selection {
  const target = clamp(pos, bounds);
  if (!extend) return singleSelection(target);
  const ranges = [...selection.ranges.slice(0, -1), rectOf(selection.anchor, target)];
  return { ranges, active: selection.active, anchor: selection.anchor, focus: target };
}

/** Arrow keys: moves the active cell or, extending, the moving corner. */
export function moveBy(
  selection: Selection,
  dRow: number,
  dCol: number,
  extend: boolean,
  bounds: Bounds = GRID_BOUNDS,
): Selection {
  const from = extend ? selection.focus : selection.active;
  return selectTo(selection, { row: from.row + dRow, col: from.col + dCol }, extend, bounds);
}

/**
 * Ctrl+arrow: jumps to the edge of the current data block, or to the next filled cell across a gap, or to
 * the bound when nothing is left, like spreadsheet applications.
 */
export function jumpBy(
  selection: Selection,
  dRow: number,
  dCol: number,
  extend: boolean,
  filled: (row: number, col: number) => boolean,
  bounds: Bounds = GRID_BOUNDS,
): Selection {
  const from = extend ? selection.focus : selection.active;
  const inside = (row: number, col: number) =>
    row >= 0 && col >= 0 && row <= bounds.maxRow && col <= bounds.maxCol;
  let row = from.row;
  let col = from.col;
  const step = () => {
    row += dRow;
    col += dCol;
  };
  const nextFilled = inside(row + dRow, col + dCol) && filled(row + dRow, col + dCol);
  if (filled(row, col) && nextFilled) {
    while (inside(row + dRow, col + dCol) && filled(row + dRow, col + dCol)) step();
  } else {
    step();
    while (inside(row, col) && !filled(row, col)) step();
    if (!inside(row, col)) {
      row = Math.min(Math.max(row, 0), bounds.maxRow);
      col = Math.min(Math.max(col, 0), bounds.maxCol);
    }
  }
  return selectTo(selection, { row, col }, extend, bounds);
}

/** Ctrl/Cmd+click: adds a new single-cell range and makes it active. */
export function addRange(selection: Selection, pos: CellPos): Selection {
  return { ranges: [...selection.ranges, rectOf(pos, pos)], active: pos, anchor: pos, focus: pos };
}

/** Whole rows (header click); `extend` keeps the anchor row. */
export function selectRows(
  selection: Selection,
  row: number,
  extend: boolean,
  bounds: Bounds = GRID_BOUNDS,
): Selection {
  const anchorRow = extend ? selection.anchor.row : row;
  const rect: Rect = {
    top: Math.min(anchorRow, row),
    bottom: Math.max(anchorRow, row),
    left: 0,
    right: bounds.maxCol,
  };
  const anchor = { row: anchorRow, col: 0 };
  return {
    ranges: [rect],
    active: extend ? selection.active : anchor,
    anchor,
    focus: { row, col: bounds.maxCol },
  };
}

/** Whole columns (header click); `extend` keeps the anchor column. */
export function selectColumns(
  selection: Selection,
  col: number,
  extend: boolean,
  bounds: Bounds = GRID_BOUNDS,
): Selection {
  const anchorCol = extend ? selection.anchor.col : col;
  const rect: Rect = {
    top: 0,
    bottom: bounds.maxRow,
    left: Math.min(anchorCol, col),
    right: Math.max(anchorCol, col),
  };
  const anchor = { row: 0, col: anchorCol };
  return {
    ranges: [rect],
    active: extend ? selection.active : anchor,
    anchor,
    focus: { row: bounds.maxRow, col },
  };
}

export function selectAll(bounds: Bounds = GRID_BOUNDS): Selection {
  return {
    ranges: [{ top: 0, left: 0, bottom: bounds.maxRow, right: bounds.maxCol }],
    active: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
    focus: { row: bounds.maxRow, col: bounds.maxCol },
  };
}

/**
 * Enter/Tab after a commit: moves inside a multi-cell range (wrapping) or, for a single cell, to the next
 * cell down/right (up/left with Shift).
 */
export function advance(
  selection: Selection,
  direction: 'down' | 'up' | 'right' | 'left',
  bounds: Bounds = GRID_BOUNDS,
): Selection {
  const range = currentRange(selection);
  const single = range.top === range.bottom && range.left === range.right;
  const d =
    direction === 'down' ? [1, 0] : direction === 'up' ? [-1, 0] : direction === 'right' ? [0, 1] : [0, -1];
  if (single || selection.ranges.length > 1) return moveBy(selection, d[0]!, d[1]!, false, bounds);
  let { row, col } = selection.active;
  const height = range.bottom - range.top + 1;
  const width = range.right - range.left + 1;
  if (d[0] !== 0) {
    row += d[0]!;
    if (row > range.bottom || row < range.top) {
      row = row > range.bottom ? range.top : range.bottom;
      col = range.left + ((col - range.left + d[0]! + width) % width);
    }
  } else {
    col += d[1]!;
    if (col > range.right || col < range.left) {
      col = col > range.right ? range.left : range.right;
      row = range.top + ((row - range.top + d[1]! + height) % height);
    }
  }
  return { ...selection, active: { row, col } };
}

export function isSelected(selection: Selection, row: number, col: number): boolean {
  return selection.ranges.some((rect) => rectContains(rect, row, col));
}

/** Rectangle limited to the used area (plus the active cell), so whole-column selections stay small. */
export function clipRect(rect: Rect, used: { rows: number; cols: number }): Rect {
  return {
    top: rect.top,
    left: rect.left,
    bottom: Math.max(rect.top, Math.min(rect.bottom, used.rows - 1)),
    right: Math.max(rect.left, Math.min(rect.right, used.cols - 1)),
  };
}
