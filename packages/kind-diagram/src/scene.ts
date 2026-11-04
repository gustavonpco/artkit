import type { ColorToken } from '@artkit-ai/core';
import { nodeContentLayout, polylinePath, shapePrimitives } from './draw.js';
import { ICON_ELEMENTS } from './icons.js';
import type { DiagramLayout } from './layout/types.js';
import type { DiagramContent } from './schema.js';
import {
  EDGE_FONT_SIZE,
  EDGE_LINE_HEIGHT,
  edgeLabelLines,
  GROUP_FONT_SIZE,
  groupLabelWidth,
  NODE_FONT_SIZE,
} from './size.js';

/**
 * Paint roles. The React renderer maps them to CSS classes and variables; the SVG exporter resolves them to hex
 * colors from the theme. `tone:<token>` / `tone:neutral` are node colors.
 */
export type PaintRole =
  | 'edge'
  | 'edgeText'
  | 'labelBg'
  | 'bandFill'
  | 'bandStroke'
  | 'boxFill'
  | 'boxStroke'
  | 'groupText'
  | 'nodeFill'
  | 'nodeStroke'
  | 'nodeText'
  | 'none';

export interface SceneElement {
  tag: 'g' | 'rect' | 'path' | 'ellipse' | 'circle' | 'line' | 'polyline' | 'polygon' | 'text' | 'tspan';
  attrs: Record<string, string | number>;
  className: string;
  fill?: PaintRole;
  stroke?: PaintRole;
  /** Edge paths: which arrow markers to attach (each consumer owns its marker ids). */
  markers?: { start: boolean; end: boolean };
  children?: SceneElement[];
  text?: string;
}

/** Layers in paint order: groups, edges, group labels, nodes. */
export interface DiagramScene {
  groups: SceneElement[];
  edges: SceneElement[];
  groupLabels: SceneElement[];
  nodes: SceneElement[];
}

/** Tone of a node group element; `neutral` when the node has no tone. */
export function toneClass(tone: ColorToken | undefined): string {
  return `ak-diagram-tone-${tone ?? 'neutral'}`;
}

function textLines(
  lines: string[],
  x: number,
  baselines: number[],
  className: string,
  fill: PaintRole,
  size: number,
  extra: Record<string, string | number> = {},
): SceneElement {
  return {
    tag: 'text',
    className,
    fill,
    attrs: { x, 'text-anchor': 'middle', 'font-size': size, ...extra },
    children: lines.map((line, i) => ({
      tag: 'tspan',
      className: '',
      attrs: { x, y: baselines[i]! },
      text: line,
    })),
  };
}

/**
 * Builds the drawing of a laid-out diagram as plain elements, shared by the renderer and the SVG exporter so
 * both produce the same geometry.
 */
