import { type ApplyContext, colorTokenSchema, itemIdSchema } from '@artkit/core';
import { z } from 'zod';
import {
  type DiagramContent,
  type DiagramGroup,
  type DiagramNode,
  directionSchema,
  edgeArrowSchema,
  edgeLabelSchema,
  edgeStyleSchema,
  groupKindSchema,
  groupLabelSchema,
  iconSchema,
  layoutSchema,
  nodeLabelSchema,
  positionSchema,
  shapeSchema,
} from './schema.js';
import { msg } from './text.js';

const optionalId = itemIdSchema.optional().describe('Optional explicit id; generated when omitted.');

export const diagramOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_node'),
      id: optionalId,
      label: nodeLabelSchema,
      shape: shapeSchema.optional(),
      tone: colorTokenSchema.optional(),
      group: itemIdSchema.optional(),
      icon: iconSchema.optional(),
      position: positionSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('update_node'),
      id: itemIdSchema,
      label: nodeLabelSchema.optional(),
      shape: shapeSchema.optional(),
      tone: colorTokenSchema.nullable().optional().describe('null removes the tone.'),
      group: itemIdSchema.nullable().optional().describe('null removes the node from its group.'),
      icon: iconSchema.nullable().optional().describe('null removes the icon.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('remove_node'),
      id: itemIdSchema.describe('Also removes every edge connected to the node.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_edge'),
      id: optionalId,
      from: itemIdSchema,
      to: itemIdSchema,
      label: edgeLabelSchema.optional(),
      style: edgeStyleSchema.optional(),
      arrow: edgeArrowSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('update_edge'),
      id: itemIdSchema,
      from: itemIdSchema.optional(),
      to: itemIdSchema.optional(),
      label: edgeLabelSchema.nullable().optional().describe('null removes the label.'),
      style: edgeStyleSchema.optional(),
      arrow: edgeArrowSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove_edge'), id: itemIdSchema }).strict(),
  z
    .object({
      op: z.literal('add_group'),
      id: optionalId,
      label: groupLabelSchema,
      kind: groupKindSchema.optional(),
      nodes: z.array(itemIdSchema).max(300).optional().describe('Node ids to move into the new group.'),
      after: itemIdSchema
        .optional()
        .describe('Insert after this group (bands are stacked in group order). Default: last.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('update_group'),
      id: itemIdSchema,
      label: groupLabelSchema.optional(),
      kind: groupKindSchema.optional(),
      after: itemIdSchema
        .nullable()
        .optional()
        .describe('Move after this group; null moves it to the first position.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('remove_group'),
      id: itemIdSchema.describe('Member nodes are kept and become ungrouped.'),
    })
    .strict(),
  z.object({ op: z.literal('set_direction'), direction: directionSchema }).strict(),
  z.object({ op: z.literal('set_layout'), layout: layoutSchema }).strict(),
  z
    .object({
      op: z.literal('pin_node'),
      id: itemIdSchema,
      position: positionSchema,
    })
    .strict()
    .describe('Pins the node at a top-left position and switches the diagram to layout "manual".'),
  z.object({ op: z.literal('unpin_node'), id: itemIdSchema }).strict(),
]);

export type DiagramOperation = z.infer<typeof diagramOperationSchema>;

function findNode(draft: DiagramContent, id: string, ctx: ApplyContext, path = 'id'): DiagramNode {
  const node = draft.nodes.find((item) => item.id === id);
  if (!node) {
    const available =
      draft.nodes
        .slice(0, 20)
        .map((item) => item.id)
        .join(', ') || '-';
    ctx.fail(msg(ctx.locale, `Node "${id}" does not exist.`, `O nó "${id}" não existe.`), {
      path,
      hint: msg(
        ctx.locale,
        `Use an existing node id: ${available}.`,
        `Use o id de um nó existente: ${available}.`,
      ),
    });
  }
  return node;
}

function findGroupIndex(draft: DiagramContent, id: string, ctx: ApplyContext, path = 'id'): number {
  const index = draft.groups.findIndex((item) => item.id === id);
  if (index < 0) {
    const available = draft.groups.map((item) => item.id).join(', ') || '-';
    ctx.fail(msg(ctx.locale, `Group "${id}" does not exist.`, `O grupo "${id}" não existe.`), {
      path,
      hint: msg(
        ctx.locale,
        `Use an existing group id (${available}) or create it first with add_group.`,
        `Use o id de um grupo existente (${available}) ou crie-o antes com add_group.`,
      ),
    });
  }
  return index;
}

function findEdgeIndex(draft: DiagramContent, id: string, ctx: ApplyContext): number {
  const index = draft.edges.findIndex((item) => item.id === id);
  if (index < 0) {
    ctx.fail(msg(ctx.locale, `Edge "${id}" does not exist.`, `A aresta "${id}" não existe.`), {
      path: 'id',
      hint: msg(
        ctx.locale,
        'Read the diagram to get the edge ids (aresta/edge lines).',
        'Leia o diagrama para obter os ids das arestas.',
      ),
    });
  }
  return index;
}

function claimId(id: string | undefined, prefix: string, ctx: ApplyContext): string {
  if (id !== undefined) {
    if (ctx.hasId(id)) {
      ctx.fail(
        msg(
          ctx.locale,
          `Id "${id}" is already used in this diagram.`,
          `O id "${id}" já é usado neste diagrama.`,
        ),
        {
          path: 'id',
          hint: msg(
            ctx.locale,
            'Choose another id or omit it to get a generated one.',
            'Escolha outro id ou omita-o para gerar um.',
          ),
        },
      );
    }
    ctx.reserveId(id);
    return id;
  }
  return ctx.nextId(prefix);
}

function insertGroup(
  draft: DiagramContent,
  group: DiagramGroup,
  after: string | null | undefined,
  ctx: ApplyContext,
): void {
  if (after === undefined) draft.groups.push(group);
  else if (after === null) draft.groups.unshift(group);
  else {
    const index = findGroupIndex(draft, after, ctx, 'after');
    draft.groups.splice(index + 1, 0, group);
  }
}

/** Applies one operation to a draft (already a clone). Pure and deterministic. */
export function applyDiagramOperation(draft: DiagramContent, op: DiagramOperation, ctx: ApplyContext): void {
  switch (op.op) {
    case 'add_node': {
      if (op.group !== undefined) findGroupIndex(draft, op.group, ctx, 'group');
      const id = claimId(op.id, 'n', ctx);
      const node: DiagramNode = { id, label: op.label, shape: op.shape ?? 'box' };
      if (op.tone !== undefined) node.tone = op.tone;
      if (op.group !== undefined) node.group = op.group;
      if (op.icon !== undefined) node.icon = op.icon;
      if (op.position !== undefined) node.position = { ...op.position };
      draft.nodes.push(node);
      break;
    }
    case 'update_node': {
      const node = findNode(draft, op.id, ctx);
      if (op.label !== undefined) node.label = op.label;
      if (op.shape !== undefined) node.shape = op.shape;
      if (op.tone === null) delete node.tone;
      else if (op.tone !== undefined) node.tone = op.tone;
      if (op.icon === null) delete node.icon;
      else if (op.icon !== undefined) node.icon = op.icon;
      if (op.group === null) delete node.group;
      else if (op.group !== undefined) {
        findGroupIndex(draft, op.group, ctx, 'group');
        node.group = op.group;
      }
      break;
    }
    case 'remove_node': {
      findNode(draft, op.id, ctx);
      draft.nodes = draft.nodes.filter((node) => node.id !== op.id);
      draft.edges = draft.edges.filter((edge) => edge.from !== op.id && edge.to !== op.id);
      break;
    }
    case 'add_edge': {
      findNode(draft, op.from, ctx, 'from');
      findNode(draft, op.to, ctx, 'to');
      const id = claimId(op.id, 'e', ctx);
      draft.edges.push({
        id,
        from: op.from,
        to: op.to,
        ...(op.label !== undefined ? { label: op.label } : {}),
        style: op.style ?? 'solid',
        arrow: op.arrow ?? 'end',
      });
      break;
    }
    case 'update_edge': {
      const edge = draft.edges[findEdgeIndex(draft, op.id, ctx)]!;
      if (op.from !== undefined) edge.from = findNode(draft, op.from, ctx, 'from').id;
      if (op.to !== undefined) edge.to = findNode(draft, op.to, ctx, 'to').id;
      if (op.label === null) delete edge.label;
      else if (op.label !== undefined) edge.label = op.label;
      if (op.style !== undefined) edge.style = op.style;
      if (op.arrow !== undefined) edge.arrow = op.arrow;
      break;
    }
    case 'remove_edge':
      draft.edges.splice(findEdgeIndex(draft, op.id, ctx), 1);
      break;
    case 'add_group': {
      const members = (op.nodes ?? []).map((nodeId, index) =>
        findNode(draft, nodeId, ctx, `nodes[${index}]`),
      );
      const id = claimId(op.id, 'g', ctx);
      insertGroup(draft, { id, label: op.label, kind: op.kind ?? 'box' }, op.after, ctx);
      for (const node of members) node.group = id;
      break;
    }
    case 'update_group': {
      const index = findGroupIndex(draft, op.id, ctx);
      const group = draft.groups[index]!;
      if (op.label !== undefined) group.label = op.label;
      if (op.kind !== undefined) group.kind = op.kind;
      if (op.after !== undefined) {
        if (op.after === op.id) {
          ctx.fail(
            msg(
              ctx.locale,
              'A group cannot be moved after itself.',
              'Um grupo não pode ser movido para depois de si mesmo.',
            ),
            {
              path: 'after',
            },
          );
        }
        draft.groups.splice(index, 1);
        insertGroup(draft, group, op.after, ctx);
      }
      break;
    }
    case 'remove_group': {
      const index = findGroupIndex(draft, op.id, ctx);
      draft.groups.splice(index, 1);
      for (const node of draft.nodes) if (node.group === op.id) delete node.group;
      break;
    }
    case 'set_direction':
      draft.direction = op.direction;
      break;
    case 'set_layout':
      draft.layout = op.layout;
      break;
    case 'pin_node': {
      const node = findNode(draft, op.id, ctx);
      node.position = { x: op.position.x, y: op.position.y };
      // Pins are only honored by the manual layout, so pinning implies it.
      draft.layout = 'manual';
      break;
    }
    case 'unpin_node':
      delete findNode(draft, op.id, ctx).position;
      break;
  }
}

/** Item targets touched by an operation (spec §8.3), in the same vocabulary as `diff`. */
export function diagramOperationTargets(op: DiagramOperation): string[] {
  switch (op.op) {
    case 'add_node':
      return [`node:${op.id ?? '+'}`, ...(op.group ? [`group:${op.group}`] : [])];
    case 'update_node':
      return [`node:${op.id}`, ...(typeof op.group === 'string' ? [`group:${op.group}`] : [])];
    case 'remove_node':
    case 'pin_node':
    case 'unpin_node':
      return [`node:${op.id}`];
    case 'add_edge':
      return [`edge:${op.id ?? '+'}`, `node:${op.from}`, `node:${op.to}`];
    case 'update_edge':
      return [`edge:${op.id}`, ...(op.from ? [`node:${op.from}`] : []), ...(op.to ? [`node:${op.to}`] : [])];
    case 'remove_edge':
      return [`edge:${op.id}`];
    case 'add_group':
      return [`group:${op.id ?? '+'}`, ...(op.nodes ?? []).map((id) => `node:${id}`)];
    case 'update_group':
      return [`group:${op.id}`];
    case 'remove_group':
      return [`group:${op.id}`];
    case 'set_direction':
      return ['diagram:direction'];
    case 'set_layout':
      return ['diagram:layout'];
  }
}
