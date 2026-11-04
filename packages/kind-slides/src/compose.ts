import type { Color } from '@artkit-ai/core';
import { CANVAS, gridCells, inset, type Rect } from './geometry.js';
import {
  type LayoutDefinition,
  type LayoutRegistry,
  type LayoutSlot,
  resolveLayout,
  TYPOGRAPHY,
  type TypographyRole,
} from './layouts.js';
import type {
  Align,
  FontRole,
  Footer,
  Paragraph,
  ShapeElement,
  Slide,
  SlideElement,
  SlotContent,
  SlotObject,
  TextElement,
  VAlign,
} from './schema.js';

/**
 * Where a primitive comes from. Slots, layout decorations and the footer are turned into the same
 * primitives as free elements, so renderer, exporter and lint share one geometry.
 */
export type PrimitiveSource =
  | { kind: 'element'; id: string }
  | { kind: 'slot'; slot: string; part: string }
  | { kind: 'decoration' }
  | { kind: 'footer'; part: 'text' | 'number' };

export interface Primitive {
  element: SlideElement;
  source: PrimitiveSource;
  /** Typography role for slot text (titles render as headings). */
  role?: TypographyRole;
}

export interface ResolvedTextStyle {
  fontSize: number;
  font: FontRole;
  bold: boolean;
  italic: boolean;
  color: Color;
  align: Align;
  valign: VAlign;
}

export const DEFAULT_TEXT_STYLE: ResolvedTextStyle = {
  fontSize: 18,
  font: 'body',
  bold: false,
  italic: false,
  color: 'text',
  align: 'left',
  valign: 'top',
};

export const DEFAULT_SHAPE_TEXT_STYLE: ResolvedTextStyle = {
  ...DEFAULT_TEXT_STYLE,
  fontSize: 16,
  align: 'center',
  valign: 'middle',
};

type TextStyleFields = Partial<
  Pick<TextElement, 'fontSize' | 'font' | 'bold' | 'italic' | 'color' | 'align' | 'valign'>
>;

export function resolveTextStyle(
  fields: TextStyleFields,
  defaults: ResolvedTextStyle = DEFAULT_TEXT_STYLE,
): ResolvedTextStyle {
  return {
    fontSize: fields.fontSize ?? defaults.fontSize,
    font: fields.font ?? defaults.font,
    bold: fields.bold ?? defaults.bold,
    italic: fields.italic ?? defaults.italic,
    color: fields.color ?? defaults.color,
    align: fields.align ?? defaults.align,
    valign: fields.valign ?? defaults.valign,
  };
}

export interface ComposeOptions {
  layouts: LayoutRegistry;
  footer?: Footer;
  /** 1-based position of the slide in the deck (for the slide number). */
  slideNumber?: number;
}

export interface ComposedSlot {
  slot: LayoutSlot;
  content?: SlotContent;
}

export interface ComposedSlide {
  layout: LayoutDefinition;
  /** True when the slide's layout is unknown to the registry and a fallback was used. */
  unknownLayout: boolean;
  background: { color: Color; image?: string };
  slots: ComposedSlot[];
  /** Back to front: decorations, slots, free elements, footer. */
  primitives: Primitive[];
}

export function composeSlide(slide: Slide, options: ComposeOptions): ComposedSlide {
  const known = options.layouts.has(slide.layout);
  const layout = resolveLayout(options.layouts, slide.layout, Object.keys(slide.slots));
  const primitives: Primitive[] = [];
  (layout.decorations ?? []).forEach((decoration, index) => {
    primitives.push({
      element: { ...decoration, type: 'shape', id: `${slide.id}~deco${index}` } as ShapeElement,
      source: { kind: 'decoration' },
    });
  });
  const slots: ComposedSlot[] = [];
  for (const slot of layout.slots) {
    const content = slide.slots[slot.name];
    slots.push(content === undefined ? { slot } : { slot, content });
    if (content !== undefined) primitives.push(...slotPrimitives(slide.id, slot, content));
  }
  for (const element of slide.elements)
    primitives.push({ element, source: { kind: 'element', id: element.id } });
  if (options.footer && layout.footer !== false)
    primitives.push(...footerPrimitives(slide.id, options.footer, options.slideNumber ?? 1));
  const color = slide.background?.color ?? layout.background ?? 'background';
  return {
    layout,
    unknownLayout: !known,
    background: { color, ...(slide.background?.image ? { image: slide.background.image } : {}) },
    slots,
    primitives,
  };
}

