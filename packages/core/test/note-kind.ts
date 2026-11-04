import { z } from 'zod';
import {
  type ArtifactKind,
  defineKind,
  diffCollection,
  ellipsis,
  itemIdSchema,
  projectItems,
} from '../src/index.js';

const itemSchema = z.object({ id: itemIdSchema, text: z.string().max(500) }).strict();
const contentSchema = z.object({ items: z.array(itemSchema) }).strict();
type Content = z.infer<typeof contentSchema>;

const operationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      after: itemIdSchema.optional(),
      id: itemIdSchema.optional(),
      text: z.string().max(500),
    })
    .strict(),
  z.object({ op: z.literal('edit'), id: itemIdSchema, text: z.string().max(500) }).strict(),
  z.object({ op: z.literal('remove'), id: itemIdSchema }).strict(),
]);
type Operation = z.infer<typeof operationSchema>;

/** Tiny kind used to test the core: an ordered list of paragraphs. */
export const noteKind: ArtifactKind<Content, Operation> = defineKind<Content, Operation>({
  kind: 'note',
  version: 2,
  label: 'Note',
  contentSchema,
  operationSchema,
  empty: () => ({ items: [] }),
  normalize(raw, ctx) {
    const value = raw as { items?: { id?: string }[] };
    for (const item of value?.items ?? [])
      if (item && typeof item === 'object' && !item.id) item.id = ctx.nextId('n');
    return raw;
  },
  apply(draft, op, ctx) {
    const index = (id: string) => {
      const found = draft.items.findIndex((item) => item.id === id);
      if (found < 0)
        ctx.fail(`Item "${id}" does not exist.`, { hint: 'Use an id from the projection.', path: 'id' });
      return found;
    };
    switch (op.op) {
      case 'add': {
        if (op.id && ctx.hasId(op.id)) ctx.fail(`Id "${op.id}" already exists.`, { path: 'id' });
        const id = op.id ?? ctx.nextId('n');
        ctx.reserveId(id);
        const position = op.after ? index(op.after) + 1 : 0;
        draft.items.splice(position, 0, { id, text: op.text });
        break;
      }
      case 'edit':
        draft.items[index(op.id)]!.text = op.text;
        break;
      case 'remove':
        draft.items.splice(index(op.id), 1);
        break;
    }
  },
  ids: (content) => content.items.map((item) => item.id),
  measure: (content) => ({ items: content.items.length }),
  targets: (op) => (op.op === 'add' ? [`item:${op.id ?? '+'}`] : [`item:${op.id}`]),
  project: (content, options) =>
    projectItems(
      content.items.map((item) => ({
        id: item.id,
        text: `${item.text} <!-- #${item.id} -->`,
        outline: `- ${item.id}: ${ellipsis(item.text, 30)}`,
      })),
      options,
    ),
  lint: (content) =>
    content.items
      .filter((item) => item.text.trim() === '')
      .map((item) => ({
        code: 'empty',
        severity: 'warning' as const,
        target: `item:${item.id}`,
        message: 'Empty item.',
      })),
  diff: (before, after) =>
    diffCollection(before.items, after.items, { prefix: 'item', id: (item) => item.id }),
  parsePartial: (raw) => {
    const parsed = contentSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  },
  inputs: {
    lines: {
      description: 'One item per line.',
      schema: z.string(),
      toContent: (input, ctx) => {
        const lines = String(input).split('\n');
        const kept = lines.filter(Boolean);
        if (kept.length < lines.length) ctx.note?.(`Skipped ${lines.length - kept.length} empty line(s).`);
        return { items: kept.map((text, i) => ({ id: `l${i + 1}`, text })) };
      },
    },
  },
  migrations: [
    {
      from: 1,
      to: 2,
      migrate: (content) => ({
        items: (content as { lines: string[] }).lines.map((text, i) => ({ id: `m${i + 1}`, text })),
      }),
    },
  ],
  limits: { items: 5 },
  instructions: {
    summary: 'A short list of notes.',
    rules: ['Keep items short.'],
    examples: [
      {
        title: 'Add a note',
        content: { items: [{ id: 'a', text: 'Hello' }] },
        operations: [{ op: 'add', after: 'a', text: 'World' }],
      },
    ],
  },
});
