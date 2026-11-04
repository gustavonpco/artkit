import { type ChangeSummary, deepEqual, diffCollection, diffFields } from '@artkit/core';
import type { DiagramContent, DiagramEdge, DiagramGroup, DiagramNode } from './schema.js';

const isPt = (locale?: string) => locale?.toLowerCase().startsWith('pt') ?? false;
const show = (value: unknown, locale?: string) =>
  value === undefined ? (isPt(locale) ? 'nenhum' : 'none') : `'${String(value)}'`;
const to = (locale?: string) => (isPt(locale) ? 'para' : 'to');

function describeNode(before: DiagramNode, after: DiagramNode, locale?: string): string {
  const parts: string[] = [];
  for (const field of ['label', 'shape', 'tone', 'icon', 'group'] as const) {
    if (before[field] !== after[field])
      parts.push(`${field} ${show(before[field], locale)} ${to(locale)} ${show(after[field], locale)}`);
  }
  if (!deepEqual(before.position, after.position)) {
    if (!after.position) parts.push(isPt(locale) ? 'desafixado' : 'unpinned');
    else parts.push(`${isPt(locale) ? 'fixado em' : 'pinned at'} ${after.position.x},${after.position.y}`);
  }
  return `${after.id}: ${parts.join('; ')}.`;
}

function describeEdge(before: DiagramEdge, after: DiagramEdge, locale?: string): string {
  const parts: string[] = [];
  for (const field of ['from', 'to', 'label', 'style', 'arrow'] as const) {
    if (before[field] !== after[field])
      parts.push(`${field} ${show(before[field], locale)} ${to(locale)} ${show(after[field], locale)}`);
  }
  return `${after.id}: ${parts.join('; ')}.`;
}

function describeGroup(before: DiagramGroup, after: DiagramGroup, locale?: string): string {
  const parts: string[] = [];
  for (const field of ['label', 'kind'] as const) {
    if (before[field] !== after[field])
      parts.push(`${field} ${show(before[field], locale)} ${to(locale)} ${show(after[field], locale)}`);
  }
  return `${after.id}: ${parts.join('; ')}.`;
}

/** Change summaries with targets `diagram:direction`, `diagram:layout`, `node:<id>`, `edge:<id>`, `group:<id>`. */
export function diffDiagram(before: DiagramContent, after: DiagramContent, locale?: string): ChangeSummary[] {
  return [
    ...diffFields('diagram', before, after, ['direction', 'layout'], locale),
    ...diffCollection(before.groups, after.groups, {
      prefix: 'group',
      id: (group) => group.id,
      label: (group) => `${group.id} "${group.label}"`,
      describeChange: (a, b) => describeGroup(a, b, locale),
      locale,
    }),
    ...diffCollection(before.nodes, after.nodes, {
      prefix: 'node',
      id: (node) => node.id,
      label: (node) => `${node.id} "${node.label}"`,
      describeChange: (a, b) => describeNode(a, b, locale),
      locale,
      ordered: false,
    }),
    ...diffCollection(before.edges, after.edges, {
      prefix: 'edge',
      id: (edge) => edge.id,
      label: (edge) => `${edge.id} (${edge.from} -> ${edge.to})`,
      describeChange: (a, b) => describeEdge(a, b, locale),
      locale,
      ordered: false,
    }),
  ];
}
