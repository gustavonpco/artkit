import { assetRefSchema, itemIdSchema, linkSchema } from '@artkit-ai/core';
import { z } from 'zod';

/** Inline text with formatting. Adjacent runs with identical formatting are merged on write. */
export const runSchema = z
  .object({
    text: z.string().max(20_000).describe('Text. "\\n" is a line break inside the block.'),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional().describe('Inline code (monospace).'),
    link: linkSchema.optional(),
    superscript: z.boolean().optional(),
    subscript: z.boolean().optional(),
  })
  .strict();

export type Run = z.infer<typeof runSchema>;

export const runsSchema = z
  .array(runSchema)
  .max(2_000)
  .describe('Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].');

/** A table cell is a list of runs (an empty array is an empty cell). */
export const cellSchema = runsSchema.describe(
  'Cell content as runs, e.g. [{"text":"40"}]. [] is an empty cell.',
);
export type Cell = z.infer<typeof cellSchema>;

export const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export const COLUMN_ALIGNS = ['left', 'center', 'right'] as const;
export const CALLOUT_TONES = ['info', 'warning', 'success', 'danger'] as const;
export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list',
  'table',
  'callout',
  'quote',
  'code',
  'image',
  'divider',
  'pageBreak',
  'toc',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Id prefixes used when ids are generated (`h1`, `p3`, `l2`, `t1`…). */
export const ID_PREFIX: Record<BlockType, string> = {
  heading: 'h',
  paragraph: 'p',
  list: 'l',
  table: 't',
  callout: 'c',
  quote: 'q',
  code: 'code',
  image: 'img',
  divider: 'hr',
  pageBreak: 'pb',
  toc: 'toc',
};

// List items are spelled out per level (instead of a recursive schema) so the 3-level limit is part of
// the schema and the generated JSON Schema stays non-recursive for every provider.
const listItemLevel3Schema = z.object({ runs: runsSchema }).strict();
const listItemLevel2Schema = z
  .object({
    runs: runsSchema,
    children: z.array(listItemLevel3Schema).max(500).optional(),
    childrenOrdered: z.boolean().optional(),
  })
  .strict();
export const listItemSchema = z
  .object({
    runs: runsSchema,
    children: z
      .array(listItemLevel2Schema)
      .max(500)
      .optional()
      .describe('Nested items (up to 3 levels in total).'),
    childrenOrdered: z
      .boolean()
      .optional()
      .describe('Numbering of the nested items; defaults to the parent list.'),
  })
  .strict();

/** Structural type of a list item at any level. */
export interface ListItem {
  runs: Run[];
  children?: ListItem[];
  childrenOrdered?: boolean;
}

const idField = itemIdSchema;

export const headingSchema = z
  .object({
    id: idField,
    type: z.literal('heading'),
    level: z.number().int().min(1).max(4),
    runs: runsSchema,
  })
  .strict();
export const paragraphSchema = z
  .object({ id: idField, type: z.literal('paragraph'), runs: runsSchema, align: z.enum(ALIGNS).optional() })
  .strict();
export const listSchema = z
  .object({
    id: idField,
    type: z.literal('list'),
    ordered: z.boolean().optional(),
    start: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .optional()
      .describe('First number of an ordered list (default 1).'),
    items: z.array(listItemSchema).min(1).max(1_000),
  })
  .strict();
export const tableSchema = z
  .object({
    id: idField,
    type: z.literal('table'),
    header: z.array(cellSchema).min(1).max(50).describe('Header cells; defines the column count.'),
    rows: z
      .array(z.array(cellSchema).max(50))
      .max(10_000)
      .describe('Body rows; each with exactly as many cells as the header.'),
    align: z
      .array(z.enum(COLUMN_ALIGNS))
      .max(50)
      .optional()
      .describe('Per-column alignment (same length as header).'),
    widths: z
      .array(z.number().positive().max(1_000))
      .max(50)
      .optional()
      .describe('Relative column widths (proportions, same length as header), e.g. [3,1,1].'),
    footer: z.array(cellSchema).max(50).optional().describe('Footer/total row (same length as header).'),
    caption: z.string().max(500).optional(),
  })
  .strict();
export const calloutSchema = z
  .object({
    id: idField,
    type: z.literal('callout'),
    tone: z.enum(CALLOUT_TONES),
    title: z.string().max(300).optional(),
    runs: runsSchema,
  })
  .strict();
export const quoteSchema = z
  .object({
    id: idField,
    type: z.literal('quote'),
    runs: runsSchema,
    attribution: z.string().max(300).optional(),
  })
  .strict();
