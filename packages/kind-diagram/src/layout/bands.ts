import { GROUP_HEADER } from './dagre.js';
import { crossSize, mainExtent, mainSize, selfLoop, simplify, toReal } from './geometry.js';
import type {
  LayoutEngine,
  LayoutEngineResult,
  LayoutGraph,
  LayoutGraphEdge,
  LayoutGraphNode,
  Point,
  Rect,
} from './types.js';

const NODE_GAP = 40;
const DUMMY_GAP = 14;
const TRACK_GAP = 10;
const TRACK_SEP = 8;
const CHANNEL_PAD = 10;
const BAND_PAD = 14;
const BAND_SIDE = 16;
const INNER_CHANNEL_MIN = 44;
const BAND_CHANNEL_MIN = 28;
const LABEL_ROW_GAP = 4;
const SWEEPS = 8;
const PLACEMENT_ITERATIONS = 8;

interface Item {
  key: string;
  layer: number;
  /** Size across the flow and along it (abstract coordinates). */
  cross: number;
  main: number;
  node?: LayoutGraphNode;
  up: Item[];
  down: Item[];
  index: number;
  pos: number;
}

interface Band {
  id: string | null;
  labelWidth: number;
  nodes: LayoutGraphNode[];
  firstLayer: number;
  rows: number;
}

type Side = 'start' | 'end';

interface ChainRoute {
  kind: 'chain';
  edge: LayoutGraphEdge;
  order: number;
  src: Item;
  tgt: Item;
  inner: Item[];
  channels: number[];
  /** Back routes (upward or same-layer) use the tracks below the label zone of a channel. */
  back: boolean;
  srcSide: Side;
  tgtSide: Side;
  srcPort: number;
  tgtPort: number;
  tracks: (number | undefined)[];
  labelRow?: number;
}

interface Segment {
  route: ChainRoute;
  step: number;
  a: number;
  b: number;
}

/**
 * Layered layout where groups are bands: horizontal layers stacked top to bottom (TB) or vertical lanes left to
 * right (LR). Nodes stay inside their band (sub-rows follow edges inside the band), crossings are reduced with
 * barycenter sweeps, edges are routed orthogonally through the free channels between rows and bands, and edge
 * labels sit on the last segment. Everything is computed in abstract coordinates (u across the flow, v along it).
 */
export const bandsEngine: LayoutEngine = {
  name: 'bands',
  layout: (graph) => layoutBands(graph),
};

