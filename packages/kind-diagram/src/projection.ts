import { type Projection, type ProjectionItem, type ProjectionOptions, paginate } from '@artkit/core';
import type { DiagramContent, DiagramEdge, DiagramNode } from './schema.js';
import { isPt, quote } from './text.js';

interface Words {
  direction: string;
  group: string;
  edge: string;
  ungrouped: string;
  empty: string;
  counts(nodes: number, edges: number, groups: number): string;
  noMatch(range: string, available: string): string;
}

const EN: Words = {
  direction: 'direction',
  group: 'group',
  edge: 'edge',
  ungrouped: 'ungrouped',
  empty: '(empty)',
  counts: (n, e, g) => `${n} nodes, ${e} edges, ${g} groups`,
  noMatch: (range, available) => `No group matches range "${range}". Groups: ${available}.`,
};

const PT: Words = {
  direction: 'direção',
  group: 'grupo',
  edge: 'aresta',
  ungrouped: 'sem grupo',
  empty: '(vazio)',
  counts: (n, e, g) => `${n} nós, ${e} arestas, ${g} grupos`,
  noMatch: (range, available) => `Nenhum grupo corresponde ao intervalo "${range}". Grupos: ${available}.`,
};

/** `web(box, tone=accent, icon=web, x=120, y=40) "Portal web"`. */
export function nodeToken(node: DiagramNode): string {
  const attrs: string[] = [node.shape];
  if (node.tone) attrs.push(`tone=${node.tone}`);
  if (node.icon) attrs.push(`icon=${node.icon}`);
  if (node.position) attrs.push(`x=${node.position.x}`, `y=${node.position.y}`);
  return `${node.id}(${attrs.join(', ')}) ${quote(node.label)}`;
}

const ARROWS = { end: '->', both: '<->', none: '--' } as const;

/** `aresta e1: web -> api "HTTPS" (dashed)`. */
export function edgeLine(edge: DiagramEdge, words: { edge: string }): string {
  const label = edge.label ? ` ${quote(edge.label)}` : '';
  const style = edge.style === 'dashed' ? ' (dashed)' : '';
  return `${words.edge} ${edge.id}: ${edge.from} ${ARROWS[edge.arrow]} ${edge.to}${label}${style}`;
}

/**
 * Text projection (spec §9.3): one line per group with its nodes, one line for ungrouped nodes, one line per
 * edge. Keywords follow the locale (`direção`/`direction`, `grupo`/`group`, `aresta`/`edge`).
 * Outline: counts plus group and node ids. Range: comma-separated group ids, with the edges touching them.
 */
export function projectDiagram(content: DiagramContent, options: ProjectionOptions): Projection {
  const words = isPt(options.locale) ? PT : EN;
  const header = `${words.direction}: ${content.direction}\nlayout: ${content.layout}`;
  const byGroup = new Map<string, DiagramNode[]>(content.groups.map((group) => [group.id, []]));
  const ungrouped: DiagramNode[] = [];
  for (const node of content.nodes) {
    const list = node.group === undefined ? undefined : byGroup.get(node.group);
    if (list) list.push(node);
    else ungrouped.push(node);
  }

  const groupItems: ProjectionItem[] = content.groups.map((group) => {
    const members = byGroup.get(group.id)!;
    const head = `${words.group} ${group.id} ${quote(group.label)} [${group.kind}]`;
    return {
      id: group.id,
      text: `${head}: ${members.length > 0 ? members.map(nodeToken).join(', ') : words.empty}`,
      outline: `${head}: ${members.length > 0 ? members.map((node) => node.id).join(', ') : words.empty}`,
    };
  });
  const looseItem: ProjectionItem[] =
    ungrouped.length > 0
      ? [
          {
            id: '~ungrouped',
            text: `${words.ungrouped}: ${ungrouped.map(nodeToken).join(', ')}`,
            outline: `${words.ungrouped}: ${ungrouped.map((node) => node.id).join(', ')}`,
          },
        ]
      : [];
  const edgeItems = (edges: DiagramEdge[]): ProjectionItem[] =>
    edges.map((edge) => ({
      id: edge.id,
      text: edgeLine(edge, words),
      outline: `${words.edge} ${edge.id}: ${edge.from} ${ARROWS[edge.arrow]} ${edge.to}`,
    }));

  const budget = {
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.charsPerToken === undefined ? {} : { charsPerToken: options.charsPerToken }),
  };

  if (options.mode === 'outline') {
    const counts = words.counts(content.nodes.length, content.edges.length, content.groups.length);
    return paginate([...groupItems, ...looseItem], {
      ...budget,
      header: `${header}\n${counts}`,
      outlineOnly: true,
    });
  }

  if (options.mode === 'range') {
    const wanted = (options.range ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const selected = groupItems.filter((item) => wanted.includes(item.id));
    if (selected.length === 0) {
      const available = content.groups.map((group) => group.id).join(', ') || '-';
      return { text: `${header}\n${words.noMatch(options.range ?? '', available)}`, truncated: false };
    }
    const members = new Set(
      content.nodes
        .filter((node) => node.group !== undefined && wanted.includes(node.group))
        .map((node) => node.id),
    );
    const touching = content.edges.filter((edge) => members.has(edge.from) || members.has(edge.to));
    return paginate([...selected, ...edgeItems(touching)], { ...budget, header });
  }

  if (content.nodes.length === 0 && content.groups.length === 0) {
    return { text: `${header}\n${words.empty}`, truncated: false };
  }
  return paginate([...groupItems, ...looseItem, ...edgeItems(content.edges)], { ...budget, header });
}
