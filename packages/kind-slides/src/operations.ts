import { type ApplyContext, itemIdSchema } from '@artkit-ai/core';
import { z } from 'zod';
import { slotPrimitives } from './compose.js';
import { checkElement } from './elements.js';
import { CANVAS } from './geometry.js';
import { tr } from './i18n.js';
import {
  isTitleRole,
  type LayoutDefinition,
  type LayoutRegistry,
  type LayoutSlot,
  type TypographyRole,
} from './layouts.js';
import {
  backgroundSchema,
  type ElementInput,
  elementInputSchema,
  elementPatchSchema,
  elementSchema,
  footerSchema,
  layoutNameSchema,
  type Slide,
  type SlideElement,
  type SlidesContent,
  type SlotContent,
  slideInputSchema,
  slotContentKind,
  slotContentSchema,
  slotNameSchema,
} from './schema.js';
import { checkSlotContent } from './validate.js';

const slideRef = itemIdSchema.describe('Slide id.');
const elementRef = itemIdSchema.describe('Element id (unique in the whole deck).');
const position = z.number().int().min(1).describe('1-based position in the deck.');

export const slidesOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add_slide'),
      slide: slideInputSchema,
      after: slideRef.optional().describe('Insert after this slide (default: at the end).'),
      position: position.optional(),
    })
    .strict()
    .describe('Adds a slide with a layout and slot contents.'),
  z.object({ op: z.literal('remove_slide'), slide: slideRef }).strict(),
  z
    .object({
      op: z.literal('move_slide'),
      slide: slideRef,
      after: slideRef.optional(),
      position: position.optional(),
    })
    .strict()
    .refine((op) => (op.after === undefined) !== (op.position === undefined), {
      message: 'Give exactly one of "after" or "position".',
    }),
  z
    .object({
      op: z.literal('duplicate_slide'),
      slide: slideRef,
      id: itemIdSchema.optional().describe('Id of the copy (generated when omitted).'),
      after: slideRef
        .optional()
        .describe('Insert the copy after this slide (default: right after the source).'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_layout'),
      slide: slideRef,
      layout: layoutNameSchema,
      orphans: z
        .enum(['elements', 'drop'])
        .optional()
        .describe(
          'What happens to slot contents the new layout cannot hold: become free elements (default) or are dropped.',
        ),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_slot'),
      slide: slideRef,
      slot: slotNameSchema,
      content: slotContentSchema.nullable().describe('New content; null empties the slot.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_notes'),
      slide: slideRef,
      notes: z.string().max(20000).describe('"" clears the notes.'),
    })
    .strict(),
  z
    .object({ op: z.literal('set_background'), slide: slideRef, background: backgroundSchema.nullable() })
    .strict(),
  z.object({ op: z.literal('set_hidden'), slide: slideRef, hidden: z.boolean() }).strict(),
  z
    .object({
      op: z.literal('add_element'),
      slide: slideRef,
      element: elementInputSchema,
      position: z.enum(['front', 'back']).optional().describe('Stacking position (default front).'),
    })
    .strict(),
  z.object({ op: z.literal('update_element'), element: elementRef, set: elementPatchSchema }).strict(),
  z.object({ op: z.literal('remove_element'), element: elementRef }).strict(),
  z
    .object({
      op: z.literal('reorder_element'),
      element: elementRef,
      to: z.enum(['front', 'back', 'forward', 'backward']),
    })
    .strict(),
  z.object({ op: z.literal('set_footer'), footer: footerSchema.nullable() }).strict(),
]);

export type SlidesOperation = z.infer<typeof slidesOperationSchema>;

export const ELEMENT_ID_PREFIX: Record<SlideElement['type'], string> = {
  text: 'txt',
  shape: 'shp',
  image: 'img',
  table: 'tbl',
  chart: 'cht',
};

/** Item targets an operation touches, in the same vocabulary as `diff` (spec §8.3). */
export function slidesOperationTargets(op: SlidesOperation): string[] {
  switch (op.op) {
    case 'add_slide':
      return [`slide:${op.slide.id ?? '+'}`];
    case 'duplicate_slide':
      return [`slide:${op.slide}`, `slide:${op.id ?? '+'}`];
    case 'set_slot':
      return [`slot:${op.slide}.${op.slot}`];
    case 'remove_slide':
    case 'move_slide':
    case 'set_layout':
    case 'set_notes':
    case 'set_background':
    case 'set_hidden':
      return [`slide:${op.slide}`];
    case 'add_element':
      return [`element:${op.element.id ?? '+'}`];
    case 'update_element':
    case 'remove_element':
    case 'reorder_element':
      return [`element:${op.element}`];
    case 'set_footer':
      return ['deck'];
  }
}

