import { describe, expect, it } from 'vitest';
import {
  type DiagramContent,
  type DiagramLayout,
  isotonic,
  type LayoutEngine,
  layoutDiagram,
  layoutDiagramAsync,
  longestPathRanks,
  type Rect,
} from '../src/index.js';
import { flow, layered } from './fixtures.js';

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 0.1 &&
  inner.y >= outer.y - 0.1 &&
  inner.x + inner.width <= outer.x + outer.width + 0.1 &&
  inner.y + inner.height <= outer.y + outer.height + 0.1;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const onBoundary = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x - 0.6 && p.x <= r.x + r.width + 0.6 && p.y >= r.y - 0.6 && p.y <= r.y + r.height + 0.6;

function expectNoNodeOverlap(layout: DiagramLayout) {
  for (const a of layout.nodes)
    for (const b of layout.nodes) if (a !== b) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
}

function expectWithinBounds(layout: DiagramLayout) {
  for (const node of layout.nodes) expect(inside(node, layout.bounds), node.id).toBe(true);
  for (const group of layout.groups) expect(inside(group, layout.bounds), group.id).toBe(true);
  for (const edge of layout.edges) {
    for (const p of edge.points)
      expect(inside({ ...p, width: 0, height: 0 }, layout.bounds), edge.id).toBe(true);
    if (edge.label) expect(inside(edge.label, layout.bounds), `${edge.id} label`).toBe(true);
  }
}

describe('bands layout', () => {
  const layout = layoutDiagram(layered);

  it('is deterministic', () => {
    expect(layoutDiagram(structuredClone(layered))).toEqual(layout);
    expect(layout.engine).toBe('bands');
  });

  it('stacks bands top to bottom and keeps nodes inside their band', () => {
    const groups = layout.groups;
    expect(groups.map((group) => group.id)).toEqual(['canais', 'servicos', 'dados']);
    for (let i = 1; i < groups.length; i++)
      expect(groups[i]!.y).toBeGreaterThanOrEqual(groups[i - 1]!.y + groups[i - 1]!.height);
    expect(new Set(groups.map((group) => group.width)).size).toBe(1);
    for (const node of layered.nodes) {
      const rect = layout.nodes.find((n) => n.id === node.id)!;
      const band = groups.find((group) => group.id === node.group)!;
      expect(inside(rect, band), node.id).toBe(true);
    }
    expect(groups.every((group) => group.variant === 'band' && !group.label.rotated)).toBe(true);
    expectNoNodeOverlap(layout);
    expectWithinBounds(layout);
  });

  it('places sub-rows for edges inside a band', () => {
    const api = layout.nodes.find((n) => n.id === 'api')!;
    const auth = layout.nodes.find((n) => n.id === 'auth')!;
    expect(auth.y).toBeGreaterThan(api.y + api.height);
  });

  it('routes edges orthogonally from outline to outline with labels on the last segment', () => {
    for (const edge of layout.edges) {
      const points = edge.points;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        expect(Math.abs(a.x - b.x) < 0.2 || Math.abs(a.y - b.y) < 0.2, `${edge.id} segment ${i}`).toBe(true);
      }
      const from = layout.nodes.find((n) => n.id === edge.from)!;
      const to = layout.nodes.find((n) => n.id === edge.to)!;
      expect(onBoundary(points[0]!, from), `${edge.id} start`).toBe(true);
      expect(onBoundary(points.at(-1)!, to), `${edge.id} end`).toBe(true);
      if (edge.label) {
        const last = points.at(-1)!;
        const center = { x: edge.label.x + edge.label.width / 2, y: edge.label.y + edge.label.height / 2 };
        expect(Math.abs(center.x - last.x)).toBeLessThan(0.2);
      }
    }
    const e6 = layout.edges.find((edge) => edge.id === 'e6')!;
    expect(e6.style).toBe('dashed');
    expect(e6.points.length).toBeGreaterThanOrEqual(2);
  });

  it('lays bands out as lanes in LR with side labels', () => {
    const lr = layoutDiagram({ ...layered, direction: 'LR' });
    const groups = lr.groups;
    for (let i = 1; i < groups.length; i++)
      expect(groups[i]!.x).toBeGreaterThanOrEqual(groups[i - 1]!.x + groups[i - 1]!.width);
    expect(groups.every((group) => group.label.rotated)).toBe(true);
    expectNoNodeOverlap(lr);
    expectWithinBounds(lr);
  });

  it('reduces crossings', () => {
    const content: DiagramContent = {
      direction: 'TB',
      layout: 'bands',
      groups: [
        { id: 'top', label: 'Top', kind: 'band' },
        { id: 'bottom', label: 'Bottom', kind: 'band' },
      ],
      nodes: [
        { id: 'a', label: 'A', shape: 'box', group: 'top' },
        { id: 'b', label: 'B', shape: 'box', group: 'top' },
        { id: 'c', label: 'C', shape: 'box', group: 'bottom' },
        { id: 'd', label: 'D', shape: 'box', group: 'bottom' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'd', style: 'solid', arrow: 'end' },
        { id: 'e2', from: 'b', to: 'c', style: 'solid', arrow: 'end' },
      ],
    };
    const result = layoutDiagram(content);
    const x = (id: string) => result.nodes.find((n) => n.id === id)!.x;
    expect(x('a') < x('b')).toBe(x('d') < x('c'));
  });

  it('handles back edges, same-layer edges, self loops, ungrouped nodes and empty bands', () => {
    const content: DiagramContent = {
      direction: 'TB',
      layout: 'bands',
      groups: [
        { id: 'g1', label: 'One', kind: 'band' },
        { id: 'g2', label: 'Two', kind: 'band' },
        { id: 'g3', label: 'Empty', kind: 'band' },
      ],
      nodes: [
        { id: 'user', label: 'User', shape: 'actor' },
        { id: 'a', label: 'A', shape: 'box', group: 'g1' },
        { id: 'b', label: 'B', shape: 'diamond', group: 'g1' },
        { id: 'c', label: 'C', shape: 'ellipse', group: 'g2' },
        { id: 'z', label: 'Z', shape: 'box', group: 'g1' },
      ],
      edges: [
        { id: 'e1', from: 'user', to: 'a', style: 'solid', arrow: 'end' },
        { id: 'e2', from: 'a', to: 'c', label: 'call', style: 'solid', arrow: 'end' },
        { id: 'e3', from: 'c', to: 'b', label: 'reply', style: 'dashed', arrow: 'end' },
        { id: 'e4', from: 'c', to: 'c', label: 'retry', style: 'solid', arrow: 'end' },
        { id: 'e5', from: 'a', to: 'z', style: 'solid', arrow: 'none' },
        { id: 'e6', from: 'user', to: 'c', style: 'solid', arrow: 'end' },
      ],
    };
    const result = layoutDiagram(content);
    const user = result.nodes.find((n) => n.id === 'user')!;
    const g1 = result.groups.find((g) => g.id === 'g1')!;
    expect(user.y + user.height).toBeLessThanOrEqual(g1.y);
    expect(result.edges).toHaveLength(6);
    const back = result.edges.find((e) => e.id === 'e3')!;
    expect(back.points[0]!.y).toBeGreaterThan(back.points.at(-1)!.y);
    const loop = result.edges.find((e) => e.id === 'e4')!;
    expect(loop.points.length).toBe(5);
    const empty = result.groups.find((g) => g.id === 'g3')!;
    expect(empty.height).toBeGreaterThan(0);
    expectNoNodeOverlap(result);
    expectWithinBounds(result);
  });
});

