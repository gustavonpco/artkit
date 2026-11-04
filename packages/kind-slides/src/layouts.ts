import type { Color } from '@artkit/core';
import { CANVAS, EPSILON, insideCanvas, type Rect } from './geometry.js';
import {
  type Align,
  type FontRole,
  LAYOUT_NAME_PATTERN,
  type ShapeElement,
  SLOT_CONTENT_KINDS,
  SLOT_NAME_PATTERN,
  type SlotContentKind,
  type VAlign,
} from './schema.js';

/** Typography roles: every slot declares one, so renderer, exporter and lint agree on fonts and sizes. */
export type TypographyRole =
  | 'display'
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'body'
  | 'caption'
  | 'quote'
  | 'stat';

export interface RoleStyle {
  font: FontRole;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: Color;
}

export const TYPOGRAPHY: Record<TypographyRole, RoleStyle> = {
  display: { font: 'heading', fontSize: 44, bold: true, italic: false, color: 'text' },
  title: { font: 'heading', fontSize: 30, bold: true, italic: false, color: 'text' },
  subtitle: { font: 'body', fontSize: 20, bold: false, italic: false, color: 'muted' },
  heading: { font: 'heading', fontSize: 22, bold: true, italic: false, color: 'text' },
  body: { font: 'body', fontSize: 18, bold: false, italic: false, color: 'text' },
  caption: { font: 'body', fontSize: 12, bold: false, italic: false, color: 'muted' },
  quote: { font: 'heading', fontSize: 28, bold: false, italic: true, color: 'text' },
  stat: { font: 'heading', fontSize: 54, bold: true, italic: false, color: 'text' },
};

export interface LayoutSlot {
  /** Slot name used in `slots` (e.g. "title", "body"). */
  name: string;
  /** Content kinds the slot accepts; the first one is the default shown to models. */
  accepts: SlotContentKind[];
  /** Box in inches on the 13.333 x 7.5 canvas. */
  box: Rect;
  role: TypographyRole;
  /** Lint warns when a required slot is empty. */
  required?: boolean;
  /** Short human description, shown in instructions and as editor placeholder. */
  label?: string;
  fontSize?: number;
  align?: Align;
  valign?: VAlign;
  color?: Color;
  /** Maximum columns for repeatable contents (stats, steps, cards). */
  columns?: number;
}

/** Decorative shape drawn behind the slots (accent bars, panels). */
export type LayoutDecoration = Omit<ShapeElement, 'id' | 'type'>;

export interface LayoutDefinition {
  name: string;
  label: string;
  /** When to use the layout; included in model instructions. */
  description: string;
  slots: LayoutSlot[];
  background?: Color;
  decorations?: LayoutDecoration[];
  /** Whether the deck footer appears on slides with this layout (default true). */
  footer?: boolean;
}

const M = 0.6;
const CONTENT_W = CANVAS.width - 2 * M;
const COL_GAP = 0.4;
const COL_W = (CONTENT_W - COL_GAP) / 2;
const RIGHT_X = M + COL_W + COL_GAP;
const BODY_Y = 1.5;
const BODY_H = 5.3;

const RICH: SlotContentKind[] = [
  'bullets',
  'text',
  'table',
  'chart',
  'image',
  'stats',
  'steps',
  'cards',
  'quote',
];

const titleSlot: LayoutSlot = {
  name: 'title',
  accepts: ['text'],
  box: { x: M, y: 0.4, w: CONTENT_W, h: 0.9 },
  role: 'title',
  required: true,
  valign: 'bottom',
  label: 'Slide title (an assertion)',
};

