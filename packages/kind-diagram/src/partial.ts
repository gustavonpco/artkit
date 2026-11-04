import { IdAllocator } from '@artkit-ai/core';
import {
  type DiagramContent,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  directionSchema,
  edgeSchema,
  groupSchema,
  layoutSchema,
  nodeSchema,
} from './schema.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function explicitIds(list: unknown): string[] {
  return Array.isArray(list)
    ? list
        .filter(isRecord)
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string')
    : [];
}

/**
 * Best-effort preview while the model streams JSON (already parsed by a partial JSON parser): keeps every item
 * that is valid on its own, gives missing ids temporary deterministic values, drops edges whose endpoints are
 * not there yet and group references to groups that are not there yet.
 */
export function parsePartialDiagram(raw: unknown): DiagramContent | undefined {
  if (!isRecord(raw)) return undefined;
  const direction = directionSchema.safeParse(raw.direction);
  const layout = layoutSchema.safeParse(raw.layout);
  const allocator = new IdAllocator([
    ...explicitIds(raw.groups),
    ...explicitIds(raw.nodes),
    ...explicitIds(raw.edges),
  ]);
  const seen = new Set<string>();

  const collect = <T extends { id: string }>(
    list: unknown,
    prefix: string,
    parse: (value: unknown) => T | undefined,
  ): T[] => {
    if (!Array.isArray(list)) return [];
    const out: T[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const candidate = typeof item.id === 'string' ? item : { ...item, id: allocator.next(prefix) };
      const parsed = parse(candidate);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(parsed);
    }
    return out;
  };

  const groups = collect<DiagramGroup>(raw.groups, 'g', (value) => {
    const result = groupSchema.safeParse(value);
    return result.success ? result.data : undefined;
  });
  const groupIds = new Set(groups.map((group) => group.id));
  const nodes = collect<DiagramNode>(raw.nodes, 'n', (value) => {
    const result = nodeSchema.safeParse(value);
    if (!result.success) return undefined;
    const node = result.data;
    if (node.group !== undefined && !groupIds.has(node.group)) delete node.group;
    return node;
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = collect<DiagramEdge>(raw.edges, 'e', (value) => {
    const result = edgeSchema.safeParse(value);
    return result.success && nodeIds.has(result.data.from) && nodeIds.has(result.data.to)
      ? result.data
      : undefined;
  });
  return {
    direction: direction.success ? direction.data : 'TB',
    layout: layout.success ? layout.data : 'auto',
    nodes,
    edges,
    groups,
  };
}
