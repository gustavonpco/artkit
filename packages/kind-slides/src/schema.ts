import { assetRefSchema, colorSchema, itemIdSchema, linkSchema } from '@artkit-ai/core';
import { z } from 'zod';

/** Layout names: lowercase words joined by "-" (built-ins and application layouts). */
export const LAYOUT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
/** Slot names are part of slot targets (`slot:<slideId>.<slot>`), so they never contain ".". */
export const SLOT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const MAX_TEXT = 5000;

export const runSchema = z
  .object({
    text: z.string().max(MAX_TEXT),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    color: colorSchema.optional(),
    link: linkSchema.optional(),
  })
  .strict()
  .describe('Formatted text run.');

export type Run = z.infer<typeof runSchema>;

const paragraphObjectSchema = z
  .object({
    text: z.string().max(MAX_TEXT).optional(),
    runs: z.array(runSchema).min(1).max(100).optional(),
    list: z.enum(['bullet', 'number']).optional().describe('Render as a bullet or numbered list item.'),
    level: z.number().int().min(0).max(4).optional().describe('List indentation level (0 to 4).'),
  })
  .strict()
  .refine((p) => (p.text === undefined) !== (p.runs === undefined), {
    message: 'Use either "text" or "runs" in a paragraph, not both.',
  });

/** A paragraph: plain string, or an object with `text` or formatted `runs`, optionally as a list item. */
export const paragraphSchema = z
  .union([z.string().max(MAX_TEXT), paragraphObjectSchema])
  .describe('Paragraph: a string, or { text | runs, list?: "bullet"|"number", level?: 0-4 }.');

export type Paragraph = z.infer<typeof paragraphSchema>;

export const fontSizeSchema = z.number().min(8).max(96).describe('Font size in points (8 to 96).');
export const fontRoleSchema = z.enum(['heading', 'body', 'mono']).describe('Theme font family.');
export const alignSchema = z.enum(['left', 'center', 'right', 'justify']);
export const valignSchema = z.enum(['top', 'middle', 'bottom']);

export type Align = z.infer<typeof alignSchema>;
export type VAlign = z.infer<typeof valignSchema>;
export type FontRole = z.infer<typeof fontRoleSchema>;

const textStyleShape = {
  fontSize: fontSizeSchema.optional(),
  font: fontRoleSchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: colorSchema.optional(),
  align: alignSchema.optional(),
  valign: valignSchema.optional(),
};

