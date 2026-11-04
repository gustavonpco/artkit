import dagre from '@dagrejs/dagre';
import type { LayoutEngine, LayoutEngineResult, LayoutGraph, Point, Rect } from './types.js';

export const GROUP_HEADER = 26;
const GROUP_PAD = 14;

interface NodeLabel {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface EdgeLabel {
  width: number;
  height: number;
  labelpos: 'c';
  points?: Point[];
  x?: number;
  y?: number;
}

/**
 * dagre (MIT) layered layout. Box groups become dagre clusters; empty groups are laid out as placeholder
 * nodes so their label still has a place.
 */
export const dagreEngine: LayoutEngine = {
  name: 'dagre',
  layout(graph: LayoutGraph): LayoutEngineResult {
    const compound = graph.groups.length > 0;
    const g = new dagre.graphlib.Graph({ compound, multigraph: true });
    g.setGraph({
      rankdir: graph.direction,
      nodesep: 40,
      edgesep: 16,
      ranksep: compound ? 64 : 52,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));
    const emptyGroups = new Set(
      graph.groups.filter((group) => group.members.length === 0).map((group) => group.id),
    );
    for (const group of graph.groups) {
      if (emptyGroups.has(group.id))
        g.setNode(group.id, { width: Math.max(120, group.labelWidth + 24), height: 48 });
      else g.setNode(group.id, {});
    }
    for (const node of graph.nodes) {
      g.setNode(node.id, { width: node.width, height: node.height } satisfies NodeLabel);
      if (node.group && graph.groups.some((group) => group.id === node.group))
        g.setParent(node.id, node.group);
    }
    // Self loops are drawn by layoutDiagram; dagre's own self-edge routes look detached in LR.
    for (const edge of graph.edges) {
      if (edge.from === edge.to) continue;
      const label: EdgeLabel = { width: edge.labelWidth, height: edge.labelHeight, labelpos: 'c' };
      g.setEdge(edge.from, edge.to, label, edge.id);
    }
    dagre.layout(g);

    const nodes: Record<string, Point> = {};
    for (const node of graph.nodes) {
      const placed = g.node(node.id) as NodeLabel;
      nodes[node.id] = { x: (placed.x ?? 0) - node.width / 2, y: (placed.y ?? 0) - node.height / 2 };
    }
    const edges: NonNullable<LayoutEngineResult['edges']> = {};
    for (const edge of graph.edges) {
      if (edge.from === edge.to) continue;
      const placed = g.edge({ v: edge.from, w: edge.to, name: edge.id }) as EdgeLabel | undefined;
      if (!placed?.points || placed.points.length < 2) continue;
      edges[edge.id] = {
        points: placed.points.map((point) => ({ x: point.x, y: point.y })),
        ...(edge.labelWidth > 0 && placed.x !== undefined && placed.y !== undefined
          ? { label: { x: placed.x, y: placed.y } }
          : {}),
      };
    }
    const groups: Record<string, Rect> = {};
    for (const group of graph.groups) {
      const placed = g.node(group.id) as NodeLabel | undefined;
      if (!placed || placed.x === undefined || placed.y === undefined) continue;
      const rect = {
        x: placed.x - placed.width / 2,
        y: placed.y - placed.height / 2,
        width: placed.width,
        height: placed.height,
      };
      if (emptyGroups.has(group.id)) {
        groups[group.id] = rect;
        continue;
      }
      // dagre clusters have no room for a title: grow upwards into the rank gap and keep the label width.
      const members = group.members
        .map((id) => graph.nodes.find((node) => node.id === id))
        .filter((node) => node !== undefined);
      let minX = rect.x;
      let maxX = rect.x + rect.width;
      let minY = rect.y;
      let maxY = rect.y + rect.height;
      for (const member of members) {
        const pos = nodes[member.id]!;
        minX = Math.min(minX, pos.x - GROUP_PAD);
        maxX = Math.max(maxX, pos.x + member.width + GROUP_PAD);
        minY = Math.min(minY, pos.y - GROUP_PAD - GROUP_HEADER);
        maxY = Math.max(maxY, pos.y + member.height + GROUP_PAD);
      }
      maxX = Math.max(maxX, minX + group.labelWidth + 12);
      groups[group.id] = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    return { nodes, edges, groups, groupVariant: 'box' };
  },
};
