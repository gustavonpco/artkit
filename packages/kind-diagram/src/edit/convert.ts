import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { DiagramLayout, Point, Rect } from '../layout/types.js';
import type { DiagramOperation } from '../operations.js';
import {
  type DiagramContent,
  type DiagramEdge,
  type DiagramNode,
  type Direction,
  EDGE_LABEL_MAX,
  GROUP_LABEL_MAX,
  type GroupKind,
  NODE_LABEL_MAX,
  POSITION_MAX,
} from '../schema.js';

/**
 * Pure conversions between diagram content + layout and React Flow, and from editor gestures to kind
 * operations. Kept free of React so they are unit-tested directly.
 */
export interface FlowNodeData extends Record<string, unknown> {
  node: DiagramNode;
  pinned: boolean;
  direction: Direction;
  /** Layout rectangle; the node view draws the shared scene through a viewBox on it. */
  rect: Rect;
}

export interface FlowEdgeData extends Record<string, unknown> {
  edge: DiagramEdge;
  points: Point[];
  label?: Rect;
  /** Layout positions of both ends; when the live nodes differ (mid-drag) the edge falls back to a simple path. */
  sourceAt: Point;
  targetAt: Point;
}

export type DiagramFlowNode = Node<FlowNodeData, 'diagramNode'>;
export type DiagramFlowEdge = Edge<FlowEdgeData, 'diagramEdge'>;

export const SOURCE_HANDLE = 'out';
export const TARGET_HANDLE = 'in';

export function toFlowNodes(
  content: DiagramContent,
  layout: DiagramLayout,
  selected: ReadonlySet<string> = new Set(),
): DiagramFlowNode[] {
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  return layout.nodes.map((placed) => {
    const node = nodes.get(placed.id)!;
    return {
      id: placed.id,
      type: 'diagramNode',
      position: { x: placed.x, y: placed.y },
      width: placed.width,
      height: placed.height,
      selected: selected.has(placed.id),
      ariaLabel: node.label,
      data: {
        node,
        pinned: placed.pinned,
        direction: content.direction,
        rect: { x: placed.x, y: placed.y, width: placed.width, height: placed.height },
      },
    };
  });
}

export function toFlowEdges(
  content: DiagramContent,
  layout: DiagramLayout,
  selected: ReadonlySet<string> = new Set(),
): DiagramFlowEdge[] {
  const edges = new Map(content.edges.map((edge) => [edge.id, edge]));
  const labels = new Map(content.nodes.map((node) => [node.id, node.label]));
  const at = new Map(layout.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  return layout.edges.map((routed) => {
    const edge = edges.get(routed.id)!;
    return {
      id: routed.id,
      type: 'diagramEdge',
      source: routed.from,
      target: routed.to,
      sourceHandle: SOURCE_HANDLE,
      targetHandle: TARGET_HANDLE,
      selected: selected.has(routed.id),
      ariaLabel: `${labels.get(routed.from) ?? routed.from} → ${labels.get(routed.to) ?? routed.to}${edge.label ? ` (${edge.label})` : ''}`,
      data: {
        edge,
        points: routed.points,
        ...(routed.label ? { label: routed.label } : {}),
        sourceAt: at.get(routed.from)!,
        targetAt: at.get(routed.to)!,
      },
    };
  });
}

/** New edge from a React Flow connection; self connections and missing ends are ignored. */
export function connectionToOperation(connection: {
  source: string | null;
  target: string | null;
}): DiagramOperation | undefined {
  if (!connection.source || !connection.target || connection.source === connection.target) return undefined;
  return { op: 'add_edge', from: connection.source, to: connection.target };
}

const clampPosition = (value: number) => Math.max(-POSITION_MAX, Math.min(POSITION_MAX, Math.round(value)));

/** One `pin_node` per node that ended a drag (or keyboard move) away from its laid-out position. */
export function dragToOperations(
  moved: { id: string; position: XYPosition }[],
  layout: DiagramLayout,
): DiagramOperation[] {
  const placed = new Map(layout.nodes.map((node) => [node.id, node]));
  const ops: DiagramOperation[] = [];
  for (const { id, position } of moved) {
    const before = placed.get(id);
    if (!before) continue;
    // A click without movement is not a drag: it must not pin the node.
    if (Math.abs(before.x - position.x) < 0.5 && Math.abs(before.y - position.y) < 0.5) continue;
    ops.push({
      op: 'pin_node',
      id,
      position: { x: clampPosition(position.x), y: clampPosition(position.y) },
    });
  }
  return ops;
}

/** Deleting nodes already removes their edges (remove_node), so those edges are not removed twice. */
export function deletionToOperations(
  nodes: { id: string }[],
  edges: { id: string; source: string; target: string }[],
): DiagramOperation[] {
  const removed = new Set(nodes.map((node) => node.id));
  return [
    ...nodes.map((node): DiagramOperation => ({ op: 'remove_node', id: node.id })),
    ...edges
      .filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
      .map((edge): DiagramOperation => ({ op: 'remove_edge', id: edge.id })),
  ];
}

/** Groups the selected nodes: bands when the diagram already uses bands, boxes otherwise. */
export function groupSelectionOperations(
  content: DiagramContent,
  nodeIds: readonly string[],
  label: string,
): DiagramOperation[] {
  const existing = new Set(content.nodes.map((node) => node.id));
  const members = nodeIds.filter((id) => existing.has(id));
  if (members.length === 0) return [];
  const kind: GroupKind =
    content.layout === 'bands' || content.groups.some((group) => group.kind === 'band') ? 'band' : 'box';
  return [{ op: 'add_group', label: label.slice(0, GROUP_LABEL_MAX), kind, nodes: members }];
}

export function ungroupOperations(content: DiagramContent, nodeIds: readonly string[]): DiagramOperation[] {
  const wanted = new Set(nodeIds);
  return content.nodes
    .filter((node) => wanted.has(node.id) && node.group !== undefined)
    .map((node) => ({ op: 'update_node', id: node.id, group: null }));
}

/**
 * Operation for an inline label edit, or undefined when nothing changes or the value is not allowed
 * (empty node or group labels are rejected; an empty edge label removes it).
 */
export function labelEditOperation(
  target: 'node' | 'edge' | 'group',
  id: string,
  previous: string | undefined,
  next: string,
): DiagramOperation | undefined {
  const value = next.replace(/\s+/g, ' ').trim();
  if (target === 'edge') {
    const label = value.slice(0, EDGE_LABEL_MAX);
    if ((previous ?? '') === label) return undefined;
    return { op: 'update_edge', id, label: label === '' ? null : label };
  }
  if (value === '') return undefined;
  const label = value.slice(0, target === 'node' ? NODE_LABEL_MAX : GROUP_LABEL_MAX);
  if (previous === label) return undefined;
  return target === 'node' ? { op: 'update_node', id, label } : { op: 'update_group', id, label };
}
