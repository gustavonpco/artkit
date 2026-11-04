import type { ErrorIssue } from '@artkit-ai/core';
import { checkChartFields, checkElement, checkTableFields } from './elements.js';
import { CANVAS } from './geometry.js';
import type { LayoutDefinition, LayoutRegistry } from './layouts.js';
import { type SlidesContent, type SlotContent, slotContentKind } from './schema.js';

export interface SlotProblem {
  message: string;
  hint: string;
  /** Which part of a `set_slot` call is wrong. */
  field: 'slot' | 'content';
  /** Path relative to the slot content. */
  path?: string;
}

/** Checks that a slot exists in the layout and accepts the content kind. */
export function checkSlotContent(
  layout: LayoutDefinition,
  slotName: string,
  content: SlotContent,
): SlotProblem | undefined {
  const slot = layout.slots.find((candidate) => candidate.name === slotName);
  if (!slot) {
    const names = layout.slots.map((candidate) => candidate.name);
    return {
      message: `Layout "${layout.name}" has no slot "${slotName}".`,
      hint:
        names.length > 0
          ? `Use one of: ${names.join(', ')}. For other positions use a free element.`
          : 'This layout has no slots; use free elements.',
      field: 'slot',
    };
  }
  const kind = slotContentKind(content);
  if (!slot.accepts.includes(kind)) {
    return {
      message: `Slot "${slotName}" of layout "${layout.name}" does not accept ${kind} content.`,
      hint: `Slot "${slotName}" accepts: ${slot.accepts.join(', ')}.`,
      field: 'content',
    };
  }
  if (typeof content === 'object' && content.type === 'table') {
    const problem = checkTableFields(content)[0];
    if (problem)
      return { message: problem.message, hint: problem.hint ?? '', field: 'content', path: problem.path };
  }
  if (typeof content === 'object' && content.type === 'chart') {
    const problem = checkChartFields(content)[0];
    if (problem)
      return { message: problem.message, hint: problem.hint ?? '', field: 'content', path: problem.path };
  }
  return undefined;
}

/** Integrity rules beyond the schema (spec §10.1). Paths are relative to the content. */
export function validateSlides(content: SlidesContent, layouts: LayoutRegistry): ErrorIssue[] {
  const issues: ErrorIssue[] = [];
  content.slides.forEach((slide, slideIndex) => {
    const base = `slides[${slideIndex}]`;
    const layout = layouts.get(slide.layout);
    if (!layout) {
      issues.push({
        path: `${base}.layout`,
        message: `Unknown layout "${slide.layout}".`,
        hint: `Use one of: ${layouts.names().join(', ')}.`,
      });
    } else {
      for (const [slotName, value] of Object.entries(slide.slots)) {
        const problem = checkSlotContent(layout, slotName, value);
        if (problem) {
          issues.push({
            path: `${base}.slots.${slotName}${problem.path ? `.${problem.path}` : ''}`,
            message: problem.message,
            hint: problem.hint,
          });
        }
      }
    }
    slide.elements.forEach((element, elementIndex) => {
      for (const problem of checkElement(element, CANVAS)) {
        issues.push({
          path: `${base}.elements[${elementIndex}].${problem.path}`,
          message: problem.message,
          ...(problem.hint ? { hint: problem.hint } : {}),
        });
      }
    });
  });
  return issues;
}
