import type { AdapterContext } from '@artkit-ai/core';
import { z } from 'zod';
import { bodyText, type MarkdownDocument, type Section, slugifyTitle, subtreeEnd } from './document.js';

const anchorSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'Anchors use letters, digits, "_" or "-" (max 64).')
  .describe('Section anchor from the outline, e.g. "escopo".');

const headingLevel = z.number().int().min(1).max(6);

export const markdownOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('replace_text'),
      section: anchorSchema,
      find: z.string().min(1).describe('Exact snippet to replace; must occur once in the section body.'),
      replace: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal('replace_section'),
      section: anchorSchema,
      body: z.string().describe('New body of the section, without its heading (subsections are kept).'),
    })
    .strict(),
  z
    .object({
      op: z.literal('insert_section'),
      after: anchorSchema
        .optional()
        .describe('Anchor of the section after which the new one goes; omit to append at the end.'),
      title: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .refine((title) => !title.includes('\n'), 'Titles are one line.'),
      level: headingLevel
        .optional()
        .describe('Heading level 1-6; defaults to the level of the "after" section.'),
      anchor: anchorSchema.optional().describe('Explicit anchor, kept on renames.'),
      body: z.string().default(''),
    })
    .strict(),
  z.object({ op: z.literal('remove_section'), section: anchorSchema }).strict(),
  z
    .object({
      op: z.literal('move_section'),
      section: anchorSchema,
      after: anchorSchema.describe('Anchor of the section after which the moved subtree goes.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('rename_section'),
      section: anchorSchema,
      title: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .refine((title) => !title.includes('\n'), 'Titles are one line.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_frontmatter'),
      set: z
        .record(
          z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/),
          z.string().refine((v) => !v.includes('\n'), 'One line per value.'),
        )
        .optional(),
      remove: z.array(z.string()).optional(),
    })
    .strict(),
  z.object({ op: z.literal('append'), body: z.string().min(1) }).strict(),
]);

export type MarkdownOperation = z.infer<typeof markdownOperationSchema>;

export const MARKDOWN_OPERATION_NAMES = [
  'replace_text',
  'replace_section',
  'insert_section',
  'remove_section',
  'move_section',
  'rename_section',
  'set_frontmatter',
  'append',
] as const;

export interface ApplyOutcome {
  createdRefs: string[];
}

function lines(text: string): string[] {
  const trimmed = text.replace(/\n+$/, '');
  return trimmed === '' ? [] : trimmed.split('\n');
}

function indexOf(document: MarkdownDocument, anchor: string, ctx: AdapterContext, path: string): number {
  const index = document.sections.findIndex((section) => section.anchor === anchor);
  if (index < 0) {
    ctx.fail(`A seção "${anchor}" não existe.`, {
      path,
      hint: 'Leia o outline do artefato e use uma âncora listada nele.',
    });
  }
  return index;
}

/** Anchor for a new or renamed section: explicit when given, otherwise derived from the title without touching others. */
function freshAnchor(title: string, sections: readonly Section[], ignore?: Section): string {
  const taken = new Set(sections.filter((section) => section !== ignore).map((section) => section.anchor));
  const base = slugifyTitle(title);
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}-${n++}`;
  return candidate;
}

/**
 * Applies one operation on the parsed document, in place. Throws through `ctx.fail` with a model-facing hint.
 * Automatic anchors of untouched sections never change; only the sections an operation creates or renames get new ones.
 */
export function applyMarkdownOperation(
  document: MarkdownDocument,
  op: MarkdownOperation,
  ctx: AdapterContext,
  index: number,
): ApplyOutcome {
  const sections = document.sections;
  switch (op.op) {
    case 'replace_text': {
      const at = indexOf(document, op.section, ctx, 'section');
      const section = sections[at]!;
      const text = bodyText(section);
      const occurrences = text.split(op.find).length - 1;
      if (occurrences !== 1) {
        ctx.fail(`O trecho aparece ${occurrences} vezes na seção "${op.section}".`, {
          path: 'find',
          hint: 'Inclua mais contexto no trecho para torná-lo único dentro da seção.',
        });
      }
      section.body = lines(text.replace(op.find, op.replace));
      return { createdRefs: [] };
    }
    case 'replace_section': {
      const at = indexOf(document, op.section, ctx, 'section');
      sections[at]!.body = op.body === '' ? [] : lines(op.body);
      return { createdRefs: [] };
    }
    case 'insert_section': {
      const level = op.level ?? (op.after ? sections[indexOf(document, op.after, ctx, 'after')]!.level : 2);
      if (op.anchor && sections.some((section) => section.anchor === op.anchor)) {
        ctx.fail(`A âncora "${op.anchor}" já existe.`, {
          path: 'anchor',
          hint: 'Escolha outra âncora ou omita o campo para gerar uma a partir do título.',
        });
      }
      const section: Section = {
        anchor: op.anchor ?? freshAnchor(op.title, sections),
        explicit: op.anchor !== undefined,
        level,
        title: op.title,
        body: op.body === '' ? [] : lines(op.body),
      };
      if (!section.explicit && sections.some((other) => other.anchor === section.anchor)) {
        section.anchor = freshAnchor(op.title, sections);
      }
      const position =
        op.after === undefined
          ? sections.length
          : subtreeEnd(sections, indexOf(document, op.after, ctx, 'after'));
      sections.splice(position, 0, section);
      return { createdRefs: [section.anchor] };
    }
    case 'remove_section': {
      const at = indexOf(document, op.section, ctx, 'section');
      sections.splice(at, subtreeEnd(sections, at) - at);
      return { createdRefs: [] };
    }
    case 'move_section': {
      const from = indexOf(document, op.section, ctx, 'section');
      const to = subtreeEnd(sections, from);
      const target = indexOf(document, op.after, ctx, 'after');
      if (target >= from && target < to) {
        ctx.fail(`A seção "${op.after}" está dentro da subárvore movida.`, {
          path: 'after',
          hint: `Escolha uma seção fora da subárvore de "${op.section}".`,
        });
      }
      const moved = sections.splice(from, to - from);
      const anchorAfter = sections.findIndex((section) => section.anchor === op.after);
      sections.splice(subtreeEnd(sections, anchorAfter), 0, ...moved);
      return { createdRefs: [] };
    }
    case 'rename_section': {
      const at = indexOf(document, op.section, ctx, 'section');
      const section = sections[at]!;
      section.title = op.title;
      if (!section.explicit) section.anchor = freshAnchor(op.title, sections, section);
      return { createdRefs: [] };
    }
    case 'set_frontmatter': {
      const entries = document.frontMatter;
      for (const [key, value] of Object.entries(op.set ?? {})) {
        const existing = entries.find((entry) => entry.key === key);
        if (existing) existing.value = value;
        else entries.push({ key, value });
      }
      const remove = new Set(op.remove ?? []);
      document.frontMatter = entries.filter((entry) => !remove.has(entry.key));
      return { createdRefs: [] };
    }
    case 'append': {
      const last = sections[sections.length - 1];
      const target = last ? last.body : document.preamble;
      if (target.length > 0 && target[target.length - 1] !== '') target.push('');
      target.push(...lines(op.body));
      return { createdRefs: [] };
    }
    default:
      ctx.fail(`Operação ${index} desconhecida.`, { hint: 'Use uma das operações listadas nas instruções.' });
  }
}