export function layoutBands(graph: LayoutGraph): LayoutEngineResult {
  const dir = graph.direction;
  const bands = buildBands(graph);
  if (bands.length === 0) return { nodes: {}, edges: {}, groups: {}, groupVariant: 'band' };
  const bandOf = new Map<string, number>();
  bands.forEach((band, b) => {
    for (const node of band.nodes) bandOf.set(node.id, b);
  });

  // Rows inside each band follow the edges between its own nodes.
  const rank = new Map<string, number>();
  let layerCount = 0;
  bands.forEach((band, b) => {
    const internal = graph.edges.filter(
      (e) => e.from !== e.to && bandOf.get(e.from) === b && bandOf.get(e.to) === b,
    );
    const ranks = longestPathRanks(
      band.nodes.map((n) => n.id),
      internal,
    );
    let rows = 1;
    for (const node of band.nodes) {
      const r = ranks.get(node.id) ?? 0;
      rank.set(node.id, r);
      rows = Math.max(rows, r + 1);
    }
    band.firstLayer = layerCount;
    band.rows = rows;
    layerCount += rows;
  });
  const layerBand: number[] = [];
  bands.forEach((band, b) => {
    for (let r = 0; r < band.rows; r++) layerBand.push(b);
  });

  const layers: Item[][] = Array.from({ length: layerCount }, () => []);
  const nodeItem = new Map<string, Item>();
  for (const band of bands) {
    for (const node of band.nodes) {
      const item: Item = {
        key: node.id,
        layer: band.firstLayer + (rank.get(node.id) ?? 0),
        cross: crossSize(dir, node),
        main: mainSize(dir, node),
        node,
        up: [],
        down: [],
        index: 0,
        pos: 0,
      };
      nodeItem.set(node.id, item);
      layers[item.layer]!.push(item);
    }
  }

  const chains: { edge: LayoutGraphEdge; order: number; items: Item[] }[] = [];
  const sameLayer: { edge: LayoutGraphEdge; order: number }[] = [];
  const selfEdges: LayoutGraphEdge[] = [];
  graph.edges.forEach((edge, order) => {
    const src = nodeItem.get(edge.from);
    const tgt = nodeItem.get(edge.to);
    if (!src || !tgt) return;
    if (src === tgt) {
      selfEdges.push(edge);
      return;
    }
    if (src.layer === tgt.layer) {
      sameLayer.push({ edge, order });
      return;
    }
    const step = tgt.layer > src.layer ? 1 : -1;
    const items = [src];
    for (let l = src.layer + step; l !== tgt.layer; l += step) {
      const dummy: Item = {
        key: `${edge.id}~${l}`,
        layer: l,
        cross: 0,
        main: 0,
        up: [],
        down: [],
        index: 0,
        pos: 0,
      };
      layers[l]!.push(dummy);
      items.push(dummy);
    }
    items.push(tgt);
    for (let i = 0; i + 1 < items.length; i++) {
      const a = items[i]!;
      const b = items[i + 1]!;
      const [upper, lower] = a.layer < b.layer ? [a, b] : [b, a];
      upper.down.push(lower);
      lower.up.push(upper);
    }
    chains.push({ edge, order, items });
  });

  orderLayers(layers);

  // Extra room on the trailing side of nodes with self loops, and between neighbors joined by a labeled edge.
  const trailing = new Map<string, number>();
  for (const edge of selfEdges)
    trailing.set(
      edge.from,
      Math.max(trailing.get(edge.from) ?? 0, 22 + (edge.labelWidth > 0 ? edge.labelWidth / 2 + 4 : 0)),
    );
  const adjacentGap = new Map<string, number>();
  const adjacentEdges: { edge: LayoutGraphEdge; src: Item; tgt: Item }[] = [];
  const channelSameLayer: { edge: LayoutGraphEdge; order: number; src: Item; tgt: Item }[] = [];
  for (const { edge, order } of sameLayer) {
    const src = nodeItem.get(edge.from)!;
    const tgt = nodeItem.get(edge.to)!;
    if (Math.abs(src.index - tgt.index) === 1) {
      const left = src.index < tgt.index ? src : tgt;
      const key = `${left.key}|${(left === src ? tgt : src).key}`;
      adjacentGap.set(
        key,
        Math.max(adjacentGap.get(key) ?? NODE_GAP, edge.labelWidth > 0 ? edge.labelWidth + 24 : NODE_GAP),
      );
      adjacentEdges.push({ edge, src, tgt });
    } else channelSameLayer.push({ edge, order, src, tgt });
  }
  const separation = (a: Item, b: Item): number => {
    if (!a.node || !b.node) return (a.cross + b.cross) / 2 + DUMMY_GAP;
    const gap = adjacentGap.get(`${a.key}|${b.key}`) ?? NODE_GAP;
    return (a.cross + b.cross) / 2 + gap + (trailing.get(a.key) ?? 0);
  };
  placeLayers(layers, separation);

  // Normalize so the leftmost item starts at 0.
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    for (const item of layer) {
      minU = Math.min(minU, item.pos - item.cross / 2);
      maxU = Math.max(maxU, item.pos + item.cross / 2 + (trailing.get(item.key) ?? 0));
    }
  }
  if (!Number.isFinite(minU)) {
    minU = 0;
    maxU = 0;
  }
  for (const layer of layers) for (const item of layer) item.pos -= minU;
  maxU -= minU;

  // Route skeletons: which channels each edge crosses and through which dummy positions.
  const routes: ChainRoute[] = [];
  for (const chain of chains) {
    const src = chain.items[0]!;
    const tgt = chain.items[chain.items.length - 1]!;
    const forward = tgt.layer > src.layer;
    const channels: number[] = [];
    if (forward) for (let c = src.layer + 1; c <= tgt.layer; c++) channels.push(c);
    else for (let c = src.layer; c >= tgt.layer + 1; c--) channels.push(c);
    routes.push({
      kind: 'chain',
      edge: chain.edge,
      order: chain.order,
      src,
      tgt,
      inner: chain.items.slice(1, -1),
      channels,
      back: !forward,
      srcSide: forward ? 'end' : 'start',
      tgtSide: forward ? 'start' : 'end',
      srcPort: src.pos,
      tgtPort: tgt.pos,
      tracks: [],
    });
  }
  for (const { edge, order, src, tgt } of channelSameLayer) {
    routes.push({
      kind: 'chain',
      edge,
      order,
      src,
      tgt,
      inner: [],
      channels: [src.layer + 1],
      back: true,
      srcSide: 'end',
      tgtSide: 'end',
      srcPort: src.pos,
      tgtPort: tgt.pos,
      tracks: [],
    });
  }
  routes.sort((a, b) => a.order - b.order);
  assignPorts(routes);

  // Tracks per channel (forward and back separately) and label rows.
  const channelCount = layerCount + 1;
  const fwdTracks = new Array<number>(channelCount).fill(0);
  const backTracks = new Array<number>(channelCount).fill(0);
  const labelRows = new Array<number>(channelCount).fill(0);
  const labelHeight = new Array<number>(channelCount).fill(0);
  const segmentsByChannel = new Map<string, Segment[]>();
  for (const route of routes) {
    const waypoints = [route.srcPort, ...route.inner.map((item) => item.pos), route.tgtPort];
    route.channels.forEach((channel, step) => {
      const a = Math.min(waypoints[step]!, waypoints[step + 1]!);
      const b = Math.max(waypoints[step]!, waypoints[step + 1]!);
      if (b - a < 0.5) return;
      const key = `${channel}|${route.back ? 'b' : 'f'}`;
      const list = segmentsByChannel.get(key) ?? [];
      list.push({ route, step, a, b });
      segmentsByChannel.set(key, list);
    });
  }
  for (const [key, segments] of [...segmentsByChannel.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const [channelText, kind] = key.split('|');
    const channel = Number(channelText);
    const count = assignIntervals(
      segments.map((s) => ({ a: s.a, b: s.b, order: s.route.order })),
      TRACK_SEP,
      (index, track) => {
        const segment = segments[index]!;
        segment.route.tracks[segment.step] = track;
      },
    );
    if (kind === 'f') fwdTracks[channel] = count;
    else backTracks[channel] = count;
  }
  const labelsByChannel = new Map<number, ChainRoute[]>();
  for (const route of routes) {
    if (route.edge.labelWidth <= 0) continue;
    const channel = route.channels[route.channels.length - 1]!;
    labelsByChannel.set(channel, [...(labelsByChannel.get(channel) ?? []), route]);
  }
  for (const [channel, list] of labelsByChannel) {
    labelRows[channel] = assignIntervals(
      list.map((route) => ({
        a: route.tgtPort - route.edge.labelWidth / 2,
        b: route.tgtPort + route.edge.labelWidth / 2,
        order: route.order,
      })),
      6,
      (index, row) => {
        list[index]!.labelRow = row;
      },
    );
    labelHeight[channel] = Math.max(...list.map((route) => route.edge.labelHeight));
  }
  const channelNeed = (c: number) => {
    const tracks = fwdTracks[c]! + backTracks[c]!;
    const labels = labelRows[c]! * (labelHeight[c]! + LABEL_ROW_GAP);
    return tracks === 0 && labels === 0
      ? 0
      : CHANNEL_PAD * 2 + Math.max(0, tracks - 1) * TRACK_GAP + labels + (labels > 0 ? 4 : 0);
  };

  // Positions along the flow.
  const layerTop = new Array<number>(layerCount).fill(0);
  const layerSize = new Array<number>(layerCount).fill(0);
  const channelTop = new Array<number>(channelCount).fill(0);
  const channelSize = new Array<number>(channelCount).fill(0);
  const bandStart: number[] = [];
  const bandEnd: number[] = [];
  let v = 0;
  bands.forEach((band, b) => {
    bandStart[b] = v;
    v += (band.id !== null ? GROUP_HEADER : 0) + BAND_PAD;
    for (let r = 0; r < band.rows; r++) {
      const l = band.firstLayer + r;
      if (r > 0) {
        channelTop[l] = v;
        channelSize[l] = Math.max(INNER_CHANNEL_MIN, channelNeed(l));
        v += channelSize[l]!;
      }
      const items = layers[l]!;
      layerTop[l] = v;
      layerSize[l] = items.some((item) => item.node) ? Math.max(...items.map((item) => item.main)) : 20;
      v += layerSize[l]!;
    }
    v += BAND_PAD;
    bandEnd[b] = v;
    const next = band.firstLayer + band.rows;
    if (b < bands.length - 1) {
      channelTop[next] = v;
      channelSize[next] = Math.max(BAND_CHANNEL_MIN, channelNeed(next));
      v += channelSize[next]!;
    } else if (channelNeed(next) > 0) {
      channelTop[next] = v;
      channelSize[next] = channelNeed(next);
      v += channelSize[next]!;
    }
  });

  const channelLayout = (c: number) => {
    const needed = channelNeed(c);
    const offset = channelTop[c]! + (channelSize[c]! - needed) / 2 + CHANNEL_PAD;
    const labelStart =
      offset + Math.max(0, fwdTracks[c]! - 1) * TRACK_GAP + (fwdTracks[c]! > 0 ? TRACK_GAP / 2 : 0);
    const labels = labelRows[c]! * (labelHeight[c]! + LABEL_ROW_GAP);
    const backStart =
      labelStart +
      labels +
      (labels > 0 ? 4 : 0) +
      (fwdTracks[c]! > 0 && backTracks[c]! > 0 && labels === 0 ? TRACK_GAP / 2 : 0);
    return { fwd: offset, labelStart, back: backStart };
  };
  const centerV = (item: Item) => layerTop[item.layer]! + layerSize[item.layer]! / 2;
  const portV = (item: Item, side: Side, port: number) => {
    const node = item.node!;
    const extent = mainExtent(node.shape, item.cross / 2, item.main / 2, port - item.pos, dir);
    return centerV(item) + (side === 'end' ? extent : -extent);
  };

  const nodes: Record<string, Point> = {};
  for (const [id, item] of nodeItem) {
    const c = toReal(dir, item.pos, centerV(item));
    nodes[id] = { x: c.x - item.node!.width / 2, y: c.y - item.node!.height / 2 };
  }

  const edges: NonNullable<LayoutEngineResult['edges']> = {};
  for (const route of routes) {
    const waypoints = [route.srcPort, ...route.inner.map((item) => item.pos), route.tgtPort];
    const abstract: [number, number][] = [[route.srcPort, portV(route.src, route.srcSide, route.srcPort)]];
    route.channels.forEach((channel, step) => {
      const track = route.tracks[step];
      if (track === undefined) return;
      const layout = channelLayout(channel);
      const y = route.back ? layout.back + track * TRACK_GAP : layout.fwd + track * TRACK_GAP;
      abstract.push([waypoints[step]!, y], [waypoints[step + 1]!, y]);
    });
    abstract.push([route.tgtPort, portV(route.tgt, route.tgtSide, route.tgtPort)]);
    const points = simplify(abstract.map(([u, vv]) => toReal(dir, u, vv)));
    let label: Point | undefined;
    if (route.edge.labelWidth > 0) {
      const channel = route.channels[route.channels.length - 1]!;
      const layout = channelLayout(channel);
      const row = route.labelRow ?? 0;
      label = toReal(
        dir,
        route.tgtPort,
        layout.labelStart + row * (labelHeight[channel]! + LABEL_ROW_GAP) + route.edge.labelHeight / 2,
      );
    }
    edges[route.edge.id] = label ? { points, label } : { points };
  }
  for (const { edge, src, tgt } of adjacentEdges) {
    const sign = tgt.pos > src.pos ? 1 : -1;
    const v0 = centerV(src);
    const a = toReal(dir, src.pos + (sign * src.cross) / 2, v0);
    const b = toReal(dir, tgt.pos - (sign * tgt.cross) / 2, v0);
    edges[edge.id] = {
      points: [a, b],
      ...(edge.labelWidth > 0 ? { label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } } : {}),
    };
  }
  for (const edge of selfEdges) {
    const item = nodeItem.get(edge.from)!;
    const node = item.node!;
    const c = toReal(dir, item.pos, centerV(item));
    const loop = selfLoop(dir, {
      rect: { x: c.x - node.width / 2, y: c.y - node.height / 2, width: node.width, height: node.height },
      shape: node.shape,
    });
    const labelAt =
      edge.labelWidth > 0
        ? dir === 'TB'
          ? { x: loop.label.x + edge.labelWidth / 2 + 4, y: loop.label.y }
          : { x: loop.label.x, y: loop.label.y + edge.labelHeight / 2 + 4 }
        : undefined;
    edges[edge.id] = labelAt ? { points: loop.points, label: labelAt } : { points: loop.points };
  }

  const groups: Record<string, Rect> = {};
  bands.forEach((band, b) => {
    if (band.id === null) return;
    const width = Math.max(maxU + BAND_SIDE * 2, band.labelWidth + 24);
    const start = toReal(dir, -BAND_SIDE, bandStart[b]!);
    const length = bandEnd[b]! - bandStart[b]!;
    groups[band.id] =
      dir === 'TB'
        ? { x: start.x, y: start.y, width, height: length }
        : { x: start.x, y: start.y, width: length, height: width };
  });
  // All bands share the widest extent so they line up.
  const widest = Math.max(
    0,
    ...Object.values(groups).map((rect) => (dir === 'TB' ? rect.width : rect.height)),
  );
  for (const rect of Object.values(groups)) {
    if (dir === 'TB') rect.width = widest;
    else rect.height = widest;
  }
  return { nodes, edges, groups, groupVariant: 'band' };
}