export const codeSchema = z
  .object({
    id: idField,
    type: z.literal('code'),
    language: z
      .string()
      .max(40)
      .regex(/^[A-Za-z0-9_+#.-]*$/, 'Use a short language name like "ts", "json" or "sql".')
      .optional(),
    text: z.string().max(100_000),
  })
  .strict();
export const imageSchema = z
  .object({
    id: idField,
    type: z.literal('image'),
    asset: assetRefSchema,
    alt: z.string().min(1).max(500).describe('Required alternative text describing the image.'),
    caption: z.string().max(500).optional(),
    width: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .describe('Width as a fraction of the text width (0.1 to 1).'),
  })
  .strict();
export const dividerSchema = z.object({ id: idField, type: z.literal('divider') }).strict();
export const pageBreakSchema = z.object({ id: idField, type: z.literal('pageBreak') }).strict();
export const tocSchema = z
  .object({
    id: idField,
    type: z.literal('toc'),
    maxLevel: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe('Deepest heading level listed (1 to 4, default 3).'),
    title: z.string().max(200).optional(),
  })
  .strict();

export const blockSchema = z.discriminatedUnion('type', [
  headingSchema,
  paragraphSchema,
  listSchema,
  tableSchema,
  calloutSchema,
  quoteSchema,
  codeSchema,
  imageSchema,
  dividerSchema,
  pageBreakSchema,
  tocSchema,
]);

export type HeadingBlock = z.infer<typeof headingSchema>;
export type ParagraphBlock = z.infer<typeof paragraphSchema>;
export type ListBlock = Omit<z.infer<typeof listSchema>, 'items'> & { items: ListItem[] };
export type TableBlock = z.infer<typeof tableSchema>;
export type CalloutBlock = z.infer<typeof calloutSchema>;
export type QuoteBlock = z.infer<typeof quoteSchema>;
export type CodeBlock = z.infer<typeof codeSchema>;
export type ImageBlock = z.infer<typeof imageSchema>;
export type DividerBlock = z.infer<typeof dividerSchema>;
export type PageBreakBlock = z.infer<typeof pageBreakSchema>;
export type TocBlock = z.infer<typeof tocSchema>;
export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | CalloutBlock
  | QuoteBlock
  | CodeBlock
  | ImageBlock
  | DividerBlock
  | PageBreakBlock
  | TocBlock;

/** A block whose id may be omitted (it is generated). */
export type BlockInput = Block extends infer B
  ? B extends { id: string }
    ? Omit<B, 'id'> & { id?: string }
    : never
  : never;

/** Same union with optional ids, used by operations that create blocks. */
export const blockInputSchema = z.discriminatedUnion('type', [
  headingSchema.extend({ id: idField.optional() }),
  paragraphSchema.extend({ id: idField.optional() }),
  listSchema.extend({ id: idField.optional() }),
  tableSchema.extend({ id: idField.optional() }),
  calloutSchema.extend({ id: idField.optional() }),
  quoteSchema.extend({ id: idField.optional() }),
  codeSchema.extend({ id: idField.optional() }),
  imageSchema.extend({ id: idField.optional() }),
  dividerSchema.extend({ id: idField.optional() }),
  pageBreakSchema.extend({ id: idField.optional() }),
  tocSchema.extend({ id: idField.optional() }),
]);

export const coverFieldSchema = z
  .object({ label: z.string().min(1).max(80), value: z.string().max(300) })
  .strict();

export const coverSchema = z
  .object({
    eyebrow: z
      .string()
      .max(120)
      .optional()
      .describe('Small line above the title, e.g. "Technical proposal".'),
    title: z.string().min(1).max(200),
    subtitle: z.string().max(300).optional(),
    fields: z
      .array(coverFieldSchema)
      .max(8)
      .optional()
      .describe('Up to 8 label/value pairs (client, date, version…).'),
  })
  .strict();
export type Cover = z.infer<typeof coverSchema>;

const marginSchema = z.number().min(0).max(100);
export const pageSchema = z
  .object({
    size: z.enum(['A4', 'Letter']).optional(),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    margins: z
      .object({
        top: marginSchema.optional(),
        right: marginSchema.optional(),
        bottom: marginSchema.optional(),
        left: marginSchema.optional(),
      })
      .strict()
      .optional()
      .describe('Margins in millimeters (default 25 top/bottom, 20 left/right).'),
    header: z.string().max(200).optional().describe('Text repeated at the top of every page.'),
    footer: z.string().max(200).optional().describe('Text repeated at the bottom of every page.'),
    pageNumbers: z.boolean().optional(),
  })
  .strict();
export type PageSetup = z.infer<typeof pageSchema>;

export const documentContentSchema = z
  .object({
    cover: coverSchema.optional(),
    page: pageSchema.optional(),
    blocks: z.array(blockSchema),
  })
  .strict();

export interface DocumentContent {
  cover?: Cover;
  page?: PageSetup;
  blocks: Block[];
}

export const DEFAULT_MARGINS_MM = { top: 25, right: 20, bottom: 25, left: 20 } as const;
export const PAGE_SIZES_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
} as const;

/** Resolved page geometry in millimeters. */
export function pageGeometry(page: PageSetup | undefined): {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
} {
  const size = PAGE_SIZES_MM[page?.size ?? 'A4'];
  const landscape = page?.orientation === 'landscape';
  return {
    width: landscape ? size.height : size.width,
    height: landscape ? size.width : size.height,
    margins: { ...DEFAULT_MARGINS_MM, ...stripUndefined(page?.margins ?? {}) },
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
