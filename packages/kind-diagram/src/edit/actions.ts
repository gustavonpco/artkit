import { IdAllocator } from '@artkit-ai/core';
import type { DiagramLayout } from '../layout/index.js';
import type { DiagramOperation } from '../operations.js';
import type { DiagramContent, DiagramEdge, DiagramNode, EdgeArrow, EdgeStyle } from '../schema.js';
import { POSITION_MAX } from '../schema.js';

/*
 * Editor actions as pure functions returning kind operations (and the ids to select afterwards): duplicate,
 * copy and paste, align and distribute, auto-arrange and edge styling. Shared by the toolbar and shortcuts.
 */

export interface DiagramActionResult {
  operations: DiagramOperation[];
  /** Node ids to select once the operations are committed. */
  select: string[];
}

/** Nodes (with resolved positions) and the edges between them, as copied to the clipboard. */
export interface DiagramClipboard {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const clamp = (value: number) => Math.max(-POSITION_MAX, Math.min(POSITION_MAX, Math.round(value)));

function allIds(content: DiagramContent): string[] {
  return [
    ...content.nodes.map((node) => node.id),
    ...content.edges.map((edge) => edge.id),
    ...content.groups.map((group) => group.id),
  ];
}

/** Copies the selected nodes with their current layout positions and the edges among them. */
export function copySelection(
  content: DiagramContent,
  layout: DiagramLayout,
  nodeIds: readonly string[],
): DiagramClipboard | undefined {
  const wanted = new Set(nodeIds);
  const placed = new Map(layout.nodes.map((node) => [node.id, node]));
  const nodes = content.nodes
    .filter((node) => wanted.has(node.id))
    .map((node) => {
      const at = placed.get(node.id);
      return at ? { ...node, position: { x: clamp(at.x), y: clamp(at.y) } } : { ...node };
    });
  if (nodes.length === 0) return undefined;
  const edges = content.edges.filter((edge) => wanted.has(edge.from) && wanted.has(edge.to));
  return { nodes, edges };
}

/**
 * Adds the clipboard nodes (and their inner edges) with fresh ids. Positions are offset and pinned only when
 * the diagram is laid out manually; otherwise the automatic layout places the copies.
 */
export function pasteOperations(
  content: DiagramContent,
  clipboard: DiagramClipboard,
  offset = 32,
): DiagramActionResult {
  const ids = new IdAllocator(allIds(content));
  const groups = new Set(content.groups.map((group) => group.id));
  const manual = content.layout === 'manual';
  const mapped = new Map<string, string>();
  const operations: DiagramOperation[] = [];
  for (const node of clipboard.nodes) {
    const id = ids.next('n');
    mapped.set(node.id, id);
    operations.push({
      op: 'add_node',
      id,
      label: node.label,
      shape: node.shape,
      ...(node.tone ? { tone: node.tone } : {}),
      ...(node.icon ? { icon: node.icon } : {}),
      ...(node.group && groups.has(node.group) ? { group: node.group } : {}),
      ...(manual && node.position
        ? { position: { x: clamp(node.position.x + offset), y: clamp(node.position.y + offset) } }
        : {}),
    });
  }
  for (const edge of clipboard.edges) {
    const from = mapped.get(edge.from);
    const to = mapped.get(edge.to);
    if (!from || !to) continue;
    operations.push({
      op: 'add_edge',
      id: ids.next('e'),
      from,
      to,
      ...(edge.label ? { label: edge.label } : {}),
      style: edge.style,
      arrow: edge.arrow,
    });
  }
  return { operations, select: [...mapped.values()] };
}

export function duplicateOperations(
  content: DiagramContent,
  layout: DiagramLayout,
  nodeIds: readonly string[],
): DiagramActionResult {
  const clipboard = copySelection(content, layout, nodeIds);
  return clipboard ? pasteOperations(content, clipboard) : { operations: [], select: [] };
}

export type NodeAlign = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Pins the selected nodes aligned to their common bounds (pinning switches the layout to manual). */
export function alignOperations(
  layout: DiagramLayout,
  nodeIds: readonly string[],
  mode: NodeAlign,
): DiagramOperation[] {
  const wanted = new Set(nodeIds);
  const nodes = layout.nodes.filter((node) => wanted.has(node.id));
  if (nodes.length < 2) return [];
  const left = Math.min(...nodes.map((node) => node.x));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const top = Math.min(...nodes.map((node) => node.y));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  const operations: DiagramOperation[] = [];
  for (const node of nodes) {
    let { x, y } = node;
    if (mode === 'left') x = left;
    else if (mode === 'right') x = right - node.width;
    else if (mode === 'center') x = (left + right) / 2 - node.width / 2;
    else if (mode === 'top') y = top;
    else if (mode === 'bottom') y = bottom - node.height;
    else y = (top + bottom) / 2 - node.height / 2;
    if (Math.abs(x - node.x) < 0.5 && Math.abs(y - node.y) < 0.5) continue;
    operations.push({ op: 'pin_node', id: node.id, position: { x: clamp(x), y: clamp(y) } });
  }
  return operations;
}

/** Spaces three or more selected nodes evenly between the outermost ones. */
export function distributeOperations(
  layout: DiagramLayout,
  nodeIds: readonly string[],
  axis: 'horizontal' | 'vertical',
): DiagramOperation[] {
  const wanted = new Set(nodeIds);
  const horizontal = axis === 'horizontal';
  const nodes = layout.nodes
    .filter((node) => wanted.has(node.id))
    .sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  if (nodes.length < 3) return [];
  const size = (node: (typeof nodes)[number]) => (horizontal ? node.width : node.height);
  const start = horizontal ? nodes[0]!.x : nodes[0]!.y;
  const last = nodes[nodes.length - 1]!;
  const end = (horizontal ? last.x : last.y) + size(last);
  const gap = (end - start - nodes.reduce((sum, node) => sum + size(node), 0)) / (nodes.length - 1);
  const operations: DiagramOperation[] = [];
  let cursor = start;
  for (const node of nodes) {
    const x = horizontal ? cursor : node.x;
    const y = horizontal ? node.y : cursor;
    cursor += size(node) + gap;
    if (Math.abs(x - node.x) < 0.5 && Math.abs(y - node.y) < 0.5) continue;
    operations.push({ op: 'pin_node', id: node.id, position: { x: clamp(x), y: clamp(y) } });
  }
  return operations;
}

/** Releases every pinned node and returns to the automatic layout. */
export function autoArrangeOperations(content: DiagramContent): DiagramOperation[] {
  const operations: DiagramOperation[] = content.nodes
    .filter((node) => node.position !== undefined)
    .map((node) => ({ op: 'unpin_node', id: node.id }));
  if (content.layout === 'manual') operations.push({ op: 'set_layout', layout: 'auto' });
  return operations;
}

export function edgeStyleOperations(
  content: DiagramContent,
  edgeIds: readonly string[],
  patch: { style?: EdgeStyle; arrow?: EdgeArrow },
): DiagramOperation[] {
  const wanted = new Set(edgeIds);
  return content.edges
    .filter(
      (edge) =>
        wanted.has(edge.id) &&
        ((patch.style !== undefined && edge.style !== patch.style) ||
          (patch.arrow !== undefined && edge.arrow !== patch.arrow)),
    )
    .map((edge) => ({ op: 'update_edge', id: edge.id, ...patch }));
}

export function reverseEdgeOperations(
  content: DiagramContent,
  edgeIds: readonly string[],
): DiagramOperation[] {
  const wanted = new Set(edgeIds);
  return content.edges
    .filter((edge) => wanted.has(edge.id))
    .map((edge) => ({ op: 'update_edge', id: edge.id, from: edge.to, to: edge.from }));
}