export const FOOTER_BOX = { x: 0.6, y: 6.98, w: 8, h: 0.36 } as const;
export const SLIDE_NUMBER_BOX = { x: CANVAS.width - 0.6 - 1.2, y: 6.98, w: 1.2, h: 0.36 } as const;

function footerPrimitives(slideId: string, footer: Footer, slideNumber: number): Primitive[] {
  const out: Primitive[] = [];
  const base = {
    type: 'text' as const,
    fontSize: 11,
    font: 'body' as const,
    color: 'muted' as const,
    valign: 'middle' as const,
  };
  if (footer.text) {
    out.push({
      element: { ...base, id: `${slideId}~footer`, ...FOOTER_BOX, paragraphs: [footer.text], align: 'left' },
      source: { kind: 'footer', part: 'text' },
      role: 'caption',
    });
  }
  if (footer.slideNumber) {
    out.push({
      element: {
        ...base,
        id: `${slideId}~number`,
        ...SLIDE_NUMBER_BOX,
        paragraphs: [String(slideNumber)],
        align: 'right',
      },
      source: { kind: 'footer', part: 'number' },
      role: 'caption',
    });
  }
  return out;
}

function roleStyle(slot: LayoutSlot, role: TypographyRole = slot.role): ResolvedTextStyle {
  const base = TYPOGRAPHY[role];
  const isSlotRole = role === slot.role;
  return {
    fontSize: (isSlotRole ? slot.fontSize : undefined) ?? base.fontSize,
    font: base.font,
    bold: base.bold,
    italic: base.italic,
    color: (isSlotRole ? slot.color : undefined) ?? base.color,
    align: (isSlotRole ? slot.align : undefined) ?? 'left',
    valign: (isSlotRole ? slot.valign : undefined) ?? 'top',
  };
}

function textPrimitive(
  id: string,
  slot: LayoutSlot,
  part: string,
  rect: Rect,
  body: { paragraphs: Paragraph[] } | { bullets: Paragraph[] },
  style: ResolvedTextStyle,
  role: TypographyRole,
): Primitive {
  return {
    element: { type: 'text', id, ...rect, ...body, ...style } as TextElement,
    source: { kind: 'slot', slot: slot.name, part },
    role,
  };
}

function withOverrides(style: ResolvedTextStyle, content: SlotObject): ResolvedTextStyle {
  if (content.type !== 'text' && content.type !== 'bullets') return style;
  return {
    ...style,
    ...(content.fontSize !== undefined ? { fontSize: content.fontSize } : {}),
    ...(content.bold !== undefined ? { bold: content.bold } : {}),
    ...(content.italic !== undefined ? { italic: content.italic } : {}),
    ...(content.color !== undefined ? { color: content.color } : {}),
    ...(content.align !== undefined ? { align: content.align } : {}),
    ...(content.valign !== undefined ? { valign: content.valign } : {}),
  };
}

const CAPTION_H = 0.45;
const DEFAULT_COLUMNS = { stats: 4, steps: 5, cards: 3 } as const;

