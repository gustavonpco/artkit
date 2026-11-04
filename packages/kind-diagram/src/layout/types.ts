import type { Direction, EdgeArrow, EdgeStyle, GroupKind, NodeShape } from '../schema.js';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Graph handed to a layout engine: sizes are already estimated, coordinates are top-left in diagram units. */
export interface LayoutGraph {
  direction: Direction;
  nodes: LayoutGraphNode[];
  edges: LayoutGraphEdge[];
  /** In content order (bands are stacked in this order). */
  groups: LayoutGraphGroup[];
}

export interface LayoutGraphNode {
  id: string;
  width: number;
  height: number;
  shape: NodeShape;
  group?: string;
  /** Pinned top-left position (only present when the diagram layout is `manual`). */
  position?: Point;
}

export interface LayoutGraphEdge {
  id: string;
  from: string;
  to: string;
  /** Estimated label box; 0×0 when the edge has no label. */
  labelWidth: number;
  labelHeight: number;
}

export interface LayoutGraphGroup {
  id: string;
  kind: GroupKind;
  labelWidth: number;
  /** Node ids in content order. */
  members: string[];
}

/** What an engine returns. Everything except node positions is optional and filled in by `layoutDiagram`. */
export interface LayoutEngineResult {
  /** Top-left position per node id. Every node must be present. */
  nodes: Record<string, Point>;
  /** Polyline per edge id (first and last points on the node outlines) and optional label center. */
  edges?: Record<string, { points: Point[]; label?: Point }>;
  /** Rectangle per group id, including room for its label. */
  groups?: Record<string, Rect>;
  /** How groups were drawn: `band` when the engine stacked them as layers/lanes. Defaults to each group's kind. */
  groupVariant?: 'band' | 'box';
}

/**
 * Pluggable layout engine (e.g. an elkjs adapter written by the app). Engines may be async; use
 * `layoutDiagramAsync` for those. Built-in engines are synchronous and deterministic.
 */
export interface LayoutEngine {
  readonly name: string;
  layout(graph: LayoutGraph): LayoutEngineResult | Promise<LayoutEngineResult>;
}

export interface PositionedNode extends Rect {
  id: string;
  shape: NodeShape;
  pinned: boolean;
}

export interface RoutedEdge {
  id: string;
  from: string;
  to: string;
  points: Point[];
  style: EdgeStyle;
  arrow: EdgeArrow;
  /** Label box (top-left + size) when the edge has a label. */
  label?: Rect;
}

export interface PositionedGroup extends Rect {
  id: string;
  /** Visual treatment: `band` (layer in TB, lane in LR) or `box`. */
  variant: 'band' | 'box';
  /** Label anchor; `rotated` labels run bottom-to-top along the left side of a lane (LR bands). */
  label: { x: number; y: number; rotated: boolean };
}

export interface DiagramLayout {
  /** Engine that produced the base positions (`dagre`, `bands` or a custom engine name). */
  engine: string;
  direction: Direction;
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  groups: PositionedGroup[];
  /** Drawing area including margins. `x`/`y` may be non-zero: pinned positions are never shifted. */
  bounds: Rect;
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Replaces the built-in engines (dagre / bands). Must be synchronous for `layoutDiagram`. */
  engine?: LayoutEngine;
  /** Empty space around the drawing (default 16). */
  margin?: number;
}
