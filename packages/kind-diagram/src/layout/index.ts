import type { DiagramContent } from '../schema.js';
import { edgeLabelSize, estimateNodeSize, groupLabelWidth } from '../size.js';
import { bandsEngine } from './bands.js';
import { dagreEngine, GROUP_HEADER } from './dagre.js';
import {
  clipToShape,
  lastSegmentMidpoint,
  rectsOverlap,
  round,
  routeBetween,
  selfLoop,
  unionRect,
} from './geometry.js';
import type {
  DiagramLayout,
  LayoutEngine,
  LayoutEngineResult,
  LayoutGraph,
  LayoutOptions,
  Point,
  PositionedGroup,
  PositionedNode,
  Rect,
  RoutedEdge,
} from './types.js';

export { bandsEngine, isotonic, layoutBands, longestPathRanks } from './bands.js';
export { dagreEngine, GROUP_HEADER } from './dagre.js';
export { clipToShape, mainExtent, routeBetween, selfLoop, simplify } from './geometry.js';
export type * from './types.js';

const GROUP_PAD = 14;
const PIN_GAP = 16;

/** Sizes, group membership and (for manual layouts) pinned positions handed to the engine. */
export function buildLayoutGraph(content: DiagramContent): LayoutGraph {
  const groupIds = new Set(content.groups.map((group) => group.id));
  const nodeIds = new Set(content.nodes.map((node) => node.id));
  return {
    direction: content.direction,
    nodes: content.nodes.map((node) => ({
      id: node.id,
      ...estimateNodeSize(node),
      shape: node.shape,
      ...(node.group !== undefined && groupIds.has(node.group) ? { group: node.group } : {}),
      ...(content.layout === 'manual' && node.position
        ? { position: { x: node.position.x, y: node.position.y } }
        : {}),
    })),
    edges: content.edges
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .map((edge) => {
        const size = edgeLabelSize(edge.label);
        return {
          id: edge.id,
          from: edge.from,
          to: edge.to,
          labelWidth: size.width,
          labelHeight: size.height,
        };
      }),
    groups: content.groups.map((group) => ({
      id: group.id,
      kind: group.kind,
      labelWidth: groupLabelWidth(group.label),
      members: content.nodes.filter((node) => node.group === group.id).map((node) => node.id),
    })),
  };
}