/** Turns one slot's content into positioned primitives inside the slot box. */
export function slotPrimitives(slideId: string, slot: LayoutSlot, content: SlotContent): Primitive[] {
  const box = slot.box;
  const prefix = `${slideId}~${slot.name}`;
  if (typeof content === 'string') {
    return [
      textPrimitive(
        prefix,
        slot,
        'text',
        box,
        { paragraphs: content.split(/\r?\n/) },
        roleStyle(slot),
        slot.role,
      ),
    ];
  }
  switch (content.type) {
    case 'text':
      return [
        textPrimitive(
          prefix,
          slot,
          'text',
          box,
          { paragraphs: content.paragraphs },
          withOverrides(roleStyle(slot), content),
          slot.role,
        ),
      ];
    case 'bullets':
      return [
        textPrimitive(
          prefix,
          slot,
          'text',
          box,
          { bullets: content.items },
          withOverrides(roleStyle(slot), content),
          slot.role,
        ),
      ];
    case 'image': {
      const imageRect = content.caption ? { ...box, h: Math.max(0.1, box.h - CAPTION_H) } : box;
      const out: Primitive[] = [
        {
          element: {
            type: 'image',
            id: prefix,
            ...imageRect,
            asset: content.asset,
            alt: content.alt,
            fit: content.fit ?? 'contain',
          },
          source: { kind: 'slot', slot: slot.name, part: 'image' },
        },
      ];
      if (content.caption) {
        const rect = { x: box.x, y: box.y + imageRect.h, w: box.w, h: box.h - imageRect.h };
        out.push(
          textPrimitive(
            `${prefix}~caption`,
            slot,
            'caption',
            rect,
            { paragraphs: [content.caption] },
            { ...roleStyle(slot, 'caption'), align: 'center' },
            'caption',
          ),
        );
      }
      return out;
    }
    case 'table': {
      const { type: _type, ...fields } = content;
      return [
        {
          element: { type: 'table', id: prefix, ...box, ...fields },
          source: { kind: 'slot', slot: slot.name, part: 'table' },
        },
      ];
    }
    case 'chart': {
      const { type: _type, ...fields } = content;
      return [
        {
          element: { type: 'chart', id: prefix, ...box, ...fields },
          source: { kind: 'slot', slot: slot.name, part: 'chart' },
        },
      ];
    }
    case 'quote': {
      const hasAttribution = !!content.attribution;
      const quoteRect = hasAttribution ? { ...box, h: Math.max(0.3, box.h - 0.7) } : box;
      const out = [
        textPrimitive(
          prefix,
          slot,
          'quote',
          quoteRect,
          { paragraphs: [`“${content.text}”`] },
          roleStyle(slot),
          slot.role,
        ),
      ];
      if (content.attribution) {
        const rect = { x: box.x, y: box.y + quoteRect.h + 0.1, w: box.w, h: box.h - quoteRect.h - 0.1 };
        out.push(
          textPrimitive(
            `${prefix}~by`,
            slot,
            'attribution',
            rect,
            { paragraphs: [`— ${content.attribution}`] },
            { ...roleStyle(slot, 'subtitle'), align: 'right' },
            'subtitle',
          ),
        );
      }
      return out;
    }
    case 'stats':
      return statsPrimitives(prefix, slot, content);
    case 'steps':
      return stepsPrimitives(prefix, slot, content);
    case 'cards':
      return cardsPrimitives(prefix, slot, content);
  }
}

function lineHeightIn(fontSize: number, lines = 1): number {
  return (fontSize * 1.2 * lines) / 72 + 0.1;
}

function statsPrimitives(
  prefix: string,
  slot: LayoutSlot,
  content: Extract<SlotObject, { type: 'stats' }>,
): Primitive[] {
  const count = content.items.length;
  const cells = gridCells(slot.box, count, slot.columns ?? DEFAULT_COLUMNS.stats, 0.3);
  const rows = Math.ceil(count / Math.max(1, Math.min(slot.columns ?? DEFAULT_COLUMNS.stats, count)));
  const base = roleStyle(slot, 'stat');
  const statSize =
    slot.role === 'stat' && slot.fontSize
      ? slot.fontSize
      : count === 1
        ? 72
        : count === 2
          ? 60
          : count <= 4 && rows === 1
            ? 48
            : 40;
  const color = content.color ?? (slot.role === 'stat' ? slot.color : undefined) ?? base.color;
  const out: Primitive[] = [];
  content.items.forEach((item, index) => {
    const cell = cells[index]!;
    const card = count > 1;
    if (card) {
      out.push({
        element: {
          type: 'shape',
          id: `${prefix}~card${index}`,
          ...cell,
          shape: 'roundRect',
          fill: 'surface',
        },
        source: { kind: 'slot', slot: slot.name, part: `item${index}` },
      });
    }
    const inner = card ? inset(cell, 0.2) : cell;
    const valueH = Math.min(inner.h * 0.55, lineHeightIn(statSize));
    const labelSize = 16;
    const descSize = 12;
    const labelH = item.label ? Math.min(inner.h - valueH, lineHeightIn(labelSize, 2)) : 0;
    const descH = item.description ? Math.max(0, inner.h - valueH - labelH) : 0;
    const total = valueH + labelH + descH;
    let y = inner.y + Math.max(0, (inner.h - total) / 2);
    out.push(
      textPrimitive(
        `${prefix}~value${index}`,
        slot,
        `item${index}.value`,
        { x: inner.x, y, w: inner.w, h: valueH },
        { paragraphs: [item.value] },
        { ...base, fontSize: statSize, color, align: 'center', valign: 'bottom' },
        'stat',
      ),
    );
    y += valueH;
    if (item.label) {
      out.push(
        textPrimitive(
          `${prefix}~label${index}`,
          slot,
          `item${index}.label`,
          { x: inner.x, y, w: inner.w, h: labelH },
          { paragraphs: [item.label] },
          { ...roleStyle(slot, 'body'), fontSize: labelSize, color: 'muted', align: 'center' },
          'body',
        ),
      );
      y += labelH;
    }
    if (item.description && descH > 0.05) {
      out.push(
        textPrimitive(
          `${prefix}~desc${index}`,
          slot,
          `item${index}.description`,
          { x: inner.x, y, w: inner.w, h: descH },
          { paragraphs: [item.description] },
          { ...roleStyle(slot, 'caption'), fontSize: descSize, align: 'center' },
          'caption',
        ),
      );
    }
  });
  return out;
}

