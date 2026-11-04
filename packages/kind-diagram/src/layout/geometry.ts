import type { Direction, NodeShape } from '../schema.js';
import type { Point, Rect } from './types.js';

export const CYLINDER_CAP = 7;

/** Rounds to one decimal so layouts serialize identically everywhere. */
export function round(value: number): number {
  return Math.round(value * 10) / 10 + 0;
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Distance from the node center to its outline along the main axis, at `offset` from the center on the cross
 * axis. Lets orthogonal edges end exactly on diamonds, ellipses and cylinder caps.
 */
export function mainExtent(
  shape: NodeShape,
  crossHalf: number,
  mainHalf: number,
  offset: number,
  direction: Direction,
): number {
  const ratio = crossHalf > 0 ? Math.min(1, Math.abs(offset) / crossHalf) : 0;
  switch (shape) {
    case 'diamond':
      return mainHalf * (1 - ratio);
    case 'ellipse':
      return mainHalf * Math.sqrt(1 - ratio * ratio);
    case 'cylinder':
      return direction === 'TB' ? mainHalf - CYLINDER_CAP * (1 - Math.sqrt(1 - ratio * ratio)) : mainHalf;
    default:
      return mainHalf;
  }
}

/** Moves a line endpoint that sits on the bounding box onto the real outline of diamonds and ellipses. */
export function clipToShape(shape: NodeShape, rect: Rect, toward: Point): Point {
  const c = center(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  if (hw <= 0 || hh <= 0 || (dx === 0 && dy === 0)) return c;
  let scale: number;
  if (shape === 'diamond') scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else if (shape === 'ellipse') scale = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Removes repeated and collinear points from an orthogonal or straight polyline. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.05 && Math.abs(last.y - point.y) < 0.05) continue;
    out.push({ x: point.x, y: point.y });
    while (out.length >= 3) {
      const a = out[out.length - 3]!;
      const b = out[out.length - 2]!;
      const c = out[out.length - 1]!;
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const forward = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
      if (Math.abs(cross) < 0.05 && forward) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

/** Abstract ↔ real coordinates: `u` runs across the flow, `v` along it. */
export function toReal(direction: Direction, u: number, v: number): Point {
  return direction === 'TB' ? { x: u, y: v } : { x: v, y: u };
}

export function crossSize(direction: Direction, size: { width: number; height: number }): number {
  return direction === 'TB' ? size.width : size.height;
}

export function mainSize(direction: Direction, size: { width: number; height: number }): number {
  return direction === 'TB' ? size.height : size.width;
}

export interface RouteNode {
  rect: Rect;
  shape: NodeShape;
}

/** Midpoint of the last segment, where edge labels go. */
export function lastSegmentMidpoint(points: Point[]): Point {
  const a = points[points.length - 2] ?? points[0]!;
  const b = points[points.length - 1]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Small loop on the trailing corner of a node, for self edges. */
export function selfLoop(direction: Direction, node: RouteNode): { points: Point[]; label: Point } {
  const r = node.rect;
  const cu = direction === 'TB' ? r.x + r.width / 2 : r.y + r.height / 2;
  const cv = direction === 'TB' ? r.y + r.height / 2 : r.x + r.width / 2;
  const halfU = crossSize(direction, r) / 2;
  const halfV = mainSize(direction, r) / 2;
  const startU = cu + halfU / 2;
  const startV = cv + mainExtent(node.shape, halfU, halfV, halfU / 2, direction);
  const loopU = cu + halfU + 16;
  const loopV = cv + halfV + 16;
  // At the center line every supported shape reaches its full cross half-size.
  const endU = cu + halfU;
  const points = [
    toReal(direction, startU, startV),
    toReal(direction, startU, loopV),
    toReal(direction, loopU, loopV),
    toReal(direction, loopU, cv),
    toReal(direction, endU, cv),
  ];
  return { points, label: toReal(direction, loopU, (loopV + cv) / 2) };
}

/**
 * Generic orthogonal route between two placed nodes, used for manual and custom layouts: an elbow through
 * the gap along the flow when the nodes are apart along it, otherwise an elbow through the side gap.
 */
export function routeBetween(direction: Direction, source: RouteNode, target: RouteNode): Point[] {
  const s = source.rect;
  const t = target.rect;
  const su = direction === 'TB' ? s.x + s.width / 2 : s.y + s.height / 2;
  const sv = direction === 'TB' ? s.y + s.height / 2 : s.x + s.width / 2;
  const tu = direction === 'TB' ? t.x + t.width / 2 : t.y + t.height / 2;
  const tv = direction === 'TB' ? t.y + t.height / 2 : t.x + t.width / 2;
  const sHalfU = crossSize(direction, s) / 2;
  const sHalfV = mainSize(direction, s) / 2;
  const tHalfU = crossSize(direction, t) / 2;
  const tHalfV = mainSize(direction, t) / 2;
  const gap = 12;

  if (tv - tHalfV >= sv + sHalfV + gap || tv + tHalfV <= sv - sHalfV - gap) {
    const down = tv > sv;
    const sign = down ? 1 : -1;
    const startV = sv + sign * mainExtent(source.shape, sHalfU, sHalfV, 0, direction);
    const endV = tv - sign * mainExtent(target.shape, tHalfU, tHalfV, 0, direction);
    const midV = (sv + sign * sHalfV + (tv - sign * tHalfV)) / 2;
    return simplify([
      toReal(direction, su, startV),
      toReal(direction, su, midV),
      toReal(direction, tu, midV),
      toReal(direction, tu, endV),
    ]);
  }
  const right = tu >= su;
  const sign = right ? 1 : -1;
  const startU = su + sign * sHalfU;
  const endU = tu - sign * tHalfU;
  const midU = (startU + endU) / 2;
  return simplify([
    toReal(direction, startU, sv),
    toReal(direction, midU, sv),
    toReal(direction, midU, tv),
    toReal(direction, endU, tv),
  ]);
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

export function unionRect(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
