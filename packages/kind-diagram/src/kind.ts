import { type ArtifactKind, defineKind, type ErrorIssue, type IdContext } from '@artkit/core';
import { z } from 'zod';
import { diffDiagram } from './diff.js';
import { diagramInstructions, MERMAID_INPUT_DESCRIPTION } from './instructions.js';
import { lintDiagram } from './lint.js';
import { mermaidToContent } from './mermaid.js';
import {
  applyDiagramOperation,
  type DiagramOperation,
  diagramOperationSchema,
  diagramOperationTargets,
} from './operations.js';
import { parsePartialDiagram } from './partial.js';
import { projectDiagram } from './projection.js';
import { DIAGRAM_LIMITS, type DiagramContent, diagramContentSchema, emptyDiagram } from './schema.js';

const PREFIXES = { groups: 'g', nodes: 'n', edges: 'e' } as const;

/** Fills missing ids (ids are optional on creation, spec §6.2). Never throws; validation runs afterwards. */
export function normalizeDiagram(raw: unknown, ctx: IdContext): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  for (const [key, prefix] of Object.entries(PREFIXES)) {
    const list = value[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        (item as { id?: unknown }).id === undefined
      ) {
        (item as { id: string }).id = ctx.nextId(prefix);
      }
    }
  }
  return raw;
}

/** Integrity rules a schema cannot express: references and unique ids, with exact paths. */
export function validateDiagram(content: DiagramContent): ErrorIssue[] {
  const issues: ErrorIssue[] = [];
  const nodeIds = new Set(content.nodes.map((node) => node.id));
  const groupIds = new Set(content.groups.map((group) => group.id));
  const seen = new Map<string, string>();
  const checkUnique = (id: string, path: string) => {
    const first = seen.get(id);
    if (first !== undefined) {
      issues.push({
        path,
        message: `Id "${id}" is already used at ${first}.`,
        hint: 'Ids must be unique across nodes, edges and groups; rename one of them.',
      });
    } else seen.set(id, path);
  };
  content.groups.forEach((group, i) => {
    checkUnique(group.id, `groups[${i}].id`);
  });
  content.nodes.forEach((node, i) => {
    checkUnique(node.id, `nodes[${i}].id`);
    if (node.group !== undefined && !groupIds.has(node.group)) {
      issues.push({
        path: `nodes[${i}].group`,
        message: `Group "${node.group}" does not exist.`,
        hint: `Add a group with id "${node.group}" or remove the node's group.`,
      });
    }
  });
  content.edges.forEach((edge, i) => {
    checkUnique(edge.id, `edges[${i}].id`);
    for (const end of ['from', 'to'] as const) {
      if (!nodeIds.has(edge[end])) {
        issues.push({
          path: `edges[${i}].${end}`,
          message: `Node "${edge[end]}" does not exist.`,
          hint: 'Edges must connect existing node ids; add the node first.',
        });
      }
    }
  });
  return issues;
}

export const diagramKind: ArtifactKind<DiagramContent, DiagramOperation> = defineKind<
  DiagramContent,
  DiagramOperation
>({
  kind: 'diagram',
  version: 1,
  label: 'Diagram',
  contentSchema: diagramContentSchema,
  operationSchema: diagramOperationSchema,
  empty: emptyDiagram,
  normalize: normalizeDiagram,
  apply: applyDiagramOperation,
  ids: (content) => [
    ...content.groups.map((group) => group.id),
    ...content.nodes.map((node) => node.id),
    ...content.edges.map((edge) => edge.id),
  ],
  validate: validateDiagram,
  measure: (content) => ({
    nodes: content.nodes.length,
    edges: content.edges.length,
    groups: content.groups.length,
  }),
  targets: diagramOperationTargets,
  project: projectDiagram,
  lint: lintDiagram,
  diff: diffDiagram,
  parsePartial: parsePartialDiagram,
  inputs: {
    mermaid: {
      description: MERMAID_INPUT_DESCRIPTION,
      schema: z.string().min(1).max(200_000),
      toContent: (input, ctx) => mermaidToContent(String(input), ctx.locale, ctx.note),
    },
  },
  migrations: [],
  limits: { ...DIAGRAM_LIMITS },
  instructions: diagramInstructions,
});
