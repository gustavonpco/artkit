import { IdAllocator, type IdContext, ITEM_ID_PATTERN } from '@artkit-ai/core';
import { ELEMENT_ID_PREFIX } from './operations.js';
import {
  backgroundSchema,
  elementInputSchema,
  footerSchema,
  LAYOUT_NAME_PATTERN,
  type Slide,
  type SlideElement,
  type SlidesContent,
  type SlotContent,
  slideSchema,
  slotContentSchema,
} from './schema.js';
import { isRecord } from './util.js';

function elementPrefix(type: unknown): string {
  return typeof type === 'string' && type in ELEMENT_ID_PREFIX
    ? ELEMENT_ID_PREFIX[type as SlideElement['type']]
    : 'el';
}

/** Fills missing slide and element ids deterministically (ids are optional on creation, spec §6.2). */
export function normalizeSlides(raw: unknown, ctx: IdContext): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.slides)) return raw;
  for (const slide of raw.slides) {
    if (!isRecord(slide)) continue;
    if (slide.id === undefined) slide.id = ctx.nextId('s');
    if (!Array.isArray(slide.elements)) continue;
    for (const element of slide.elements) {
      if (isRecord(element) && element.id === undefined) element.id = ctx.nextId(elementPrefix(element.type));
    }
  }
  return raw;
}

function collectIds(slides: unknown[]): string[] {
  const ids: string[] = [];
  for (const slide of slides) {
    if (!isRecord(slide)) continue;
    if (typeof slide.id === 'string') ids.push(slide.id);
    if (Array.isArray(slide.elements))
      for (const element of slide.elements)
        if (isRecord(element) && typeof element.id === 'string') ids.push(element.id);
  }
  return ids;
}

/**
 * Streaming preview (spec §13.4): keeps every slide that can be salvaged, drops the incomplete trailing one
 * and any invalid slot or element inside a slide, and fills missing or duplicated ids.
 */
export function parsePartialSlides(
  raw: unknown,
  knownLayout: (name: string) => boolean = () => true,
): SlidesContent | undefined {
  if (!isRecord(raw)) return undefined;
  const source = Array.isArray(raw.slides) ? raw.slides : [];
  const allocator = new IdAllocator(collectIds(source));
  const used = new Set<string>();
  const claim = (id: unknown, prefix: string): string => {
    if (typeof id === 'string' && ITEM_ID_PATTERN.test(id) && !used.has(id)) {
      used.add(id);
      return id;
    }
    const next = allocator.next(prefix);
    used.add(next);
    return next;
  };
  const slides: Slide[] = [];
  for (const item of source) {
    const slide = salvageSlide(item, claim, knownLayout);
    if (slide) slides.push(slide);
  }
  const footer = footerSchema.safeParse(raw.footer);
  return {
    size: '16:9',
    slides,
    ...(raw.footer !== undefined && footer.success ? { footer: footer.data } : {}),
  };
}

function salvageSlide(
  raw: unknown,
  claim: (id: unknown, prefix: string) => string,
  knownLayout: (name: string) => boolean,
): Slide | undefined {
  // A layout name still being streamed ("ti" for "title") is unknown: the slide is not ready yet.
  if (
    !isRecord(raw) ||
    typeof raw.layout !== 'string' ||
    !LAYOUT_NAME_PATTERN.test(raw.layout) ||
    !knownLayout(raw.layout)
  )
    return undefined;
  const slots: Record<string, SlotContent> = {};
  if (isRecord(raw.slots)) {
    for (const [name, value] of Object.entries(raw.slots)) {
      const parsed = slotContentSchema.safeParse(value);
      if (parsed.success) slots[name] = parsed.data;
    }
  }
  const elements: SlideElement[] = [];
  if (Array.isArray(raw.elements)) {
    for (const value of raw.elements) {
      const parsed = elementInputSchema.safeParse(value);
      if (parsed.success)
        elements.push({
          ...parsed.data,
          id: claim(parsed.data.id, elementPrefix(parsed.data.type)),
        } as SlideElement);
    }
  }
  const background = backgroundSchema.safeParse(raw.background);
  const candidate = {
    id: claim(raw.id, 's'),
    layout: raw.layout,
    slots,
    elements,
    ...(raw.background !== undefined && background.success ? { background: background.data } : {}),
    ...(typeof raw.notes === 'string' ? { notes: raw.notes.slice(0, 20000) } : {}),
    ...(typeof raw.hidden === 'boolean' ? { hidden: raw.hidden } : {}),
  };
  const parsed = slideSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