function buildBands(graph: LayoutGraph): Band[] {
  const bands: Band[] = graph.groups.map((group) => ({
    id: group.id,
    labelWidth: group.labelWidth,
    nodes: [],
    firstLayer: 0,
    rows: 1,
  }));
  const index = new Map(graph.groups.map((group, i) => [group.id, i]));
  const ungrouped: LayoutGraphNode[] = [];
  for (const node of graph.nodes) {
    const b = node.group === undefined ? undefined : index.get(node.group);
    if (b === undefined) ungrouped.push(node);
    else bands[b]!.nodes.push(node);
  }
  if (ungrouped.length > 0) {
    // Ungrouped nodes form an unlabeled band: first when they mostly feed the groups (e.g. users), else last.
    const loose = new Set(ungrouped.map((node) => node.id));
    let score = 0;
    for (const edge of graph.edges) {
      const fromLoose = loose.has(edge.from);
      const toLoose = loose.has(edge.to);
      if (fromLoose && !toLoose) score++;
      else if (!fromLoose && toLoose) score--;
    }
    const implicit: Band = { id: null, labelWidth: 0, nodes: ungrouped, firstLayer: 0, rows: 1 };
    if (score > 0) bands.unshift(implicit);
    else bands.push(implicit);
  }
  return bands;
}