describe('dagre layout', () => {
  it('is used for graphs without band groups', () => {
    const layout = layoutDiagram(flow);
    expect(layout.engine).toBe('dagre');
    expect(layoutDiagram(structuredClone(flow))).toEqual(layout);
    expectNoNodeOverlap(layout);
    expectWithinBounds(layout);
    const start = layout.nodes.find((n) => n.id === 'start')!;
    const save = layout.nodes.find((n) => n.id === 'save')!;
    expect(save.x).toBeGreaterThan(start.x);
    for (const edge of layout.edges) expect(edge.points.length).toBeGreaterThanOrEqual(2);
  });

  it('draws box groups as clusters around their nodes', () => {
    const content: DiagramContent = {
      ...flow,
      groups: [
        { id: 'proc', label: 'Processing', kind: 'box' },
        { id: 'void', label: 'Nothing here', kind: 'box' },
      ],
      nodes: flow.nodes.map((node) =>
        node.id === 'check' || node.id === 'save' ? { ...node, group: 'proc' } : node,
      ),
    };
    const layout = layoutDiagram(content);
    expect(layout.engine).toBe('dagre');
    const proc = layout.groups.find((g) => g.id === 'proc')!;
    expect(proc.variant).toBe('box');
    for (const id of ['check', 'save'])
      expect(inside(layout.nodes.find((n) => n.id === id)!, proc)).toBe(true);
    expect(layout.groups.find((g) => g.id === 'void')).toBeDefined();
    expectWithinBounds(layout);
  });

  it('switches to bands as soon as a group is a band', () => {
    const content: DiagramContent = { ...flow, groups: [{ id: 'lane', label: 'Lane', kind: 'band' }] };
    expect(layoutDiagram(content).engine).toBe('bands');
  });
});