export const BUILT_IN_LAYOUTS: readonly LayoutDefinition[] = [
  {
    name: 'title',
    label: 'Title',
    description: 'Opening slide: deck title and subtitle.',
    footer: false,
    decorations: [{ shape: 'rect', x: 0.8, y: 4.05, w: 1.2, h: 0.08, fill: 'accent' }],
    slots: [
      {
        name: 'title',
        accepts: ['text'],
        box: { x: 0.8, y: 1.8, w: 11.733, h: 2.1 },
        role: 'display',
        required: true,
        valign: 'bottom',
        label: 'Deck title',
      },
      {
        name: 'subtitle',
        accepts: ['text'],
        box: { x: 0.8, y: 4.3, w: 11.733, h: 1.2 },
        role: 'subtitle',
        label: 'Subtitle, author or date',
      },
    ],
  },
  {
    name: 'section',
    label: 'Section',
    description: 'Section divider with a large title.',
    footer: false,
    decorations: [{ shape: 'rect', x: 0, y: 0, w: 0.25, h: CANVAS.height, fill: 'accent' }],
    slots: [
      {
        name: 'title',
        accepts: ['text'],
        box: { x: 0.9, y: 2.4, w: 11.5, h: 1.7 },
        role: 'display',
        required: true,
        valign: 'bottom',
        label: 'Section title',
      },
      {
        name: 'subtitle',
        accepts: ['text'],
        box: { x: 0.9, y: 4.25, w: 11.5, h: 1.0 },
        role: 'subtitle',
        label: 'Optional subtitle',
      },
    ],
  },
  {
    name: 'title-content',
    label: 'Title and content',
    description: 'Title plus one body: bullets, text, table, chart, image, stats, steps, cards or quote.',
    slots: [
      titleSlot,
      {
        name: 'body',
        accepts: RICH,
        box: { x: M, y: BODY_Y, w: CONTENT_W, h: BODY_H },
        role: 'body',
        required: true,
        label: 'Body',
      },
    ],
  },
  {
    name: 'two-columns',
    label: 'Two columns',
    description: 'Title plus two side-by-side bodies.',
    slots: [
      titleSlot,
      {
        name: 'left',
        accepts: RICH,
        box: { x: M, y: BODY_Y, w: COL_W, h: BODY_H },
        role: 'body',
        required: true,
        label: 'Left column',
      },
      {
        name: 'right',
        accepts: RICH,
        box: { x: RIGHT_X, y: BODY_Y, w: COL_W, h: BODY_H },
        role: 'body',
        required: true,
        label: 'Right column',
      },
    ],
  },
  {
    name: 'title-image',
    label: 'Title and image',
    description: 'Title, a large image (or chart/table) on the left and short text on the right.',
    slots: [
      titleSlot,
      {
        name: 'image',
        accepts: ['image', 'chart', 'table'],
        box: { x: M, y: BODY_Y, w: 7.4, h: BODY_H },
        role: 'body',
        required: true,
        label: 'Image',
      },
      {
        name: 'body',
        accepts: ['bullets', 'text'],
        box: { x: 8.3, y: BODY_Y, w: CANVAS.width - M - 8.3, h: BODY_H },
        role: 'body',
        label: 'Text beside the image',
      },
    ],
  },
  {
    name: 'comparison',
    label: 'Comparison',
    description: 'Title plus two labeled columns to compare options, before/after or pros/cons.',
    slots: [
      titleSlot,
      {
        name: 'leftTitle',
        accepts: ['text'],
        box: { x: M, y: BODY_Y, w: COL_W, h: 0.6 },
        role: 'heading',
        required: true,
        label: 'Left heading',
      },
      {
        name: 'left',
        accepts: RICH,
        box: { x: M, y: 2.2, w: COL_W, h: 4.6 },
        role: 'body',
        required: true,
        label: 'Left column',
      },
      {
        name: 'rightTitle',
        accepts: ['text'],
        box: { x: RIGHT_X, y: BODY_Y, w: COL_W, h: 0.6 },
        role: 'heading',
        required: true,
        label: 'Right heading',
      },
      {
        name: 'right',
        accepts: RICH,
        box: { x: RIGHT_X, y: 2.2, w: COL_W, h: 4.6 },
        role: 'body',
        required: true,
        label: 'Right column',
      },
    ],
  },
  {
    name: 'big-number',
    label: 'Big number',
    description: 'One to four highlighted numbers (stats) with a short caption.',
    slots: [
      titleSlot,
      {
        name: 'stat',
        accepts: ['stats'],
        box: { x: M, y: 1.6, w: CONTENT_W, h: 3.6 },
        role: 'stat',
        required: true,
        label: 'Highlighted numbers',
        columns: 4,
      },
      {
        name: 'caption',
        accepts: ['text', 'bullets'],
        box: { x: M, y: 5.45, w: CONTENT_W, h: 1.3 },
        role: 'subtitle',
        align: 'center',
        label: 'Caption',
      },
    ],
  },
  {
    name: 'quote',
    label: 'Quote',
    description: 'A single quotation with attribution.',
    slots: [
      {
        name: 'quote',
        accepts: ['quote', 'text'],
        box: { x: 1.2, y: 1.3, w: 10.933, h: 4.6 },
        role: 'quote',
        required: true,
        valign: 'middle',
        label: 'Quotation',
      },
    ],
  },
  {
    name: 'blank',
    label: 'Blank',
    description: 'No slots: only free elements positioned in inches.',
    slots: [],
  },
];

export interface LayoutRegistry {
  get(name: string): LayoutDefinition | undefined;
  has(name: string): boolean;
  names(): string[];
  list(): LayoutDefinition[];
}

export class LayoutDefinitionError extends Error {
  constructor(layout: string, problem: string) {
    super(`Invalid slide layout "${layout}": ${problem}`);
    this.name = 'LayoutDefinitionError';
  }
}

