import { CANVAS, type Rect, round } from '../geometry.js';

/** Smallest box the editor lets a resize produce, inches. */
export const MIN_SIZE = 0.1;
/** Distance (inches) under which an edge or center snaps to a guide. */
export const SNAP_THRESHOLD = 0.08;

export type Direction = -1 | 0 | 1;

export interface Guide {
  axis: 'x' | 'y';
  /** Position of the guide line on its axis, inches. */
  position: number;
  /** Extent of the line along the other axis, inches. */
  from: number;
  to: number;
}

export interface SnapOptions {
  /** Snap threshold in inches (default 0.08). */
  threshold?: number;
  /** Grid step in inches; used when no guide is close enough. */
  grid?: number;
}

export interface SnapResult {
  rect: Rect;
  guides: Guide[];
}

const SLIDE: Rect = { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height };

function anchors(rect: Rect, axis: 'x' | 'y'): number[] {
  return axis === 'x'
    ? [rect.x, rect.x + rect.w / 2, rect.x + rect.w]
    : [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
}

/** Guide lines offered by other elements (edges and centers) and by the slide (edges and center). */
export function snapLines(others: readonly Rect[], axis: 'x' | 'y'): { position: number; source: Rect }[] {
  const lines: { position: number; source: Rect }[] = [];
  for (const rect of [SLIDE, ...others])
    for (const position of anchors(rect, axis)) lines.push({ position, source: rect });
  return lines;
}

function closest(
  values: number[],
  lines: { position: number }[],
  threshold: number,
): { delta: number; position: number } | undefined {
  let best: { delta: number; position: number } | undefined;
  for (const value of values) {
    for (const line of lines) {
      const delta = line.position - value;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
        best = { delta, position: line.position };
    }
  }
  return best;
}

function guidesFor(rect: Rect, others: readonly Rect[], axis: 'x' | 'y'): Guide[] {
  const guides: Guide[] = [];
  const seen = new Set<number>();
  for (const value of anchors(rect, axis)) {
    for (const line of snapLines(others, axis)) {
      if (Math.abs(line.position - value) > 1e-6 || seen.has(round(value, 4))) continue;
      seen.add(round(value, 4));
      const span =
        axis === 'x'
          ? {
              from: Math.min(rect.y, line.source.y),
              to: Math.max(rect.y + rect.h, line.source.y + line.source.h),
            }
          : {
              from: Math.min(rect.x, line.source.x),
              to: Math.max(rect.x + rect.w, line.source.x + line.source.w),
            };
      guides.push({ axis, position: value, ...span });
    }
  }
  return guides;
}

function snapToGrid(value: number, grid: number | undefined): number {
  return grid && grid > 0 ? Math.round(value / grid) * grid : value;
}

/** Snaps a moved rect: edges or centers to nearby guides, else its top-left corner to the grid. */
export function snapMove(rect: Rect, others: readonly Rect[], options: SnapOptions = {}): SnapResult {
  const threshold = options.threshold ?? SNAP_THRESHOLD;
  const out = { ...rect };
  const sx = closest(anchors(rect, 'x'), snapLines(others, 'x'), threshold);
  const sy = closest(anchors(rect, 'y'), snapLines(others, 'y'), threshold);
  out.x = sx ? rect.x + sx.delta : snapToGrid(rect.x, options.grid);
  out.y = sy ? rect.y + sy.delta : snapToGrid(rect.y, options.grid);
  const final = { x: round(out.x, 4), y: round(out.y, 4), w: rect.w, h: rect.h };
  return {
    rect: final,
    guides: [...(sx ? guidesFor(final, others, 'x') : []), ...(sy ? guidesFor(final, others, 'y') : [])],
  };
}

/**
 * Snaps the edges a resize moves (`direction` -1 = left/top, 1 = right/bottom). With `keepRatio` only the
 * dominant axis snaps and the other follows the ratio.
 */
export function snapResize(
  rect: Rect,
  direction: [Direction, Direction],
  others: readonly Rect[],
  options: SnapOptions & { keepRatio?: boolean } = {},
): SnapResult {
  const threshold = options.threshold ?? SNAP_THRESHOLD;
  const out = { ...rect };
  const ratio = rect.h > 0 ? rect.w / rect.h : 1;
  const edge = (axis: 'x' | 'y', dir: Direction) => {
    if (dir === 0) return false;
    const start = axis === 'x' ? out.x : out.y;
    const size = axis === 'x' ? out.w : out.h;
    const value = dir > 0 ? start + size : start;
    const hit = closest([value], snapLines(others, axis), threshold);
    const target = hit ? hit.position : snapToGrid(value, options.grid);
    if (target === value) return Boolean(hit);
    if (dir > 0) {
      if (axis === 'x') out.w = Math.max(MIN_SIZE, target - out.x);
      else out.h = Math.max(MIN_SIZE, target - out.y);
    } else {
      const end = start + size;
      const next = Math.min(target, end - MIN_SIZE);
      if (axis === 'x') {
        out.x = next;
        out.w = end - next;
      } else {
        out.y = next;
        out.h = end - next;
      }
    }
    return Boolean(hit);
  };
  let snappedX = false;
  let snappedY = false;
  if (options.keepRatio) {
    if (direction[0] !== 0) {
      snappedX = edge('x', direction[0]);
      const h = out.w / ratio;
      if (direction[1] < 0) out.y = out.y + out.h - h;
      out.h = h;
    } else {
      snappedY = edge('y', direction[1]);
      const w = out.h * ratio;
      out.w = w;
    }
  } else {
    snappedX = edge('x', direction[0]);
    snappedY = edge('y', direction[1]);
  }
  const final = { x: round(out.x, 4), y: round(out.y, 4), w: round(out.w, 4), h: round(out.h, 4) };
  return {
    rect: final,
    guides: [
      ...(snappedX ? guidesFor(final, others, 'x') : []),
      ...(snappedY ? guidesFor(final, others, 'y') : []),
    ],
  };
}

/** Moves a rect by a delta, keeping it on the canvas. */
export function moveRect(start: Rect, dx: number, dy: number): Rect {
  return clampPosition({ ...start, x: start.x + dx, y: start.y + dy });
}

/** Keeps a rect inside the canvas by moving it (sizes larger than the canvas are reduced). */
export function clampPosition(rect: Rect): Rect {
  const w = Math.min(rect.w, CANVAS.width);
  const h = Math.min(rect.h, CANVAS.height);
  return {
    x: round(Math.max(0, Math.min(CANVAS.width - w, rect.x)), 4),
    y: round(Math.max(0, Math.min(CANVAS.height - h, rect.y)), 4),
    w: round(w, 4),
    h: round(h, 4),
  };
}

/** Keeps a rect inside the canvas by trimming the edges that cross it (used after resizes). */
export function clampSize(rect: Rect): Rect {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(CANVAS.width, rect.x + rect.w);
  const bottom = Math.min(CANVAS.height, rect.y + rect.h);
  return {
    x: round(x, 4),
    y: round(y, 4),
    w: round(Math.max(0, right - x), 4),
    h: round(Math.max(0, bottom - y), 4),
  };
}

/**
 * New rect after dragging a resize handle by (dx, dy) inches. `direction` says which edges move. With
 * `keepRatio` the aspect ratio of `start` is preserved, driven by the larger relative change.
 */
export function resizeRect(
  start: Rect,
  direction: [Direction, Direction],
  dx: number,
  dy: number,
  options: { keepRatio?: boolean; minSize?: number } = {},
): Rect {
  const min = options.minSize ?? MIN_SIZE;
  let w = start.w + direction[0] * dx;
  let h = start.h + direction[1] * dy;
  if (options.keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const scaleW = direction[0] !== 0 ? w / start.w : undefined;
    const scaleH = direction[1] !== 0 ? h / start.h : undefined;
    const scale =
      scaleW !== undefined && scaleH !== undefined
        ? Math.abs(scaleW - 1) >= Math.abs(scaleH - 1)
          ? scaleW
          : scaleH
        : (scaleW ?? scaleH ?? 1);
    w = start.w * scale;
    h = w / ratio;
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  const x =
    direction[0] < 0
      ? start.x + start.w - w
      : direction[0] === 0 && options.keepRatio
        ? start.x + (start.w - w) / 2
        : start.x;
  const y =
    direction[1] < 0
      ? start.y + start.h - h
      : direction[1] === 0 && options.keepRatio
        ? start.y + (start.h - h) / 2
        : start.y;
  return clampSize({ x, y, w, h });
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function boundingRect(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Aligns rects to their common bounds (or to the slide when only one rect or `reference` is given). */
export function alignRects(rects: readonly Rect[], mode: AlignMode, reference?: Rect): Rect[] {
  const ref = reference ?? (rects.length > 1 ? boundingRect(rects) : SLIDE);
  return rects.map((rect) => {
    const out = { ...rect };
    if (mode === 'left') out.x = ref.x;
    if (mode === 'center') out.x = ref.x + (ref.w - rect.w) / 2;
    if (mode === 'right') out.x = ref.x + ref.w - rect.w;
    if (mode === 'top') out.y = ref.y;
    if (mode === 'middle') out.y = ref.y + (ref.h - rect.h) / 2;
    if (mode === 'bottom') out.y = ref.y + ref.h - rect.h;
    return clampPosition(out);
  });
}

/** Spreads rects so the gaps between them are equal (first and last stay). Needs three or more rects. */
export function distributeRects(rects: readonly Rect[], axis: 'horizontal' | 'vertical'): Rect[] {
  if (rects.length < 3) return rects.map((rect) => ({ ...rect }));
  const horizontal = axis === 'horizontal';
  const order = rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
  const first = order[0]!.rect;
  const last = order[order.length - 1]!.rect;
  const span = horizontal ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sizes = order.reduce((sum, { rect }) => sum + (horizontal ? rect.w : rect.h), 0);
  const gap = (span - sizes) / (order.length - 1);
  const result = rects.map((rect) => ({ ...rect }));
  let cursor = horizontal ? first.x : first.y;
  for (const { rect, index } of order) {
    if (horizontal) result[index] = clampPosition({ ...rect, x: cursor });
    else result[index] = clampPosition({ ...rect, y: cursor });
    cursor += (horizontal ? rect.w : rect.h) + gap;
  }
  return result;
}

/** Rect after a keyboard nudge; Alt resizes instead of moving. */
export function nudgeRect(
  rect: Rect,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  step: number,
  resize: boolean,
): Rect {
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  if (resize)
    return clampSize({ ...rect, w: Math.max(MIN_SIZE, rect.w + dx), h: Math.max(MIN_SIZE, rect.h + dy) });
  return moveRect(rect, dx, dy);
}

/** True when two rects differ by more than float noise. */
export function rectChanged(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) > 1e-4 ||
    Math.abs(a.y - b.y) > 1e-4 ||
    Math.abs(a.w - b.w) > 1e-4 ||
    Math.abs(a.h - b.h) > 1e-4
  );
}