/** `bands` when asked for or when any group is a band; otherwise dagre with box groups as clusters. */
export function selectEngine(content: DiagramContent): LayoutEngine {
  if (content.layout === 'bands' || content.groups.some((group) => group.kind === 'band')) return bandsEngine;
  return dagreEngine;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

/**
 * Pure, deterministic layout shared by the renderer, the SVG exporter and the editor. Uses the built-in
 * engines unless `options.engine` is given (it must be synchronous here; see `layoutDiagramAsync`).
 */
export function layoutDiagram(content: DiagramContent, options: LayoutOptions = {}): DiagramLayout {
  const graph = buildLayoutGraph(content);
  const engine = options.engine ?? selectEngine(content);
  const result = engine.layout(graph);
  if (isPromise(result)) {
    throw new TypeError(
      `Layout engine "${engine.name}" is asynchronous: use layoutDiagramAsync and pass the result to the renderer.`,
    );
  }
  return finalizeLayout(content, graph, engine, result, options);
}

/** Same as `layoutDiagram`, for asynchronous engines such as an elkjs adapter. */
export async function layoutDiagramAsync(
  content: DiagramContent,
  options: LayoutOptions = {},
): Promise<DiagramLayout> {
  const graph = buildLayoutGraph(content);
  const engine = options.engine ?? selectEngine(content);
  const result = await engine.layout(graph);
  return finalizeLayout(content, graph, engine, result, options);
}

function finalizeLayout(
  content: DiagramContent,
  graph: LayoutGraph,
  engine: LayoutEngine,
  result: LayoutEngineResult,
  options: LayoutOptions,
): DiagramLayout {
  const margin = options.margin ?? 16;
  const dir = graph.direction;
  const base = new Map<string, Rect>();
  let fallbackY = 0;
  for (const node of graph.nodes) {
    const placed = result.nodes[node.id];
    if (placed) {
      base.set(node.id, { x: placed.x, y: placed.y, width: node.width, height: node.height });
      fallbackY = Math.max(fallbackY, placed.y + node.height);
    }
  }
  // An engine that forgot nodes still yields a usable drawing: missing nodes go in a row below.
  let fallbackX = 0;
  for (const node of graph.nodes) {
    if (base.has(node.id)) continue;
    base.set(node.id, { x: fallbackX, y: fallbackY + 40, width: node.width, height: node.height });
    fallbackX += node.width + 40;
  }

  const { rects, moved } = applyPins(graph, base);
  const shapeOf = new Map(graph.nodes.map((node) => [node.id, node.shape]));

  const nodes: PositionedNode[] = graph.nodes.map((node) => {
    const rect = rects.get(node.id)!;
    return { id: node.id, shape: node.shape, pinned: node.position !== undefined, ...roundRect(rect) };
  });

  const contentEdges = new Map(content.edges.map((edge) => [edge.id, edge]));
  const edges: RoutedEdge[] = graph.edges.map((edge) => {
    const source = rects.get(edge.from)!;
    const target = rects.get(edge.to)!;
    const original = contentEdges.get(edge.id)!;
    const fromEngine = result.edges?.[edge.id];
    let points: Point[];
    let labelCenter: Point | undefined;
    if (
      fromEngine &&
      fromEngine.points.length >= 2 &&
      edge.from !== edge.to &&
      !moved.has(edge.from) &&
      !moved.has(edge.to)
    ) {
      points = fromEngine.points.map((p) => ({ x: p.x, y: p.y }));
      if (engine !== bandsEngine)
        clipEnds(points, source, shapeOf.get(edge.from)!, target, shapeOf.get(edge.to)!);
      labelCenter = fromEngine.label;
    } else if (edge.from === edge.to) {
      const loop = selfLoop(dir, { rect: source, shape: shapeOf.get(edge.from)! });
      points = loop.points;
      labelCenter =
        dir === 'TB'
          ? { x: loop.label.x + edge.labelWidth / 2 + 4, y: loop.label.y }
          : { x: loop.label.x, y: loop.label.y + edge.labelHeight / 2 + 4 };
    } else {
      points = routeBetween(
        dir,
        { rect: source, shape: shapeOf.get(edge.from)! },
        { rect: target, shape: shapeOf.get(edge.to)! },
      );
    }
    const routed: RoutedEdge = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      points: points.map((p) => ({ x: round(p.x), y: round(p.y) })),
      style: original.style,
      arrow: original.arrow,
    };
    if (edge.labelWidth > 0) {
      const c = labelCenter ?? lastSegmentMidpoint(points);
      routed.label = roundRect({
        x: c.x - edge.labelWidth / 2,
        y: c.y - edge.labelHeight / 2,
        width: edge.labelWidth,
        height: edge.labelHeight,
      });
    }
    return routed;
  });

  const groups: PositionedGroup[] = [];
  const pendingEmpty: { id: string; variant: 'band' | 'box'; width: number }[] = [];
  for (const group of graph.groups) {
    const variant = result.groupVariant ?? group.kind;
    const memberMoved = group.members.some((id) => moved.has(id));
    let rect = result.groups?.[group.id];
    if ((!rect || memberMoved) && group.members.length > 0) {
      // Grow the engine rectangle (or build one) so moved members stay inside their group.
      const box = unionRect(group.members.map((id) => rects.get(id)!))!;
      const around = {
        x: box.x - GROUP_PAD,
        y: box.y - GROUP_PAD - GROUP_HEADER,
        width: Math.max(box.width + GROUP_PAD * 2, group.labelWidth + 24),
        height: box.height + GROUP_PAD * 2 + GROUP_HEADER,
      };
      rect = rect ? unionRect([rect, around])! : around;
    }
    if (!rect) {
      pendingEmpty.push({ id: group.id, variant, width: Math.max(160, group.labelWidth + 24) });
      continue;
    }
    groups.push(positionGroup(group.id, variant, rect, dir));
  }

  const parts: Rect[] = [...nodes, ...groups];
  for (const edge of edges) {
    for (const p of edge.points) parts.push({ x: p.x, y: p.y, width: 0, height: 0 });
    if (edge.label) parts.push(edge.label);
  }
  let drawn = unionRect(parts) ?? { x: 0, y: 0, width: 0, height: 0 };
  // Groups without members and without an engine rectangle are stacked below the drawing.
  let nextY = parts.length > 0 ? drawn.y + drawn.height + 24 : 0;
  for (const empty of pendingEmpty) {
    groups.push(
      positionGroup(empty.id, empty.variant, { x: drawn.x, y: nextY, width: empty.width, height: 56 }, dir),
    );
    nextY += 56 + 16;
  }
  // Keep content order for groups.
  const order = new Map(graph.groups.map((group, index) => [group.id, index]));
  groups.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  drawn = unionRect([drawn, ...groups]) ?? drawn;
  const bounds = roundRect({
    x: drawn.x - margin,
    y: drawn.y - margin,
    width: drawn.width + margin * 2,
    height: drawn.height + margin * 2,
  });
  return {
    engine: engine.name,
    direction: dir,
    nodes,
    edges,
    groups,
    bounds,
    width: bounds.width,
    height: bounds.height,
  };
}