/** Longest-path ranks after breaking cycles with a DFS in node order (back edges are ignored). */
export function longestPathRanks(ids: string[], edges: { from: string; to: string }[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) out.get(edge.from)?.push(edge.to);
  const state = new Map<string, number>();
  const acyclic: [string, string][] = [];
  const visit = (start: string) => {
    // Iterative DFS keeps deep chains from overflowing the stack.
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const targets = out.get(frame.id) ?? [];
      if (frame.next >= targets.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const target = targets[frame.next++]!;
      const s = state.get(target) ?? 0;
      if (s === 1) continue;
      acyclic.push([frame.id, target]);
      if (s === 0) {
        state.set(target, 1);
        stack.push({ id: target, next: 0 });
      }
    }
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [from, to] of acyclic) {
    succ.get(from)!.push(to);
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  }
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => incoming.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const to of succ.get(id)!) {
      rank.set(to, Math.max(rank.get(to)!, rank.get(id)! + 1));
      const left = incoming.get(to)! - 1;
      incoming.set(to, left);
      if (left === 0) queue.push(to);
    }
  }
  return rank;
}

function setIndices(layer: Item[]): void {
  layer.forEach((item, index) => {
    item.index = index;
  });
}

/** Barycenter crossing reduction: alternating down/up sweeps, keeping the best ordering found. */
function orderLayers(layers: Item[][]): void {
  for (const layer of layers) setIndices(layer);
  const sweep = (down: boolean) => {
    const count = layers.length;
    for (let step = 1; step < count; step++) {
      const l = down ? step : count - 1 - step;
      const layer = layers[l]!;
      const refLength = layers[down ? l - 1 : l + 1]!.length || 1;
      const keyed = layer.map((item) => {
        const neighbors = down ? item.up : item.down;
        const bary =
          neighbors.length > 0
            ? neighbors.reduce((sum, n) => sum + n.index + 0.5, 0) / neighbors.length / refLength
            : (item.index + 0.5) / layer.length;
        return { item, bary };
      });
      keyed.sort((a, b) => a.bary - b.bary || a.item.index - b.item.index);
      layers[l] = keyed.map((entry) => entry.item);
      setIndices(layers[l]!);
    }
  };
  sweep(true);
  let best = layers.map((layer) => [...layer]);
  let bestCrossings = countCrossings(layers);
  for (let i = 0; i < SWEEPS && bestCrossings > 0; i++) {
    sweep(i % 2 === 1);
    const crossings = countCrossings(layers);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = layers.map((layer) => [...layer]);
    }
  }
  best.forEach((layer, l) => {
    layers[l] = layer;
    setIndices(layer);
  });
}