describe('manual layout', () => {
  it('honors pins and places the other nodes without overlapping them', () => {
    const auto = layoutDiagram(layered);
    const content: DiagramContent = {
      ...layered,
      layout: 'manual',
      nodes: layered.nodes.map((node) =>
        node.id === 'api' ? { ...node, position: { x: -400, y: 900 } } : node,
      ),
    };
    const manual = layoutDiagram(content);
    const api = manual.nodes.find((n) => n.id === 'api')!;
    expect([api.x, api.y, api.pinned]).toEqual([-400, 900, true]);
    expectNoNodeOverlap(manual);
    expectWithinBounds(manual);
    expect(manual.bounds.x).toBeLessThan(-400);
    // Unpinned nodes keep their automatic place: pinning one node never drags the others.
    for (const node of manual.nodes.filter((n) => n.id !== 'api')) {
      const before = auto.nodes.find((n) => n.id === node.id)!;
      expect([node.x, node.y, node.pinned]).toEqual([before.x, before.y, false]);
    }
    // The band grows to keep its moved member inside.
    expect(inside(api, manual.groups.find((g) => g.id === 'servicos')!)).toBe(true);
    expect(manual.edges.find((e) => e.id === 'e4')!.points[0]).toBeDefined();
  });

  it('keeps the automatic layout when nothing is pinned', () => {
    expect(layoutDiagram({ ...layered, layout: 'manual' }).nodes).toEqual(layoutDiagram(layered).nodes);
  });

  it('ignores pins outside manual layout', () => {
    const content: DiagramContent = {
      ...flow,
      nodes: flow.nodes.map((node) => ({ ...node, position: { x: 999, y: 999 } })),
    };
    expect(layoutDiagram(content).nodes.every((node) => !node.pinned)).toBe(true);
  });
});

describe('custom engines', () => {
  const grid: LayoutEngine = {
    name: 'grid',
    layout: (graph) => ({
      nodes: Object.fromEntries(
        graph.nodes.map((node, i) => [node.id, { x: (i % 3) * 220, y: Math.floor(i / 3) * 140 }]),
      ),
    }),
  };

  it('plugs a synchronous engine and fills routes and groups', () => {
    const layout = layoutDiagram(layered, { engine: grid });
    expect(layout.engine).toBe('grid');
    expect(layout.nodes[1]).toMatchObject({ id: 'app', x: 220, y: 0 });
    expect(layout.edges).toHaveLength(layered.edges.length);
    expect(layout.groups).toHaveLength(3);
    expectWithinBounds(layout);
  });

  it('requires layoutDiagramAsync for asynchronous engines', async () => {
    const asyncGrid: LayoutEngine = { name: 'async-grid', layout: async (graph) => grid.layout(graph) };
    expect(() => layoutDiagram(layered, { engine: asyncGrid })).toThrow(TypeError);
    const layout = await layoutDiagramAsync(layered, { engine: asyncGrid });
    expect(layout.nodes[1]).toMatchObject({ id: 'app', x: 220, y: 0 });
  });

  it('lays out an empty diagram', () => {
    const layout = layoutDiagram({ direction: 'TB', layout: 'auto', nodes: [], edges: [], groups: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('isotonic regression pools violators', () => {
    expect(isotonic([3, 1, 2], [1, 1, 1])).toEqual([2, 2, 2]);
    expect(isotonic([1, 2, 3], [1, 1, 1])).toEqual([1, 2, 3]);
  });

  it('longest path ranks ignore cycles', () => {
    const ranks = longestPathRanks(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    );
    expect([...ranks.entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('handles 300 nodes quickly', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
      shape: 'box' as const,
      group: `g${i % 10}`,
    }));
    const edges = Array.from({ length: 600 }, (_, i) => ({
      id: `e${i}`,
      from: `n${i % 300}`,
      to: `n${(i * 7 + 13) % 300}`,
      style: 'solid' as const,
      arrow: 'end' as const,
    }));
    const groups = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`,
      label: `Group ${i}`,
      kind: 'band' as const,
    }));
    const started = performance.now();
    const layout = layoutDiagram({ direction: 'TB', layout: 'bands', nodes, edges, groups });
    expect(performance.now() - started).toBeLessThan(5000);
    expectNoNodeOverlap(layout);
  });
});

describe('manual nudging', () => {
  it('moves unpinned nodes out of the way of a pinned one', () => {
    const auto = layoutDiagram(layered);
    const web = auto.nodes.find((n) => n.id === 'web')!;
    const content: DiagramContent = {
      ...layered,
      layout: 'manual',
      nodes: layered.nodes.map((node) =>
        node.id === 'pg' ? { ...node, position: { x: web.x, y: web.y } } : node,
      ),
    };
    const manual = layoutDiagram(content);
    expectNoNodeOverlap(manual);
    expect(manual.nodes.find((n) => n.id === 'web')!.x).toBeGreaterThan(web.x);
  });
});
