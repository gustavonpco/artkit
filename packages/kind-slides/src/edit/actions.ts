import { IdAllocator } from '@artkit-ai/core';
import type { Rect } from '../geometry.js';
import { ELEMENT_ID_PREFIX, type SlidesOperation } from '../operations.js';
import type { ElementInput, Slide, SlideElement, SlidesContent } from '../schema.js';
import { type AlignMode, alignRects, clampPosition, distributeRects } from './geometry.js';

/*
 * Element actions shared by the toolbar, keyboard shortcuts and the inspector, as pure functions that return
 * kind operations (and the ids to select afterwards).
 */

export type ReorderTarget = 'front' | 'forward' | 'backward' | 'back';

export interface ActionResult {
  operations: SlidesOperation[];
  /** Elements to select once the operations are committed. */
  select: string[];
}

function deckIds(content: SlidesContent): string[] {
  return content.slides.flatMap((slide) => [slide.id, ...slide.elements.map((element) => element.id)]);
}

function selected(slide: Slide, ids: readonly string[]): SlideElement[] {
  return ids.flatMap((id) => slide.elements.filter((element) => element.id === id));
}

/**
 * Adds copies of elements to a slide with fresh deterministic ids, offset so they do not hide the originals.
 * Used by duplicate (same slide) and paste (any slide).
 */
export function cloneElementsOps(
  content: SlidesContent,
  slideId: string,
  elements: readonly SlideElement[],
  offset = 0.2,
): ActionResult {
  const ids = new IdAllocator(deckIds(content));
  const operations: SlidesOperation[] = [];
  const select: string[] = [];
  for (const element of elements) {
    const { id: _old, ...rest } = element;
    const id = ids.next(ELEMENT_ID_PREFIX[element.type]);
    const moved = clampPosition({ x: element.x + offset, y: element.y + offset, w: element.w, h: element.h });
    operations.push({
      op: 'add_element',
      slide: slideId,
      element: { ...rest, ...moved, id } as ElementInput,
    });
    select.push(id);
  }
  return { operations, select };
}

export function duplicateOps(content: SlidesContent, slide: Slide, ids: readonly string[]): ActionResult {
  return cloneElementsOps(content, slide.id, selected(slide, ids));
}

export function deleteOps(ids: readonly string[]): SlidesOperation[] {
  return ids.map((id) => ({ op: 'remove_element', element: id }));
}

/** Reorders in paint order; front/back keep the relative order of several selected elements. */
export function reorderOps(slide: Slide, ids: readonly string[], to: ReorderTarget): SlidesOperation[] {
  const order = slide.elements.map((element) => element.id).filter((id) => ids.includes(id));
  // Bringing several to front must start with the lowest so they end up in their original order.
  const sequence = to === 'back' || to === 'forward' ? [...order].reverse() : order;
  return sequence.map((id) => ({ op: 'reorder_element', element: id, to }));
}

function moveOps(elements: readonly SlideElement[], rects: readonly Rect[]): SlidesOperation[] {
  const operations: SlidesOperation[] = [];
  elements.forEach((element, index) => {
    const rect = rects[index]!;
    if (Math.abs(rect.x - element.x) > 1e-6 || Math.abs(rect.y - element.y) > 1e-6)
      operations.push({ op: 'update_element', element: element.id, set: { x: rect.x, y: rect.y } });
  });
  return operations;
}

/** One element aligns to the slide; several align to their common bounds. */
export function alignOps(slide: Slide, ids: readonly string[], mode: AlignMode): SlidesOperation[] {
  const elements = selected(slide, ids);
  return elements.length === 0 ? [] : moveOps(elements, alignRects(elements, mode));
}

export function distributeOps(
  slide: Slide,
  ids: readonly string[],
  axis: 'horizontal' | 'vertical',
): SlidesOperation[] {
  const elements = selected(slide, ids);
  return elements.length < 3 ? [] : moveOps(elements, distributeRects(elements, axis));
}

/** Serialized clipboard payload (also written to the system clipboard as text). */
export const CLIPBOARD_PREFIX = 'artkit-slides-elements:';

export function serializeElements(slide: Slide, ids: readonly string[]): string {
  return `${CLIPBOARD_PREFIX}${JSON.stringify(selected(slide, ids))}`;
}

/** Elements from a clipboard text, or undefined when it is not an artkit slides payload. */
export function parseClipboard(text: string): SlideElement[] | undefined {
  if (!text.startsWith(CLIPBOARD_PREFIX)) return undefined;
  try {
    const value = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.filter(
      (item): item is SlideElement =>
        typeof item === 'object' && item !== null && typeof (item as SlideElement).type === 'string',
    );
  } catch {
    return undefined;
  }
}