function positionGroup(
  id: string,
  variant: 'band' | 'box',
  rect: Rect,
  dir: LayoutGraph['direction'],
): PositionedGroup {
  const r = roundRect(rect);
  const rotated = variant === 'band' && dir === 'LR';
  return {
    id,
    variant,
    ...r,
    label: rotated
      ? { x: round(r.x + 17), y: round(r.y + 12), rotated }
      : { x: round(r.x + 12), y: round(r.y + 17), rotated },
  };
}

function roundRect(rect: Rect): Rect {
  return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
}

function clipEnds(
  points: Point[],
  source: Rect,
  sourceShape: string,
  target: Rect,
  targetShape: string,
): void {
  if (sourceShape === 'diamond' || sourceShape === 'ellipse') {
    points[0] = clipToShape(sourceShape, source, points[1]!);
  }
  if (targetShape === 'diamond' || targetShape === 'ellipse') {
    points[points.length - 1] = clipToShape(targetShape, target, points[points.length - 2]!);
  }
}

/**
 * Manual layout: pinned nodes keep their position and every other node keeps its automatic position, nudged
 * across the flow only when it would overlap something already placed. Pinning one node therefore never moves
 * the others. Deterministic: nodes are processed in content order.
 */
function applyPins(
  graph: LayoutGraph,
  base: Map<string, Rect>,
): { rects: Map<string, Rect>; moved: Set<string> } {
  const pinned = graph.nodes.filter((node) => node.position !== undefined);
  if (pinned.length === 0) return { rects: base, moved: new Set() };
  const rects = new Map<string, Rect>();
  const moved = new Set<string>();
  const placed: Rect[] = [];
  for (const node of pinned) {
    const from = base.get(node.id)!;
    const rect = { x: node.position!.x, y: node.position!.y, width: node.width, height: node.height };
    if (rect.x !== from.x || rect.y !== from.y) moved.add(node.id);
    rects.set(node.id, rect);
    placed.push(rect);
  }
  for (const node of graph.nodes) {
    if (node.position) continue;
    const from = base.get(node.id)!;
    const rect = { ...from };
    for (let attempt = 0; attempt < 500; attempt++) {
      const hit = placed.find((other) => rectsOverlap(rect, other, PIN_GAP));
      if (!hit) break;
      if (graph.direction === 'TB') rect.x = hit.x + hit.width + PIN_GAP;
      else rect.y = hit.y + hit.height + PIN_GAP;
    }
    if (Math.abs(rect.x - from.x) > 0.01 || Math.abs(rect.y - from.y) > 0.01) moved.add(node.id);
    rects.set(node.id, rect);
    placed.push(rect);
  }
  return { rects, moved };
}