/** Checks an application layout so every consumer (renderer, exporter, lint) can trust it. */
export function assertLayoutDefinition(layout: LayoutDefinition): void {
  const name = typeof layout?.name === 'string' ? layout.name : '<unnamed>';
  if (!LAYOUT_NAME_PATTERN.test(name))
    throw new LayoutDefinitionError(name, `name must match ${LAYOUT_NAME_PATTERN}`);
  if (!Array.isArray(layout.slots)) throw new LayoutDefinitionError(name, 'slots must be an array');
  const seen = new Set<string>();
  for (const slot of layout.slots) {
    if (!SLOT_NAME_PATTERN.test(slot.name))
      throw new LayoutDefinitionError(name, `slot "${slot.name}" must match ${SLOT_NAME_PATTERN}`);
    if (seen.has(slot.name)) throw new LayoutDefinitionError(name, `slot "${slot.name}" is declared twice`);
    seen.add(slot.name);
    if (!Array.isArray(slot.accepts) || slot.accepts.length === 0) {
      throw new LayoutDefinitionError(name, `slot "${slot.name}" must accept at least one content kind`);
    }
    for (const kind of slot.accepts) {
      if (!(SLOT_CONTENT_KINDS as readonly string[]).includes(kind)) {
        throw new LayoutDefinitionError(name, `slot "${slot.name}" accepts unknown content kind "${kind}"`);
      }
    }
    if (!(slot.role in TYPOGRAPHY))
      throw new LayoutDefinitionError(name, `slot "${slot.name}" has unknown role "${slot.role}"`);
    const box = slot.box;
    if (
      !box ||
      ![box.x, box.y, box.w, box.h].every(Number.isFinite) ||
      box.w <= EPSILON ||
      box.h <= EPSILON ||
      !insideCanvas(box)
    ) {
      throw new LayoutDefinitionError(
        name,
        `slot "${slot.name}" box must have positive size and fit the 13.333 x 7.5 canvas`,
      );
    }
    if (slot.fontSize !== undefined && (slot.fontSize < 8 || slot.fontSize > 96)) {
      throw new LayoutDefinitionError(name, `slot "${slot.name}" fontSize must be between 8 and 96`);
    }
  }
  for (const decoration of layout.decorations ?? []) {
    if (!insideCanvas(decoration)) throw new LayoutDefinitionError(name, 'decorations must fit the canvas');
  }
}

/**
 * Builds the layout registry: built-ins first, then application layouts (which replace a built-in with the
 * same name). Throws `LayoutDefinitionError` for invalid definitions.
 */
export function createLayoutRegistry(
  custom: readonly LayoutDefinition[] = [],
  includeBuiltIns = true,
): LayoutRegistry {
  const map = new Map<string, LayoutDefinition>();
  if (includeBuiltIns) for (const layout of BUILT_IN_LAYOUTS) map.set(layout.name, layout);
  const customNames = new Set<string>();
  for (const layout of custom) {
    assertLayoutDefinition(layout);
    if (customNames.has(layout.name)) throw new LayoutDefinitionError(layout.name, 'declared twice');
    customNames.add(layout.name);
    map.set(layout.name, layout);
  }
  if (map.size === 0) throw new LayoutDefinitionError('<registry>', 'at least one layout is required');
  return {
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    names: () => [...map.keys()],
    list: () => [...map.values()],
  };
}

export const builtInLayouts: LayoutRegistry = createLayoutRegistry();

/**
 * Layout used when a slide references a layout the current registry does not know (e.g. a renderer that was
 * not given the application's layouts): the title slot on top and the other slots stacked in the body area.
 */
export function fallbackLayout(name: string, slotNames: readonly string[]): LayoutDefinition {
  const others = slotNames.filter((slot) => slot !== 'title');
  const area = { x: M, y: BODY_Y, w: CONTENT_W, h: BODY_H };
  const gap = 0.2;
  const each = others.length > 0 ? (area.h - gap * (others.length - 1)) / others.length : area.h;
  return {
    name,
    label: name,
    description: 'Fallback layout',
    slots: [
      ...(slotNames.includes('title') ? [titleSlot] : []),
      ...others.map(
        (slot, index): LayoutSlot => ({
          name: slot,
          accepts: [...SLOT_CONTENT_KINDS],
          box: { x: area.x, y: area.y + index * (each + gap), w: area.w, h: each },
          role: 'body',
        }),
      ),
    ],
  };
}

export function resolveLayout(
  layouts: LayoutRegistry,
  name: string,
  slotNames: readonly string[],
): LayoutDefinition {
  return layouts.get(name) ?? fallbackLayout(name, slotNames);
}

export function isTitleRole(role: TypographyRole): boolean {
  return role === 'title' || role === 'display';
}
