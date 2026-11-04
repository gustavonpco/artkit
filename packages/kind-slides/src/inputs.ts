import { ArtifactError, type ContentInput } from '@artkit/core';
import { z } from 'zod';
import { tr } from './i18n.js';
import type { Paragraph, Slide, SlidesContent, SlotContent } from './schema.js';

interface Draft {
  heading: 1 | 2;
  title: string;
  body: Paragraph[];
  notes: string[];
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function toSlide(draft: Draft, index: number): Slide {
  const id = `s${index + 1}`;
  const notes = draft.notes.join('\n').trim();
  const base = { id, elements: [], ...(notes ? { notes } : {}) };
  const plain = draft.body.every((paragraph) => typeof paragraph === 'string');
  if (draft.heading === 2) {
    const slots: Record<string, SlotContent> = { title: draft.title };
    if (draft.body.length > 0 && plain) slots.subtitle = (draft.body as string[]).join('\n');
    return { ...base, layout: 'section', slots };
  }
  if (draft.body.length === 0 || (index === 0 && plain)) {
    const slots: Record<string, SlotContent> = { title: draft.title };
    if (draft.body.length > 0) slots.subtitle = (draft.body as string[]).join('\n');
    return { ...base, layout: 'title', slots };
  }
  const allBullets = draft.body.every(
    (paragraph) => typeof paragraph === 'object' && paragraph.list === 'bullet',
  );
  const body: SlotContent = allBullets
    ? {
        type: 'bullets',
        items: draft.body.map((paragraph) => {
          const p = paragraph as Exclude<Paragraph, string>;
          return p.level ? { text: p.text ?? '', level: p.level } : (p.text ?? '');
        }),
      }
    : { type: 'text', paragraphs: draft.body };
  return { ...base, layout: 'title-content', slots: { title: draft.title, body } };
}

/** Deterministic conversion of a Markdown-like outline into slides. */
export function outlineToSlides(input: string, locale = 'en'): SlidesContent {
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (heading) {
      current = { heading: heading[1]!.length as 1 | 2, title: heading[2]!.trim(), body: [], notes: [] };
      drafts.push(current);
      continue;
    }
    if (!current || line.trim() === '') continue;
    const note = /^>\s?(.*)$/.exec(line.trim());
    if (note) {
      current.notes.push(note[1]!);
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const level = Math.min(4, Math.floor(item[1]!.replace(/\t/g, '  ').length / 2));
      const list = /^\d/.test(item[2]!) ? 'number' : 'bullet';
      current.body.push({ text: item[3]!.trim(), list, ...(level > 0 ? { level } : {}) });
      continue;
    }
    current.body.push(line.trim());
  }
  if (drafts.length === 0) {
    const message = tr(locale, 'The outline has no slides.', 'O roteiro não tem slides.');
    throw new ArtifactError('INVALID_CONTENT', message, {
      issues: [
        {
          path: 'input',
          message,
          hint: tr(
            locale,
            'Start each slide with a "# Title" line.',
            'Comece cada slide com uma linha "# Título".',
          ),
        },
      ],
    });
  }
  return { size: '16:9', slides: drafts.map(toSlide) };
}

export const outlineInput: ContentInput<SlidesContent> = {
  description:
    'Markdown-like outline: "# Title" starts a slide (the first one becomes the title slide), "## Title" a section slide, "- item" bullets (indent 2 spaces per level), "1. item" numbered items, plain lines paragraphs, "> text" speaker notes.',
  schema: z.string().min(1).max(200_000),
  toContent: (input, ctx) => outlineToSlides(String(input), ctx.locale),
};
