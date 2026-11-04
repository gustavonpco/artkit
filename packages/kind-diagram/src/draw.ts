import { type ColorToken, normalizeHex, resolveColor, type Theme } from '@artkit/core';
import { CYLINDER_CAP } from './layout/geometry.js';
import type { Point, Rect } from './layout/types.js';
import type { DiagramNode, NodeShape } from './schema.js';
import { ACTOR_FIGURE_HEIGHT, ICON_SIZE, NODE_FONT_SIZE, NODE_LINE_HEIGHT, nodeLabelLines } from './size.js';

/**
 * Framework-neutral drawing primitives shared by the React renderer, the editor and the SVG exporter, so the
 * three always draw the same picture.
 */
export interface Primitive {
  tag: 'path' | 'rect' | 'ellipse' | 'circle' | 'line';
  attrs: Record<string, number | string>;
  /** `body` takes the tone fill and stroke; `detail` only the stroke; `figure` is the actor stick figure. */
  part: 'body' | 'detail' | 'figure';
}

const r1 = (value: number) => Math.round(value * 10) / 10;

export function shapePrimitives(shape: NodeShape, rect: Rect, hasIcon = false): Primitive[] {
  const { x, y, width: w, height: h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (shape) {
    case 'box':
      return [{ tag: 'rect', part: 'body', attrs: { x, y, width: w, height: h, rx: 4 } }];
    case 'round':
      return [
        { tag: 'rect', part: 'body', attrs: { x, y, width: w, height: h, rx: r1(Math.min(h / 2, 18)) } },
      ];
    case 'diamond':
      return [
        {
          tag: 'path',
          part: 'body',
          attrs: { d: `M${r1(cx)} ${y}L${r1(x + w)} ${r1(cy)}L${r1(cx)} ${r1(y + h)}L${x} ${r1(cy)}Z` },
        },
      ];
    case 'ellipse':
      return [
        { tag: 'ellipse', part: 'body', attrs: { cx: r1(cx), cy: r1(cy), rx: r1(w / 2), ry: r1(h / 2) } },
      ];
    case 'cylinder': {
      const ry = CYLINDER_CAP;
      const rx = r1(w / 2);
      return [
        {
          tag: 'path',
          part: 'body',
          attrs: {
            d: `M${x} ${r1(y + ry)}A${rx} ${ry} 0 0 1 ${r1(x + w)} ${r1(y + ry)}V${r1(y + h - ry)}A${rx} ${ry} 0 0 1 ${x} ${r1(y + h - ry)}Z`,
          },
        },
        {
          tag: 'path',
          part: 'detail',
          attrs: { d: `M${x} ${r1(y + ry)}A${rx} ${ry} 0 0 0 ${r1(x + w)} ${r1(y + ry)}` },
        },
      ];
    }
    case 'document':
      return [
        {
          tag: 'path',
          part: 'body',
          attrs: {
            d: `M${x} ${y}H${r1(x + w)}V${r1(y + h - 8)}C${r1(x + w * 0.72)} ${r1(y + h - 17)} ${r1(x + w * 0.3)} ${r1(y + h + 5)} ${x} ${r1(y + h - 6)}Z`,
          },
        },
      ];
    case 'actor': {
      if (hasIcon) return [];
      const top = y + 2;
      return [
        { tag: 'circle', part: 'figure', attrs: { cx: r1(cx), cy: r1(top + 7), r: 7 } },
        {
          tag: 'path',
          part: 'figure',
          attrs: {
            d: `M${r1(cx)} ${r1(top + 14)}V${r1(top + 27)}M${r1(cx - 12)} ${r1(top + 19)}H${r1(cx + 12)}M${r1(cx)} ${r1(top + 27)}L${r1(cx - 10)} ${r1(top + 38)}M${r1(cx)} ${r1(top + 27)}L${r1(cx + 10)} ${r1(top + 38)}`,
          },
        },
      ];
    }
  }
}

export interface NodeContentLayout {
  lines: string[];
  /** Horizontal center of the text block. */
  textX: number;
  /** Baseline of each line. */
  baselines: number[];
  icon?: { x: number; y: number; size: number };
}

/** Where the label lines and the icon go inside a node. */
export function nodeContentLayout(
  node: Pick<DiagramNode, 'label' | 'shape' | 'icon'>,
  rect: Rect,
): NodeContentLayout {
  const lines = nodeLabelLines(node);
  const textH = lines.length * NODE_LINE_HEIGHT;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const baselinesFrom = (top: number) =>
    lines.map((_, i) => r1(top + i * NODE_LINE_HEIGHT + NODE_LINE_HEIGHT / 2 + NODE_FONT_SIZE * 0.35));
  const hasIcon = node.icon !== undefined;
  switch (node.shape) {
    case 'actor': {
      const top = rect.y + ACTOR_FIGURE_HEIGHT + 6;
      return {
        lines,
        textX: r1(cx),
        baselines: baselinesFrom(top),
        ...(hasIcon ? { icon: { x: r1(cx - 16), y: r1(rect.y + 4), size: 32 } } : {}),
      };
    }
    case 'diamond':
    case 'ellipse': {
      const iconH = hasIcon ? ICON_SIZE + 4 : 0;
      const top = cy - (textH + iconH) / 2;
      return {
        lines,
        textX: r1(cx),
        baselines: baselinesFrom(top + iconH),
        ...(hasIcon ? { icon: { x: r1(cx - ICON_SIZE / 2), y: r1(top), size: ICON_SIZE } } : {}),
      };
    }
    default: {
      const shift = node.shape === 'cylinder' ? CYLINDER_CAP / 2 : node.shape === 'document' ? -4 : 0;
      const middle = cy + shift;
      if (!hasIcon) return { lines, textX: r1(cx), baselines: baselinesFrom(middle - textH / 2) };
      const iconX = rect.x + 14;
      const textLeft = iconX + ICON_SIZE + 8;
      return {
        lines,
        textX: r1(textLeft + (rect.x + rect.width - 14 - textLeft) / 2),
        baselines: baselinesFrom(middle - textH / 2),
        icon: { x: r1(iconX), y: r1(middle - ICON_SIZE / 2), size: ICON_SIZE },
      };
    }
  }
}

/** Polyline as SVG path data with softly rounded corners. */
export function polylinePath(points: Point[], radius = 6): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  let d = `M${r1(first.x)} ${r1(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += `L${r1(p.x)} ${r1(p.y)}`;
      break;
    }
    const prev = points[i - 1]!;
    const inLength = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLength = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      d += `L${r1(p.x)} ${r1(p.y)}`;
      continue;
    }
    const a = { x: p.x - ((p.x - prev.x) / inLength) * r, y: p.y - ((p.y - prev.y) / inLength) * r };
    const b = { x: p.x + ((next.x - p.x) / outLength) * r, y: p.y + ((next.y - p.y) / outLength) * r };
    d += `L${r1(a.x)} ${r1(a.y)}Q${r1(p.x)} ${r1(p.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  return d;
}

/** Mixes two hex colors (`ratio` of `a`), like CSS `color-mix(in srgb, a ratio, b)`. */
export function mixColors(a: string, b: string, ratio: number): string {
  const ca = normalizeHex(a).slice(1);
  const cb = normalizeHex(b).slice(1);
  let out = '#';
  for (let i = 0; i < 6; i += 2) {
    const value = Math.round(
      Number.parseInt(ca.slice(i, i + 2), 16) * ratio + Number.parseInt(cb.slice(i, i + 2), 16) * (1 - ratio),
    );
    out += value.toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

/** Tint ratio of node fills; the renderer CSS uses the same percentage. */
export const NODE_TINT = 0.14;

/** Share of the text color in neutral node outlines (renderer CSS uses the same value). */
export const NEUTRAL_STROKE = 0.45;

export interface NodePaint {
  fill: string;
  stroke: string;
  text: string;
}

/** Resolved hex colors for a node tone (exporter); the renderer uses the equivalent CSS variables. */
export function nodePaint(theme: Theme, tone: ColorToken | undefined): NodePaint {
  const background = resolveColor(theme, 'background');
  if (!tone)
    return {
      fill: resolveColor(theme, 'surface'),
      // Strong hairline of the design system: the text color at 45% over the background.
      stroke: mixColors(resolveColor(theme, 'text'), background, NEUTRAL_STROKE),
      text: resolveColor(theme, 'text'),
    };
  const color = resolveColor(theme, tone);
  return { fill: mixColors(color, background, NODE_TINT), stroke: color, text: resolveColor(theme, 'text') };
}

export interface DiagramPaint {
  background: string;
  edge: string;
  edgeText: string;
  bandFill: string;
  bandStroke: string;
  boxFill: string;
  boxStroke: string;
  groupText: string;
}

export function diagramPaint(theme: Theme): DiagramPaint {
  const background = resolveColor(theme, 'background');
  const muted = resolveColor(theme, 'muted');
  const text = resolveColor(theme, 'text');
  // Bands and boxes follow the design system hairlines (text color at 15% and 30%); group labels use the
  // accent like section eyebrows.
  return {
    background,
    edge: muted,
    edgeText: text,
    bandFill: mixColors(text, background, 0.03),
    bandStroke: mixColors(text, background, 0.15),
    boxFill: background,
    boxStroke: mixColors(text, background, 0.3),
    groupText: resolveColor(theme, 'accent'),
  };
}