interface Located {
  slide: Slide;
  slideIndex: number;
  index: number;
  element: SlideElement;
}

const MAX_COPY_PREFIX = 48;

function copyPrefix(id: string): string {
  return `${id.slice(0, MAX_COPY_PREFIX)}-copy`;
}

/** Creates the pure `apply` for a layout registry. */
export function createApply(layouts: LayoutRegistry) {
  return function apply(draft: SlidesContent, op: SlidesOperation, ctx: ApplyContext): void {
    const t = (en: string, pt: string) => tr(ctx.locale, en, pt);
    const slideIds = () =>
      draft.slides.map((slide) => slide.id).join(', ') || t('(no slides)', '(nenhum slide)');

    const findSlide = (id: string, path: string): number => {
      const index = draft.slides.findIndex((slide) => slide.id === id);
      if (index < 0) {
        ctx.fail(t(`Slide "${id}" does not exist.`, `O slide "${id}" não existe.`), {
          hint: t(`Use an id from the projection: ${slideIds()}.`, `Use um id da projeção: ${slideIds()}.`),
          path,
        });
      }
      return index;
    };

    const findElement = (id: string, path: string): Located => {
      for (const [slideIndex, slide] of draft.slides.entries()) {
        const index = slide.elements.findIndex((element) => element.id === id);
        if (index >= 0) return { slide, slideIndex, index, element: slide.elements[index]! };
      }
      return ctx.fail(t(`Element "${id}" does not exist.`, `O elemento "${id}" não existe.`), {
        hint: t(
          'Read the slide projection to get element ids (#id).',
          'Leia a projeção do slide para obter os ids dos elementos (#id).',
        ),
        path,
      });
    };

    const layoutOf = (name: string, path: string): LayoutDefinition => {
      const layout = layouts.get(name);
      if (!layout) {
        ctx.fail(t(`Unknown layout "${name}".`, `Layout "${name}" desconhecido.`), {
          hint: t(
            `Use one of: ${layouts.names().join(', ')}.`,
            `Use um destes: ${layouts.names().join(', ')}.`,
          ),
          path,
        });
      }
      return layout;
    };

    const claimId = (id: string | undefined, prefix: string, path: string): string => {
      if (id === undefined) return ctx.nextId(prefix);
      if (ctx.hasId(id)) {
        ctx.fail(t(`Id "${id}" is already used in this deck.`, `O id "${id}" já está em uso neste deck.`), {
          hint: t(
            'Ids are unique across the whole deck; choose another id or omit it.',
            'Ids são únicos no deck inteiro; escolha outro id ou omita-o.',
          ),
          path,
        });
      }
      ctx.reserveId(id);
      return id;
    };

    const checkGeometry = (element: SlideElement, path: string) => {
      const problem = checkElement(element, CANVAS)[0];
      if (problem)
        ctx.fail(problem.message, {
          ...(problem.hint ? { hint: problem.hint } : {}),
          path: `${path}.${problem.path}`,
        });
    };

    const materialize = (input: ElementInput, path: string): SlideElement => {
      const id = claimId(input.id, ELEMENT_ID_PREFIX[input.type], `${path}.id`);
      const element = { ...input, id } as SlideElement;
      checkGeometry(element, path);
      return element;
    };

    const insertionIndex = (
      after: string | undefined,
      pos: number | undefined,
      length: number,
      path: string,
    ): number => {
      const at = (field: string) => (path ? `${path}.${field}` : field);
      if (after !== undefined) return findSlide(after, at('after')) + 1;
      if (pos !== undefined) {
        if (pos > length + 1) {
          ctx.fail(
            t(
              `Position ${pos} is past the end of the deck (${length} slides).`,
              `A posição ${pos} passa do fim do deck (${length} slides).`,
            ),
            {
              hint: t(
                `Use a position between 1 and ${length + 1}.`,
                `Use uma posição entre 1 e ${length + 1}.`,
              ),
              path: at('position'),
            },
          );
        }
        return pos - 1;
      }
      return length;
    };

    switch (op.op) {
      case 'add_slide': {
        const input = op.slide;
        const layout = layoutOf(input.layout, 'slide.layout');
        for (const [name, value] of Object.entries(input.slots)) {
          const problem = checkSlotContent(layout, name, value);
          if (problem)
            ctx.fail(problem.message, {
              hint: problem.hint,
              path: `slide.slots.${name}${problem.path ? `.${problem.path}` : ''}`,
            });
        }
        const at = insertionIndex(op.after, op.position, draft.slides.length, '');
        const id = claimId(input.id, 's', 'slide.id');
        const elements = input.elements.map((element, index) =>
          materialize(element, `slide.elements[${index}]`),
        );
        const slide: Slide = { ...input, id, elements };
        draft.slides.splice(at, 0, slide);
        return;
      }
      case 'remove_slide':
        draft.slides.splice(findSlide(op.slide, 'slide'), 1);
        return;
      case 'move_slide': {
        const from = findSlide(op.slide, 'slide');
        if (op.after === op.slide) {
          ctx.fail(
            t(
              'A slide cannot be moved after itself.',
              'Um slide não pode ser movido para depois de si mesmo.',
            ),
            { path: 'after' },
          );
        }
        const [slide] = draft.slides.splice(from, 1);
        const at = insertionIndex(op.after, op.position, draft.slides.length, '');
        draft.slides.splice(at, 0, slide!);
        return;
      }
      case 'duplicate_slide': {
        const index = findSlide(op.slide, 'slide');
        const source = draft.slides[index]!;
        const copy = structuredClone(source);
        copy.id = claimId(op.id, copyPrefix(source.id), 'id');
        copy.elements = copy.elements.map((element) => ({
          ...element,
          id: ctx.nextId(copyPrefix(element.id)),
        }));
        const at = op.after !== undefined ? findSlide(op.after, 'after') + 1 : index + 1;
        draft.slides.splice(at, 0, copy);
        return;
      }
      case 'set_layout': {
        const slide = draft.slides[findSlide(op.slide, 'slide')]!;
        const target = layoutOf(op.layout, 'layout');
        const previous = layouts.get(slide.layout);
        const { slots, orphans } = migrateSlots(slide.slots, previous, target);
        slide.layout = target.name;
        slide.slots = slots;
        if (op.orphans !== 'drop') {
          for (const orphan of orphans) {
            for (const primitive of slotPrimitives(slide.id, orphan.slot, orphan.content)) {
              const { element } = primitive;
              slide.elements.push({
                ...element,
                id: ctx.nextId(ELEMENT_ID_PREFIX[element.type]),
              } as SlideElement);
            }
          }
        }
        return;
      }
      case 'set_slot': {
        const slide = draft.slides[findSlide(op.slide, 'slide')]!;
        if (op.content === null) {
          delete slide.slots[op.slot];
          return;
        }
        const layout = layoutOf(slide.layout, 'slide');
        const problem = checkSlotContent(layout, op.slot, op.content);
        if (problem) {
          ctx.fail(problem.message, {
            hint: problem.hint,
            path: problem.path ? `content.${problem.path}` : problem.field,
          });
        }
        slide.slots[op.slot] = op.content;
        return;
      }
      case 'set_notes': {
        const slide = draft.slides[findSlide(op.slide, 'slide')]!;
        if (op.notes === '') delete slide.notes;
        else slide.notes = op.notes;
        return;
      }
      case 'set_background': {
        const slide = draft.slides[findSlide(op.slide, 'slide')]!;
        if (op.background === null || Object.keys(op.background).length === 0) delete slide.background;
        else slide.background = op.background;
        return;
      }
      case 'set_hidden': {
        const slide = draft.slides[findSlide(op.slide, 'slide')]!;
        if (op.hidden) slide.hidden = true;
        else delete slide.hidden;
        return;
      }
      case 'add_element': {
        const slide = draft.slides[findSlide(op.slide, 'slide')]!;
        const element = materialize(op.element, 'element');
        if (op.position === 'back') slide.elements.unshift(element);
        else slide.elements.push(element);
        return;
      }
      case 'update_element': {
        const located = findElement(op.element, 'element');
        const merged: Record<string, unknown> = { ...located.element };
        const set = op.set as Record<string, unknown>;
        for (const [key, value] of Object.entries(set)) {
          if (value === undefined) continue;
          if (value === null) delete merged[key];
          else merged[key] = value;
        }
        // Text elements hold exactly one of paragraphs/bullets: setting one replaces the other.
        if (located.element.type === 'text') {
          if (set.paragraphs) delete merged.bullets;
          if (set.bullets) delete merged.paragraphs;
        }
        const parsed = elementSchema.safeParse(merged);
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          if (issue.code === 'unrecognized_keys') {
            const keys = (issue as { keys?: string[] }).keys ?? [];
            ctx.fail(
              t(
                `Field(s) ${keys.join(', ')} do not apply to ${located.element.type} elements.`,
                `Campo(s) ${keys.join(', ')} não se aplicam a elementos ${located.element.type}.`,
              ),
              {
                hint: t('Remove those fields from "set".', 'Remova esses campos de "set".'),
                path: `set.${keys[0] ?? ''}`,
              },
            );
          }
          const field = issue.path.length > 0 ? `set.${issue.path.join('.')}` : 'set';
          ctx.fail(issue.message, {
            hint: t(
              'Fix the field so the element stays valid.',
              'Corrija o campo para que o elemento continue válido.',
            ),
            path: field,
          });
        }
        checkGeometry(parsed.data, 'set');
        located.slide.elements[located.index] = parsed.data;
        return;
      }
      case 'remove_element': {
        const located = findElement(op.element, 'element');
        located.slide.elements.splice(located.index, 1);
        return;
      }
      case 'reorder_element': {
        const { slide, index, element } = findElement(op.element, 'element');
        const last = slide.elements.length - 1;
        const to =
          op.to === 'front'
            ? last
            : op.to === 'back'
              ? 0
              : op.to === 'forward'
                ? Math.min(last, index + 1)
                : Math.max(0, index - 1);
        slide.elements.splice(index, 1);
        slide.elements.splice(to, 0, element);
        return;
      }
      case 'set_footer': {
        if (op.footer === null || (!op.footer.text && !op.footer.slideNumber)) delete draft.footer;
        else draft.footer = op.footer;
        return;
      }
    }
  };
}