export function buildDiagramScene(content: DiagramContent, layout: DiagramLayout): DiagramScene {
  const groupLabels = new Map(content.groups.map((group) => [group.id, group.label]));
  const groups: SceneElement[] = [];
  const groupLabelElements: SceneElement[] = [];
  for (const group of layout.groups) {
    const band = group.variant === 'band';
    const label = (groupLabels.get(group.id) ?? group.id).toUpperCase();
    groups.push({
      tag: 'rect',
      className: `ak-diagram-group ak-diagram-group--${group.variant}`,
      fill: band ? 'bandFill' : 'boxFill',
      stroke: band ? 'bandStroke' : 'boxStroke',
      attrs: {
        'data-id': group.id,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        rx: band ? 6 : 8,
        ...(band ? {} : { 'stroke-dasharray': '5 4' }),
      },
    });
    // Labels are drawn above the edges on a chip of the group color, so lines passing by never cross the text.
    const chipWidth = Math.round((groupLabelWidth(label) - 8) * 10) / 10;
    const { x, y, rotated } = group.label;
    groupLabelElements.push({
      tag: 'g',
      className: `ak-diagram-group-label ak-diagram-group-label--${group.variant}`,
      attrs: { 'data-id': group.id, ...(rotated ? { transform: `rotate(-90 ${x} ${y})` } : {}) },
      children: [
        {
          tag: 'rect',
          className: 'ak-diagram-group-label-bg',
          fill: band ? 'bandFill' : 'boxFill',
          attrs: {
            x: rotated ? Math.round((x - chipWidth + 4) * 10) / 10 : x - 4,
            y: y - 12,
            width: chipWidth,
            height: 16,
            rx: 3,
          },
        },
        {
          tag: 'text',
          className: 'ak-diagram-group-label-text',
          fill: 'groupText',
          attrs: {
            x,
            y,
            'font-size': GROUP_FONT_SIZE,
            'font-weight': 600,
            'letter-spacing': 0.6,
            ...(rotated ? { 'text-anchor': 'end' } : {}),
          },
          text: label,
        },
      ],
    });
  }

  const contentEdges = new Map(content.edges.map((edge) => [edge.id, edge]));
  const edges: SceneElement[] = layout.edges.map((edge) => {
    const children: SceneElement[] = [
      {
        tag: 'path',
        className: 'ak-diagram-edge-line',
        fill: 'none',
        stroke: 'edge',
        attrs: {
          d: polylinePath(edge.points),
          'stroke-width': 1.5,
          ...(edge.style === 'dashed' ? { 'stroke-dasharray': '6 4' } : {}),
        },
        markers: { start: edge.arrow === 'both', end: edge.arrow !== 'none' },
      },
    ];
    const text = contentEdges.get(edge.id)?.label;
    if (edge.label && text) {
      const lines = edgeLabelLines(text);
      const cx = edge.label.x + edge.label.width / 2;
      const top = edge.label.y + 2;
      children.push(
        {
          tag: 'rect',
          className: 'ak-diagram-edge-label-bg',
          fill: 'labelBg',
          attrs: {
            x: edge.label.x,
            y: edge.label.y,
            width: edge.label.width,
            height: edge.label.height,
            rx: 3,
          },
        },
        textLines(
          lines,
          Math.round(cx * 10) / 10,
          lines.map(
            (_, i) =>
              Math.round((top + i * EDGE_LINE_HEIGHT + EDGE_LINE_HEIGHT / 2 + EDGE_FONT_SIZE * 0.35) * 10) /
              10,
          ),
          'ak-diagram-edge-label',
          'edgeText',
          EDGE_FONT_SIZE,
        ),
      );
    }
    return {
      tag: 'g',
      className: `ak-diagram-edge${edge.style === 'dashed' ? ' ak-diagram-edge--dashed' : ''}`,
      attrs: { 'data-id': edge.id, 'data-from': edge.from, 'data-to': edge.to },
      children,
    };
  });

  const contentNodes = new Map(content.nodes.map((node) => [node.id, node]));
  const nodes: SceneElement[] = layout.nodes.map((placed) => {
    const node = contentNodes.get(placed.id)!;
    const children: SceneElement[] = shapePrimitives(node.shape, placed, node.icon !== undefined).map(
      (primitive) => ({
        tag: primitive.tag,
        className: `ak-diagram-node-${primitive.part}`,
        fill: primitive.part === 'body' ? 'nodeFill' : 'none',
        stroke: 'nodeStroke',
        attrs: { ...primitive.attrs, 'stroke-width': primitive.part === 'figure' ? 1.75 : 1.5 },
      }),
    );
    const inner = nodeContentLayout(node, placed);
    if (inner.icon && node.icon) {
      const scale = inner.icon.size / 24;
      children.push({
        tag: 'g',
        className: 'ak-diagram-node-icon',
        fill: 'none',
        stroke: 'nodeStroke',
        attrs: {
          transform: `translate(${inner.icon.x} ${inner.icon.y}) scale(${Math.round(scale * 1000) / 1000})`,
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'data-icon': node.icon,
        },
        children: ICON_ELEMENTS[node.icon].map((icon) => ({
          tag: icon.tag,
          className: '',
          attrs: { ...icon.attrs },
        })),
      });
    }
    children.push(
      textLines(
        inner.lines,
        inner.textX,
        inner.baselines,
        'ak-diagram-node-label',
        'nodeText',
        NODE_FONT_SIZE,
      ),
    );
    return {
      tag: 'g',
      className: `ak-diagram-node ak-diagram-node--${node.shape} ${toneClass(node.tone)}`,
      attrs: { 'data-id': node.id },
      children,
    };
  });
  return { groups, edges, groupLabels: groupLabelElements, nodes };
}