/** Crossings between consecutive layers, counted as inversions with a Fenwick tree. */
function countCrossings(layers: Item[][]): number {
  let total = 0;
  for (let l = 0; l + 1 < layers.length; l++) {
    const pairs: [number, number][] = [];
    for (const item of layers[l]!) for (const lower of item.down) pairs.push([item.index, lower.index]);
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const size = layers[l + 1]!.length + 1;
    const tree = new Array<number>(size + 1).fill(0);
    let seen = 0;
    for (const [, b] of pairs) {
      let notGreater = 0;
      for (let i = b + 1; i > 0; i -= i & -i) notGreater += tree[i]!;
      total += seen - notGreater;
      for (let i = b + 1; i <= size; i += i & -i) tree[i]!++;
      seen++;
    }
  }
  return total;
}

/**
 * Positions across the flow: each pass pulls items toward the mean of their neighbors and solves the
 * ordered-with-minimum-gaps constraint exactly (pool adjacent violators on the shifted targets).
 */
function placeLayers(layers: Item[][], separation: (a: Item, b: Item) => number): void {
  const offsets = layers.map((layer) => {
    const out = [0];
    for (let i = 1; i < layer.length; i++) out.push(out[i - 1]! + separation(layer[i - 1]!, layer[i]!));
    return out;
  });
  layers.forEach((layer, l) => {
    layer.forEach((item, i) => {
      item.pos = offsets[l]![i]!;
    });
  });
  const pass = (l: number, use: 'up' | 'down' | 'both') => {
    const layer = layers[l]!;
    if (layer.length === 0) return;
    const desired: number[] = [];
    const weights: number[] = [];
    for (const item of layer) {
      const neighbors = use === 'up' ? item.up : use === 'down' ? item.down : [...item.up, ...item.down];
      if (neighbors.length === 0) {
        desired.push(item.pos);
        weights.push(0.05);
      } else {
        desired.push(neighbors.reduce((sum, n) => sum + n.pos, 0) / neighbors.length);
        weights.push(neighbors.length * (item.node ? 1 : 2));
      }
    }
    const solved = isotonic(
      desired.map((d, i) => d - offsets[l]![i]!),
      weights,
    );
    layer.forEach((item, i) => {
      item.pos = solved[i]! + offsets[l]![i]!;
    });
  };
  for (let iteration = 0; iteration < PLACEMENT_ITERATIONS; iteration++) {
    if (iteration % 2 === 0) for (let l = 1; l < layers.length; l++) pass(l, 'up');
    else for (let l = layers.length - 2; l >= 0; l--) pass(l, 'down');
  }
  for (let l = 0; l < layers.length; l++) pass(l, 'both');
}