function stepsPrimitives(
  prefix: string,
  slot: LayoutSlot,
  content: Extract<SlotObject, { type: 'steps' }>,
): Primitive[] {
  const cells = gridCells(slot.box, content.items.length, slot.columns ?? DEFAULT_COLUMNS.steps, 0.3);
  const out: Primitive[] = [];
  content.items.forEach((item, index) => {
    const cell = cells[index]!;
    out.push({
      element: {
        type: 'shape',
        id: `${prefix}~rule${index}`,
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: 0,
        shape: 'line',
        line: { color: 'accent', width: 2 },
      },
      source: { kind: 'slot', slot: slot.name, part: `item${index}` },
    });
    const markerH = Math.min(0.6, cell.h * 0.25);
    const titleH = Math.min(lineHeightIn(18, 2), Math.max(0, cell.h - markerH - 0.1));
    const marker = item.marker ?? String(index + 1).padStart(2, '0');
    out.push(
      textPrimitive(
        `${prefix}~marker${index}`,
        slot,
        `item${index}.marker`,
        { x: cell.x, y: cell.y + 0.1, w: cell.w, h: markerH },
        { paragraphs: [marker] },
        { ...roleStyle(slot, 'heading'), fontSize: 20, color: 'muted' },
        'heading',
      ),
    );
    const titleY = cell.y + 0.1 + markerH;
    out.push(
      textPrimitive(
        `${prefix}~title${index}`,
        slot,
        `item${index}.title`,
        { x: cell.x, y: titleY, w: cell.w, h: titleH },
        { paragraphs: [item.title] },
        { ...roleStyle(slot, 'body'), fontSize: 18, bold: true },
        'body',
      ),
    );
    const descY = titleY + titleH;
    const descH = cell.y + cell.h - descY;
    if (item.description && descH > 0.05) {
      out.push(
        textPrimitive(
          `${prefix}~desc${index}`,
          slot,
          `item${index}.description`,
          { x: cell.x, y: descY, w: cell.w, h: descH },
          { paragraphs: [item.description] },
          { ...roleStyle(slot, 'body'), fontSize: 14, color: 'muted' },
          'body',
        ),
      );
    }
  });
  return out;
}

