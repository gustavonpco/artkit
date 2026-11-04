import { colorTokenSchema, itemIdSchema } from '@artkit/core';
import { z } from 'zod';

export const DIRECTIONS = ['TB', 'LR'] as const;
export const LAYOUTS = ['auto', 'bands', 'manual'] as const;
export const NODE_SHAPES = ['box', 'round', 'diamond', 'ellipse', 'cylinder', 'document', 'actor'] as const;
export const EDGE_STYLES = ['solid', 'dashed'] as const;
export const EDGE_ARROWS = ['end', 'both', 'none'] as const;
export const GROUP_KINDS = ['band', 'box'] as const;
/** Closed icon set; path data lives in `icons.ts`. */
export const NODE_ICONS = [
  'database',
  'server',
  'user',
  'cloud',
  'queue',
  'api',
  'mobile',
  'web',
  'lock',
  'file',
  'mail',
  'settings',
  'search',
  'chart',
  'bot',
  'shield',
] as const;

export const NODE_LABEL_MAX = 60;
export const EDGE_LABEL_MAX = 40;
export const GROUP_LABEL_MAX = 60;
/** Pinned coordinates are bounded so a bad value can't blow up the canvas or the exported SVG. */
export const POSITION_MAX = 100_000;

export type Direction = (typeof DIRECTIONS)[number];
export type DiagramLayoutMode = (typeof LAYOUTS)[number];
export type NodeShape = (typeof NODE_SHAPES)[number];
export type EdgeStyle = (typeof EDGE_STYLES)[number];
export type EdgeArrow = (typeof EDGE_ARROWS)[number];
export type GroupKind = (typeof GROUP_KINDS)[number];
export type NodeIcon = (typeof NODE_ICONS)[number];

export const directionSchema = z
  .enum(DIRECTIONS)
  .describe('Main flow direction: TB (top to bottom) or LR (left to right).');
export const layoutSchema = z
  .enum(LAYOUTS)
  .describe(
    'auto: automatic (bands when there are band groups, otherwise dagre); bands: groups as layers/lanes; manual: pinned positions are kept.',
  );
export const shapeSchema = z
  .enum(NODE_SHAPES)
  .describe('Node shape. Use cylinder for databases, actor for people, diamond for decisions.');
export const iconSchema = z.enum(NODE_ICONS).describe(`Optional icon: ${NODE_ICONS.join(', ')}.`);
export const edgeStyleSchema = z.enum(EDGE_STYLES);
export const edgeArrowSchema = z.enum(EDGE_ARROWS);
export const groupKindSchema = z
  .enum(GROUP_KINDS)
  .describe('band: a layer (TB) or lane (LR); box: a plain enclosing box.');

const coordinate = z.number().min(-POSITION_MAX).max(POSITION_MAX);
export const positionSchema = z
  .object({ x: coordinate, y: coordinate })
  .strict()
  .describe('Pinned top-left position in diagram units. Only honored with layout "manual".');

export const nodeLabelSchema = z.string().min(1).max(NODE_LABEL_MAX);
export const edgeLabelSchema = z.string().min(1).max(EDGE_LABEL_MAX);
export const groupLabelSchema = z.string().min(1).max(GROUP_LABEL_MAX);

export const nodeSchema = z
  .object({
    id: itemIdSchema,
    label: nodeLabelSchema.describe(`Short label, at most ${NODE_LABEL_MAX} characters.`),
    shape: shapeSchema.default('box'),
    tone: colorTokenSchema.optional().describe('Theme color token used to tint the node.'),
    group: itemIdSchema.optional().describe('Id of the group (layer, lane or box) the node belongs to.'),
    icon: iconSchema.optional(),
    position: positionSchema.optional(),
  })
  .strict();

export const edgeSchema = z
  .object({
    id: itemIdSchema,
    from: itemIdSchema.describe('Source node id.'),
    to: itemIdSchema.describe('Target node id.'),
    label: edgeLabelSchema.optional().describe(`Optional label, at most ${EDGE_LABEL_MAX} characters.`),
    style: edgeStyleSchema.default('solid'),
    arrow: edgeArrowSchema.default('end'),
  })
  .strict();

export const groupSchema = z
  .object({
    id: itemIdSchema,
    label: groupLabelSchema,
    kind: groupKindSchema.default('box'),
  })
  .strict();

export const diagramContentSchema = z
  .object({
    direction: directionSchema.default('TB'),
    layout: layoutSchema.default('auto'),
    nodes: z.array(nodeSchema).default([]),
    edges: z.array(edgeSchema).default([]),
    groups: z.array(groupSchema).default([]).describe('Ordered: bands are stacked in this order.'),
  })
  .strict();

export type DiagramNode = z.infer<typeof nodeSchema>;
export type DiagramEdge = z.infer<typeof edgeSchema>;
export type DiagramGroup = z.infer<typeof groupSchema>;
export type DiagramContent = z.infer<typeof diagramContentSchema>;
export type NodePosition = z.infer<typeof positionSchema>;

export const DIAGRAM_LIMITS = { nodes: 300, edges: 600, groups: 30 } as const;

export function emptyDiagram(): DiagramContent {
  return { direction: 'TB', layout: 'auto', nodes: [], edges: [], groups: [] };
}