/** Weighted isotonic regression (non-decreasing) by pool adjacent violators. */
export function isotonic(targets: number[], weights: number[]): number[] {
  const blocks: { weight: number; sum: number; count: number }[] = [];
  targets.forEach((target, i) => {
    const weight = weights[i]!;
    blocks.push({ weight, sum: weight * target, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.weight <= last.sum / last.weight) break;
      prev.weight += last.weight;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const block of blocks) for (let i = 0; i < block.count; i++) out.push(block.sum / block.weight);
  return out;
}

/** Greedy interval coloring: returns how many tracks/rows were needed. */
function assignIntervals(
  intervals: { a: number; b: number; order: number }[],
  gap: number,
  assign: (index: number, slot: number) => void,
): number {
  const sorted = intervals
    .map((interval, index) => ({ ...interval, index }))
    .sort((x, y) => x.a - y.a || x.b - y.b || x.order - y.order);
  const ends: number[] = [];
  for (const interval of sorted) {
    let slot = ends.findIndex((end) => end + gap <= interval.a);
    if (slot < 0) {
      slot = ends.length;
      ends.push(interval.b);
    } else ends[slot] = interval.b;
    assign(interval.index, slot);
  }
  return ends.length;
}

/** Spreads the edge endpoints on each node side, sorted by where the edge goes next to avoid crossings. */
function assignPorts(routes: ChainRoute[]): void {
  const sides = new Map<string, { route: ChainRoute; end: 'src' | 'tgt'; key: number }[]>();
  for (const route of routes) {
    const nextFromSrc = route.inner[0]?.pos ?? route.tgt.pos;
    const nextFromTgt = route.inner[route.inner.length - 1]?.pos ?? route.src.pos;
    const srcKey = `${route.src.key}|${route.srcSide}`;
    const tgtKey = `${route.tgt.key}|${route.tgtSide}`;
    sides.set(srcKey, [...(sides.get(srcKey) ?? []), { route, end: 'src', key: nextFromSrc }]);
    sides.set(tgtKey, [...(sides.get(tgtKey) ?? []), { route, end: 'tgt', key: nextFromTgt }]);
  }
  for (const list of sides.values()) {
    list.sort(
      (a, b) =>
        a.key - b.key || a.route.order - b.route.order || (a.end === b.end ? 0 : a.end === 'src' ? -1 : 1),
    );
    const first = list[0]!;
    const item = first.end === 'src' ? first.route.src : first.route.tgt;
    const shape = item.node?.shape;
    const span = item.cross * (shape === 'diamond' || shape === 'ellipse' ? 0.36 : 0.6);
    list.forEach((entry, i) => {
      const offset = list.length === 1 ? 0 : -span / 2 + (span * i) / (list.length - 1);
      if (entry.end === 'src') entry.route.srcPort = item.pos + offset;
      else entry.route.tgtPort = item.pos + offset;
    });
  }
}
