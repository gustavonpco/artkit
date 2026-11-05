import { defineComponent } from '@openuidev/lang-core';
import { z } from 'zod/v4';

/**
 * Component schemas of the artkit library (spec §12.2). Schemas live here so the format adapter and the model prompt
 * share one definition; React renderers live in `./react` and map by component name.
 */

const text = z.string().max(2000);
const children = z.array(z.any()).describe('Child declarations or inline components, in order.');
const alt = z.string().min(1).max(300).describe('Alternative text; required for images.');
const asset = z
  .string()
  .regex(/^asset:\/\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'Use asset://<id> or a permitted URL.');
const series = z
  .array(z.object({ label: text, value: z.number() }))
  .min(1)
  .max(30);

export const SLIDE_LAYOUTS = [
  'title',
  'section',
  'title-content',
  'two-columns',
  'big-number',
  'title-image',
  'comparison',
  'quote',
] as const;

export const VISUAL_ROOTS = ['Deck', 'Dashboard', 'Report', 'Prototype', 'Diagram'] as const;

const def = <const N extends string>(name: N, description: string, props: z.ZodObject<z.ZodRawShape>) =>
  defineComponent({ name, description, props, component: null }); // renderers are registered in ./react

export const layoutComponents = [
  def('Page', 'Full page container with a title.', z.object({ title: text.optional(), children })),
  def('Section', 'Titled section inside a page.', z.object({ title: text, children })),
  def(
    'Grid',
    'Responsive grid of children.',
    z.object({ columns: z.number().int().min(1).max(4).default(2), children }),
  ),
  def('Columns', 'Side-by-side columns, one child per column.', z.object({ children })),
  def('Card', 'Bordered card with an optional heading.', z.object({ title: text.optional(), children })),
  def('Divider', 'Horizontal separator.', z.object({})),
] as const;

export const textComponents = [
  def('Title', 'Main title.', z.object({ text })),
  def('Subtitle', 'Secondary line under a title.', z.object({ text })),
  def(
    'Heading',
    'Heading of a given level.',
    z.object({ text, level: z.number().int().min(1).max(4).default(2) }),
  ),
  def('Text', 'Paragraph of text.', z.object({ text })),
  def('Bullets', 'Bulleted list.', z.object({ items: z.array(text).min(1).max(12) })),
  def(
    'Callout',
    'Highlighted note.',
    z.object({ kind: z.enum(['note', 'warning', 'tip']).default('note'), text }),
  ),
  def('Quote', 'Quotation with an optional author.', z.object({ text, author: text.optional() })),
  def('Image', 'Image with mandatory alternative text.', z.object({ src: asset, alt })),
] as const;

export const dataComponents = [
  def(
    'StatCard',
    'Single number with a label and optional delta.',
    z.object({ label: text, value: text, delta: text.optional() }),
  ),
  def(
    'Table',
    'Table with a header row.',
    z.object({ headers: z.array(text).min(1).max(12), rows: z.array(z.array(text)).max(200) }),
  ),
  def('BarChart', 'Vertical bars for categories.', z.object({ title: text.optional(), series })),
  def('LineChart', 'Line over an ordered series.', z.object({ title: text.optional(), series })),
  def('PieChart', 'Share of a whole.', z.object({ title: text.optional(), series })),
  def(
    'StackedBarChart',
    'Bars split into stacked segments.',
    z.object({
      title: text.optional(),
      categories: z.array(text).min(1),
      series: z.array(z.object({ name: text, values: z.array(z.number()) })).min(1),
    }),
  ),
  def('Progress', 'Progress towards a goal.', z.object({ label: text, value: z.number().min(0).max(100) })),
  def(
    'Badge',
    'Short status label.',
    z.object({ text, tone: z.enum(['neutral', 'good', 'warning', 'bad']).default('neutral') }),
  ),
] as const;

export const slideComponents = [
  def(
    'Deck',
    'Presentation: an ordered list of slides, 16:9. Slides come first, the optional title last.',
    z.object({ slides: z.array(z.any()).max(100), title: text.optional() }),
  ),
  def(
    'Slide',
    'One slide with a layout and its content.',
    z.object({ layout: z.enum(SLIDE_LAYOUTS), children }),
  ),
  def('Notes', 'Speaker notes of a slide.', z.object({ text })),
] as const;

export const reportComponents = [
  def('Dashboard', 'Composition of KPIs, charts and tables.', z.object({ title: text, children })),
  def('Report', 'Report with sections, tables and charts.', z.object({ title: text, children })),
  def(
    'Filter',
    'Labelled filter for a dashboard.',
    z.object({ label: text, options: z.array(text).min(1).max(30) }),
  ),
  def('KpiRow', 'Row of StatCard items.', z.object({ children })),
] as const;

export const prototypeComponents = [
  def(
    'Prototype',
    'Clickable prototype made of screens.',
    z.object({ title: text, screens: z.array(z.any()).min(1).max(30) }),
  ),
  def('Screen', 'One screen of a prototype.', z.object({ name: text, children })),
  def('Nav', 'Navigation bar linking screens.', z.object({ items: z.array(text).min(1).max(8) })),
  def('Form', 'Form with fields.', z.object({ title: text.optional(), children })),
  def('Input', 'Text input.', z.object({ label: text, placeholder: text.optional() })),
  def('Select', 'Choice input.', z.object({ label: text, options: z.array(text).min(1).max(30) })),
  def(
    'Button',
    'Button that navigates to a screen or does nothing.',
    z.object({ label: text, to: text.optional() }),
  ),
  def('Modal', 'Dialog over the current screen.', z.object({ title: text, children })),
] as const;

export const diagramComponents = [
  def(
    'Diagram',
    'Flowchart, architecture or sequence diagram.',
    z.object({
      kind: z.enum(['flow', 'architecture', 'sequence']).default('flow'),
      nodes: z
        .array(z.object({ id: text, label: text }))
        .min(1)
        .max(60),
      edges: z.array(z.object({ from: text, to: text, label: text.optional() })).max(120),
    }),
  ),
] as const;

/** Every component of the library, in catalog order. */
export const uiComponents = [
  ...layoutComponents,
  ...textComponents,
  ...dataComponents,
  ...slideComponents,
  ...reportComponents,
  ...prototypeComponents,
  ...diagramComponents,
];

export type UiComponentName = (typeof uiComponents)[number]['name'];
