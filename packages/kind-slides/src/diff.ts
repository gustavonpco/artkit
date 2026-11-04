import { type ChangeSummary, deepEqual, diffCollection, ellipsis } from '@artkit/core';
import { elementPlainText, slideTitle } from './compose.js';
import type { LayoutRegistry } from './layouts.js';
import type { Slide, SlideElement, SlidesContent } from './schema.js';

const SLIDE_FIELDS = ['layout', 'background', 'notes', 'hidden'] as const;

function changedKeys<T extends object>(before: T, after: T, keys?: readonly string[]): string[] {
  const all = keys ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return all.filter(
    (key) => !deepEqual((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key]),
  );
}

/**
 * Structural diff (spec §8.6) with targets matching `targets`: `slide:<id>` for slide-level fields and
 * order, `slot:<slideId>.<slot>` for slot contents, `element:<id>` for free elements, `deck` for the footer.
 */
export function diffSlides(
  before: SlidesContent,
  after: SlidesContent,
  layouts: LayoutRegistry,
  locale?: string,
): ChangeSummary[] {
  const say = (en: string, pt: string) => (locale?.toLowerCase().startsWith('pt') ? pt : en);
  const label = (slide: Slide) => {
    const title = slideTitle(slide, layouts);
    return title ? `slide ${slide.id} "${ellipsis(title, 50)}"` : `slide ${slide.id}`;
  };
  const changes = diffCollection(before.slides, after.slides, {
    prefix: 'slide',
    id: (slide) => slide.id,
    label,
    locale,
    equals: (a, b) => changedKeys(a, b, SLIDE_FIELDS).length === 0,
    describeChange: (a, b) => {
      const keys = changedKeys(a, b, SLIDE_FIELDS);
      const parts = keys.map((key) => (key === 'layout' ? `layout ${a.layout} → ${b.layout}` : key));
      return `${say('Changed', 'Alterado')} ${label(b)}: ${parts.join(', ')}.`;
    },
  });
  const beforeById = new Map(before.slides.map((slide) => [slide.id, slide]));
  for (const slide of after.slides) {
    const previous = beforeById.get(slide.id);
    if (!previous) continue;
    const slotNames = [...new Set([...Object.keys(previous.slots), ...Object.keys(slide.slots)])];
    for (const name of slotNames) {
      const a = previous.slots[name];
      const b = slide.slots[name];
      if (deepEqual(a, b)) continue;
      const target = `slot:${slide.id}.${name}`;
      if (a === undefined)
        changes.push({
          type: 'added',
          target,
          summary: say(
            `Filled slot [${name}] of slide ${slide.id}.`,
            `Slot [${name}] do slide ${slide.id} preenchido.`,
          ),
        });
      else if (b === undefined)
        changes.push({
          type: 'removed',
          target,
          summary: say(
            `Emptied slot [${name}] of slide ${slide.id}.`,
            `Slot [${name}] do slide ${slide.id} esvaziado.`,
          ),
        });
      else
        changes.push({
          type: 'changed',
          target,
          summary: say(
            `Changed slot [${name}] of slide ${slide.id}.`,
            `Slot [${name}] do slide ${slide.id} alterado.`,
          ),
        });
    }
    const elementLabel = (element: SlideElement) => {
      const text = elementPlainText(element);
      return `${element.type} ${element.id}${text ? ` "${ellipsis(text, 40)}"` : ''}`;
    };
    changes.push(
      ...diffCollection(previous.elements, slide.elements, {
        prefix: 'element',
        id: (element) => element.id,
        label: elementLabel,
        locale,
        describeChange: (a, b) => {
          const keys = changedKeys(a, b).filter((key) => key !== 'id');
          const geometry = keys.every((key) => key === 'x' || key === 'y' || key === 'w' || key === 'h');
          return geometry
            ? say(
                `Moved/resized ${elementLabel(b)} on slide ${slide.id}.`,
                `${elementLabel(b)} movido/redimensionado no slide ${slide.id}.`,
              )
            : say(
                `Changed ${elementLabel(b)} on slide ${slide.id}: ${keys.join(', ')}.`,
                `${elementLabel(b)} alterado no slide ${slide.id}: ${keys.join(', ')}.`,
              );
        },
      }),
    );
  }
  if (!deepEqual(before.footer, after.footer)) {
    changes.push({
      type: before.footer === undefined ? 'added' : after.footer === undefined ? 'removed' : 'changed',
      target: 'deck',
      summary:
        after.footer === undefined
          ? say('Removed the deck footer.', 'Rodapé da apresentação removido.')
          : say('Changed the deck footer.', 'Rodapé da apresentação alterado.'),
    });
  }
  if (before.size !== after.size)
    changes.push({
      type: 'changed',
      target: 'deck',
      summary: `${say('Size', 'Tamanho')} ${before.size} → ${after.size}.`,
    });
  return changes;
}