export const SHAPES = ['rect', 'roundRect', 'ellipse', 'line', 'arrow'] as const;
export const CHART_TYPES = ['bar', 'column', 'line', 'pie', 'stackedBar'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const lineStyleSchema = z
  .object({
    color: colorSchema.optional(),
    width: z.number().min(0).max(20).optional().describe('Line width in points.'),
    dash: z.enum(['solid', 'dash', 'dot']).optional(),
  })
  .strict();

export const shapeTextSchema = z
  .object({ paragraphs: z.array(paragraphSchema).min(1).max(50), ...textStyleShape })
  .strict()
  .describe('Text inside the shape.');

const tableCellSchema = z.string().max(1000);

const tableShape = {
  header: z.array(tableCellSchema).min(1).max(20).optional().describe('Header cells (one per column).'),
  rows: z
    .array(z.array(tableCellSchema).min(1).max(20))
    .max(100)
    .describe('Body rows; each row has one cell per column.'),
  widths: z
    .array(z.number().positive())
    .max(20)
    .optional()
    .describe('Relative column widths, one per column (e.g. [2,1,1]).'),
  fontSize: fontSizeSchema.optional(),
  headerFill: colorSchema.optional(),
  headerColor: colorSchema.optional(),
  color: colorSchema.optional(),
  borderColor: colorSchema.optional(),
  banded: z.boolean().optional().describe('Alternate row shading.'),
};

const chartSeriesSchema = z
  .object({
    name: z.string().min(1).max(100),
    values: z.array(z.number()).max(100).describe('One value per category.'),
    color: colorSchema.optional(),
  })
  .strict();

const chartShape = {
  chartType: z.enum(CHART_TYPES),
  categories: z.array(z.string().max(200)).min(1).max(100),
  series: z.array(chartSeriesSchema).min(1).max(12),
  showValues: z.boolean().optional(),
  legend: z.enum(['none', 'top', 'bottom', 'right']).optional().describe('Legend position (default bottom).'),
  title: z.string().max(200).optional(),
  fontSize: fontSizeSchema.optional(),
};

const imageShape = {
  asset: assetRefSchema,
  alt: z.string().max(500).describe('Alternative text describing the image.'),
  fit: z.enum(['contain', 'cover']).optional(),
};

function elementSchemas<Id extends z.ZodType<string | undefined>>(id: Id) {
  const box = {
    id,
    x: z.number().describe('Left, inches (canvas is 13.333 wide).'),
    y: z.number().describe('Top, inches (canvas is 7.5 high).'),
    w: z.number().min(0).describe('Width, inches.'),
    h: z.number().min(0).describe('Height, inches.'),
  };
  const text = z
    .object({
      type: z.literal('text'),
      ...box,
      paragraphs: z.array(paragraphSchema).min(1).max(200).optional(),
      bullets: z.array(paragraphSchema).min(1).max(200).optional(),
      ...textStyleShape,
      fill: colorSchema.optional(),
    })
    .strict()
    .refine((el) => (el.paragraphs === undefined) !== (el.bullets === undefined), {
      message: 'A text element needs exactly one of "paragraphs" or "bullets".',
    });
  const shape = z
    .object({
      type: z.literal('shape'),
      ...box,
      shape: z.enum(SHAPES),
      fill: colorSchema.optional(),
      line: lineStyleSchema.optional(),
      flipH: z.boolean().optional(),
      flipV: z.boolean().optional(),
      text: shapeTextSchema.optional(),
    })
    .strict();
  const image = z.object({ type: z.literal('image'), ...box, ...imageShape }).strict();
  const table = z.object({ type: z.literal('table'), ...box, ...tableShape }).strict();
  const chart = z.object({ type: z.literal('chart'), ...box, ...chartShape }).strict();
  return z.discriminatedUnion('type', [text, shape, image, table, chart]);
}

export const elementSchema = elementSchemas(itemIdSchema).describe('Free element positioned in inches.');
export const elementInputSchema = elementSchemas(itemIdSchema.optional()).describe(
  'Free element positioned in inches; id is optional and generated when omitted.',
);

export type SlideElement = z.infer<typeof elementSchema>;
export type ElementInput = z.infer<typeof elementInputSchema>;
export type ElementType = SlideElement['type'];
export type TextElement = Extract<SlideElement, { type: 'text' }>;
export type ShapeElement = Extract<SlideElement, { type: 'shape' }>;
export type ImageElement = Extract<SlideElement, { type: 'image' }>;
export type TableElement = Extract<SlideElement, { type: 'table' }>;
export type ChartElement = Extract<SlideElement, { type: 'chart' }>;

/** Every field an `update_element` patch may set; `null` removes an optional field. */
export const elementPatchSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().min(0).optional(),
    h: z.number().min(0).optional(),
    paragraphs: z.array(paragraphSchema).min(1).max(200).nullable().optional(),
    bullets: z.array(paragraphSchema).min(1).max(200).nullable().optional(),
    fontSize: fontSizeSchema.nullable().optional(),
    font: fontRoleSchema.nullable().optional(),
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    color: colorSchema.nullable().optional(),
    align: alignSchema.nullable().optional(),
    valign: valignSchema.nullable().optional(),
    fill: colorSchema.nullable().optional(),
    shape: z.enum(SHAPES).optional(),
    line: lineStyleSchema.nullable().optional(),
    flipH: z.boolean().nullable().optional(),
    flipV: z.boolean().nullable().optional(),
    text: shapeTextSchema.nullable().optional(),
    asset: assetRefSchema.optional(),
    alt: z.string().max(500).optional(),
    fit: z.enum(['contain', 'cover']).nullable().optional(),
    header: tableShape.header.nullable(),
    rows: tableShape.rows.optional(),
    widths: tableShape.widths.nullable(),
    headerFill: colorSchema.nullable().optional(),
    headerColor: colorSchema.nullable().optional(),
    borderColor: colorSchema.nullable().optional(),
    banded: z.boolean().nullable().optional(),
    chartType: z.enum(CHART_TYPES).optional(),
    categories: chartShape.categories.optional(),
    series: chartShape.series.optional(),
    showValues: z.boolean().nullable().optional(),
    legend: chartShape.legend.nullable(),
    title: z.string().max(200).nullable().optional(),
  })
  .strict()
  .describe('Fields to change. "id" and "type" cannot change; null removes an optional field.');

export type ElementPatch = z.infer<typeof elementPatchSchema>;

// ---------------------------------------------------------------------------------------------
// Slot contents (semantic level)

const slotTextStyleShape = {
  fontSize: fontSizeSchema.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: colorSchema.optional(),
  align: alignSchema.optional(),
  valign: valignSchema.optional(),
};

export const textSlotSchema = z
  .object({
    type: z.literal('text'),
    paragraphs: z.array(paragraphSchema).min(1).max(200),
    ...slotTextStyleShape,
  })
  .strict();
export const bulletsSlotSchema = z
  .object({
    type: z.literal('bullets'),
    items: z.array(paragraphSchema).min(1).max(100),
    ...slotTextStyleShape,
  })
  .strict();
export const imageSlotSchema = z
  .object({ type: z.literal('image'), ...imageShape, caption: z.string().max(300).optional() })
  .strict();