function roleFamily(role: TypographyRole): string {
  if (isTitleRole(role)) return 'title';
  if (role === 'subtitle' || role === 'heading') return 'subtitle';
  return role;
}

export interface SlotMigration {
  slots: Record<string, SlotContent>;
  /** Contents the new layout cannot hold, with the old slot they came from (for conversion to elements). */
  orphans: { slot: LayoutSlot; content: SlotContent }[];
}

/**
 * Moves slot contents to equivalent slots of another layout: same name first, then same typography family
 * (title ↔ title), then any free slot that accepts the content kind, in layout order.
 */
export function migrateSlots(
  slots: Record<string, SlotContent>,
  from: LayoutDefinition | undefined,
  to: LayoutDefinition,
): SlotMigration {
  const result: Record<string, SlotContent> = {};
  const orphans: SlotMigration['orphans'] = [];
  const taken = new Set<string>();
  const pending: { name: string; content: SlotContent; slot: LayoutSlot | undefined }[] = [];
  const order = from ? from.slots.map((slot) => slot.name).filter((name) => name in slots) : [];
  for (const name of Object.keys(slots)) if (!order.includes(name)) order.push(name);
  for (const name of order) {
    const content = slots[name]!;
    const kind = slotContentKind(content);
    const same = to.slots.find((slot) => slot.name === name && slot.accepts.includes(kind));
    if (same) {
      result[name] = content;
      taken.add(name);
    } else pending.push({ name, content, slot: from?.slots.find((slot) => slot.name === name) });
  }
  for (const item of pending) {
    const kind = slotContentKind(item.content);
    const free = to.slots.filter((slot) => !taken.has(slot.name) && slot.accepts.includes(kind));
    const family = item.slot ? roleFamily(item.slot.role) : undefined;
    const target =
      free.find((slot) => family !== undefined && roleFamily(slot.role) === family) ??
      free.find((slot) => !isTitleRole(slot.role) || family === 'title');
    if (target) {
      result[target.name] = item.content;
      taken.add(target.name);
    } else if (item.slot) {
      orphans.push({ slot: item.slot, content: item.content });
    }
  }
  return { slots: result, orphans };
}