function cardsPrimitives(
  prefix: string,
  slot: LayoutSlot,
  content: Extract<SlotObject, { type: 'cards' }>,
): Primitive[] {
  const cells = gridCells(slot.box, content.items.length, slot.columns ?? DEFAULT_COLUMNS.cards, 0.3);
  const out: Primitive[] = [];
  content.items.forEach((item, index) => {
    const cell = cells[index]!;
    const part = `item${index}`;
    if (item.image) {
      const captionH = item.caption ? Math.min(CAPTION_H, cell.h * 0.3) : 0;
      out.push({
        element: {
          type: 'image',
          id: `${prefix}~image${index}`,
          x: cell.x,
          y: cell.y,
          w: cell.w,
          h: cell.h - captionH,
          asset: item.image.asset,
          alt: item.image.alt,
          fit: item.image.fit ?? 'contain',
        },
        source: { kind: 'slot', slot: slot.name, part: `${part}.image` },
      });
      if (item.caption) {
        out.push(
          textPrimitive(
            `${prefix}~caption${index}`,
            slot,
            `${part}.caption`,
            { x: cell.x, y: cell.y + cell.h - captionH, w: cell.w, h: captionH },
            { paragraphs: [item.caption] },
            { ...roleStyle(slot, 'caption'), align: 'center' },
            'caption',
          ),
        );
      }
      return;
    }
    out.push({
      element: { type: 'shape', id: `${prefix}~card${index}`, ...cell, shape: 'roundRect', fill: 'surface' },
      source: { kind: 'slot', slot: slot.name, part },
    });
    const inner = inset(cell, 0.25);
    let y = inner.y;
    const bottom = inner.y + inner.h;
    if (item.title) {
      const h = Math.min(lineHeightIn(18, 2), bottom - y);
      out.push(
        textPrimitive(
          `${prefix}~title${index}`,
          slot,
          `${part}.title`,
          { x: inner.x, y, w: inner.w, h },
          { paragraphs: [item.title] },
          { ...roleStyle(slot, 'body'), fontSize: 18, bold: true },
          'body',
        ),
      );
      y += h;
    }
    if (item.value) {
      const h = Math.min(lineHeightIn(32), bottom - y);
      out.push(
        textPrimitive(
          `${prefix}~value${index}`,
          slot,
          `${part}.value`,
          { x: inner.x, y, w: inner.w, h },
          { paragraphs: [item.value] },
          { ...roleStyle(slot, 'stat'), fontSize: 32 },
          'stat',
        ),
      );
      y += h;
    }
    const rest = bottom - y;
    if (rest > 0.05 && (item.text || item.bullets?.length)) {
      const rect = { x: inner.x, y, w: inner.w, h: rest };
      const style = { ...roleStyle(slot, 'body'), fontSize: 14 };
      if (item.text) {
        const textH = item.bullets?.length ? Math.min(rest / 2, lineHeightIn(14, 3)) : rest;
        out.push(
          textPrimitive(
            `${prefix}~text${index}`,
            slot,
            `${part}.text`,
            { ...rect, h: textH },
            { paragraphs: item.text.split(/\r?\n/) },
            style,
            'body',
          ),
        );
        rect.y += textH;
        rect.h -= textH;
      }
      if (item.bullets?.length && rect.h > 0.05) {
        out.push(
          textPrimitive(
            `${prefix}~bullets${index}`,
            slot,
            `${part}.bullets`,
            rect,
            { bullets: item.bullets },
            style,
            'body',
          ),
        );
      }
    }
  });
  return out;
}

/** Title text of a slide: the title slot (or first title-role slot), else the first text element. */
export function slideTitle(slide: Slide, layouts: LayoutRegistry): string {
  const layout = resolveLayout(layouts, slide.layout, Object.keys(slide.slots));
  const titleSlot = layout.slots.find((slot) => slot.role === 'title' || slot.role === 'display');
  const content = titleSlot ? slide.slots[titleSlot.name] : undefined;
  if (content !== undefined) return slotPlainText(content);
  const quote = Object.values(slide.slots).find(
    (value) => typeof value === 'object' && value.type === 'quote',
  );
  if (quote && typeof quote === 'object' && quote.type === 'quote') return quote.text;
  const text = slide.elements.find((element): element is TextElement => element.type === 'text');
  if (text) return elementPlainText(text);
  return '';
}

export function slotPlainText(content: SlotContent): string {
  if (typeof content === 'string') return content;
  switch (content.type) {
    case 'text':
      return content.paragraphs.map(plain).join(' ');
    case 'bullets':
      return content.items.map(plain).join(' ');
    case 'quote':
      return content.text;
    case 'image':
      return content.alt;
    case 'stats':
      return content.items.map((item) => `${item.value} ${item.label}`).join(' ');
    case 'steps':
      return content.items.map((item) => item.title).join(' ');
    case 'cards':
      return content.items.map((item) => item.title ?? item.caption ?? '').join(' ');
    case 'table':
      return (content.header ?? []).join(' ');
    case 'chart':
      return content.title ?? content.series.map((series) => series.name).join(' ');
  }
}

function plain(paragraph: Paragraph): string {
  if (typeof paragraph === 'string') return paragraph;
  return paragraph.runs ? paragraph.runs.map((run) => run.text).join('') : (paragraph.text ?? '');
}

export function elementPlainText(element: SlideElement): string {
  if (element.type === 'text') return (element.paragraphs ?? element.bullets ?? []).map(plain).join(' ');
  if (element.type === 'shape') return (element.text?.paragraphs ?? []).map(plain).join(' ');
  if (element.type === 'image') return element.alt;
  if (element.type === 'chart') return element.title ?? '';
  return (element.header ?? element.rows[0] ?? []).join(' ');
}