export const tableSlotSchema = z.object({ type: z.literal('table'), ...tableShape }).strict();
export const chartSlotSchema = z.object({ type: z.literal('chart'), ...chartShape }).strict();
export const statsSlotSchema = z
  .object({
    type: z.literal('stats'),
    items: z
      .array(
        z
          .object({
            value: z.string().min(1).max(40).describe('The number, e.g. "40%" or "R$ 2,1 mi".'),
            label: z.string().max(200),
            description: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    color: colorSchema.optional(),
  })
  .strict();
export const stepsSlotSchema = z
  .object({
    type: z.literal('steps'),
    items: z
      .array(
        z
          .object({
            title: z.string().max(200),
            description: z.string().max(500).optional(),
            marker: z.string().max(8).optional().describe('Step marker; defaults to "01", "02"…'),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export const cardsSlotSchema = z
  .object({
    type: z.literal('cards'),
    items: z
      .array(
        z
          .object({
            title: z.string().max(200).optional(),
            value: z.string().max(40).optional(),
            text: z.string().max(1000).optional(),
            bullets: z.array(z.string().max(500)).max(12).optional(),
            image: z.object(imageShape).strict().optional(),
            caption: z.string().max(300).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(9),
  })
  .strict();
export const quoteSlotSchema = z
  .object({
    type: z.literal('quote'),
    text: z.string().min(1).max(1000),
    attribution: z.string().max(200).optional(),
  })
  .strict();

export const slotObjectSchema = z.discriminatedUnion('type', [
  textSlotSchema,
  bulletsSlotSchema,
  imageSlotSchema,
  tableSlotSchema,
  chartSlotSchema,
  statsSlotSchema,
  stepsSlotSchema,
  cardsSlotSchema,
  quoteSlotSchema,
]);

export const slotContentSchema = z
  .union([z.string().max(MAX_TEXT), slotObjectSchema])
  .describe(
    'Slot content: a string (text) or an object with "type" (text, bullets, image, table, chart, stats, steps, cards, quote).',
  );

export type SlotContent = z.infer<typeof slotContentSchema>;
export type SlotObject = z.infer<typeof slotObjectSchema>;
export type SlotContentKind = SlotObject['type'];
export const SLOT_CONTENT_KINDS = [
  'text',
  'bullets',
  'image',
  'table',
  'chart',
  'stats',
  'steps',
  'cards',
  'quote',
] as const satisfies readonly SlotContentKind[];

export function slotContentKind(content: SlotContent): SlotContentKind {
  return typeof content === 'string' ? 'text' : content.type;
}

// ---------------------------------------------------------------------------------------------
// Slides and deck

export const backgroundSchema = z
  .object({
    color: colorSchema.optional(),
    image: assetRefSchema.optional(),
  })
  .strict()
  .describe('Slide background: a color token/hex and/or an image asset (cover).');

export type Background = z.infer<typeof backgroundSchema>;

export const layoutNameSchema = z
  .string()
  .regex(LAYOUT_NAME_PATTERN, 'Layout names are lowercase words joined by "-", e.g. "title-content".')
  .describe(
    'Layout name: title, section, title-content, two-columns, title-image, comparison, big-number, quote, blank, or an application layout.',
  );

export const slotNameSchema = z
  .string()
  .regex(SLOT_NAME_PATTERN, 'Slot names use letters, digits, "_" or "-".');

function slideSchemaWith<Id extends z.ZodType<string | undefined>, El extends z.ZodType>(
  id: Id,
  element: El,
) {
  return z
    .object({
      id,
      layout: layoutNameSchema,
      slots: z
        .record(slotNameSchema, slotContentSchema)
        .default({})
        .describe('Slot name → content, per the layout.'),
      elements: z.array(element).default([]).describe('Free elements, back to front.'),
      background: backgroundSchema.optional(),
      notes: z.string().max(20000).optional().describe('Speaker notes.'),
      hidden: z.boolean().optional(),
    })
    .strict();
}

export const slideSchema = slideSchemaWith(itemIdSchema, elementSchema);
export const slideInputSchema = slideSchemaWith(itemIdSchema.optional(), elementInputSchema);

export type Slide = z.infer<typeof slideSchema>;
export type SlideInput = z.infer<typeof slideInputSchema>;

export const footerSchema = z
  .object({
    text: z.string().max(200).optional(),
    slideNumber: z.boolean().optional(),
  })
  .strict()
  .describe('Deck footer: text and/or slide numbers on content slides.');

export type Footer = z.infer<typeof footerSchema>;

export const SLIDE_SIZES = ['16:9'] as const;

export const slidesContentSchema = z
  .object({
    size: z.enum(SLIDE_SIZES).default('16:9').describe('Canvas 13.333 x 7.5 inches.'),
    slides: z.array(slideSchema).default([]),
    footer: footerSchema.optional(),
  })
  .strict();

export type SlidesContent = z.infer<typeof slidesContentSchema>;
