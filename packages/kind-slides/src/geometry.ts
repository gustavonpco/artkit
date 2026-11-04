/** Slide canvas in inches (16:9, the PowerPoint "widescreen" size). */
export const CANVAS = { width: 13.333, height: 7.5 } as const;

/** Canvas width in points; font sizes are converted to container units against it. */
export const CANVAS_WIDTH_PT = CANVAS.width * 72;

/** Tolerance for float noise when checking bounds (inches). */
export const EPSILON = 0.001;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Formats a number for projections: at most two decimals, no trailing zeros. */
export function fmt(value: number): string {
  return String(round(value, 2));
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.w;
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.h;
}

export function insideCanvas(rect: Rect): boolean {
  return (
    rect.x >= -EPSILON &&
    rect.y >= -EPSILON &&
    rect.x + rect.w <= CANVAS.width + EPSILON &&
    rect.y + rect.h <= CANVAS.height + EPSILON
  );
}

/** Area of the intersection of two rects (0 when they do not overlap). */
export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.w <= outer.x + outer.w + EPSILON &&
    inner.y + inner.h <= outer.y + outer.h + EPSILON
  );
}

export function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, w: Math.max(0, rect.w - 2 * by), h: Math.max(0, rect.h - 2 * by) };
}

/** Splits an area into a grid of `count` cells with at most `columns` per row. */
export function gridCells(area: Rect, count: number, columns: number, gap = 0.3): Rect[] {
  if (count <= 0) return [];
  const cols = Math.max(1, Math.min(columns, count));
  const rows = Math.ceil(count / cols);
  const cellW = (area.w - gap * (cols - 1)) / cols;
  const cellH = (area.h - gap * (rows - 1)) / rows;
  const cells: Rect[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    cells.push({ x: area.x + col * (cellW + gap), y: area.y + row * (cellH + gap), w: cellW, h: cellH });
  }
  return cells;
}

/** Percent of the canvas width/height, for responsive positioning. */
export function pctX(inches: number): string {
  return `${round((inches / CANVAS.width) * 100, 4)}%`;
}

export function pctY(inches: number): string {
  return `${round((inches / CANVAS.height) * 100, 4)}%`;
}

/** Font size in container query units so text scales exactly with the canvas. */
export function cqw(points: number): string {
  return `${round((points / CANVAS_WIDTH_PT) * 100, 4)}cqw`;
}
