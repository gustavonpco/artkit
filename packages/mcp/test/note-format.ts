import {
  type AnyFormatAdapter,
  ellipsis,
  type FormatAdapter,
  type LintIssue,
  paginate,
  type ReadRequest,
} from '@artkit-ai/core';
import { z } from 'zod';

/** Small native format used to test the node services: an ordered list of short notes. */
const itemSchema = z
  .object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), text: z.string().max(500) })
  .strict();
const contentSchema = z.object({ items: z.array(itemSchema) }).strict();
export type NoteContent = z.infer<typeof contentSchema>;

const operationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      after: z.string().optional(),
      id: z.string().optional(),
      text: z.string().max(500),
    })
    .strict(),
  z.object({ op: z.literal('edit'), id: z.string(), text: z.string().max(500) }).strict(),
  z.object({ op: z.literal('remove'), id: z.string() }).strict(),
]);
export type NoteOperation = z.infer<typeof operationSchema>;

function nextId(items: { id: string }[]): string {
  let n = items.length + 1;
  while (items.some((item) => item.id === `n${n}`)) n += 1;
  return `n${n}`;
}

export const noteFormat: FormatAdapter<NoteContent, NoteOperation> = {
  format: 'note',
  formatVersion: 'note@2',
  readableVersions: ['note@1', 'note@2'],
  label: 'Note',
  empty: () => ({ items: [] }),
  validate(content) {
    // Ids are optional on creation: missing ones are filled deterministically in position order.
    const withIds =
      content && typeof content === 'object' && Array.isArray((content as NoteContent).items)
        ? {
            items: (content as { items: { id?: string; text: string }[] }).items.map((item, i) => ({
              ...item,
              id: item.id ?? `n${i + 1}`,
            })),
          }
        : content;
    const parsed = contentSchema.safeParse(withIds);
    if (!parsed.success) {
      return {
        ok: false,
        issues: parsed.error.issues.map((issue) => ({
          path: ['content', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      };
    }
    const ids = parsed.data.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length)
      return { ok: false, issues: [{ path: 'content.items', message: 'Ids must be unique.' }] };
    return { ok: true, content: parsed.data };
  },
  operationSchema,
  async apply(draft, operations, ctx) {
    const items = structuredClone(draft.items);
    const createdRefs: string[] = [];
    const index = (id: string) => {
      const found = items.findIndex((item) => item.id === id);
      if (found < 0)
        ctx.fail(`Item "${id}" does not exist.`, { hint: 'Use an id from the projection.', path: 'id' });
      return found;
    };
    for (const op of operations) {
      switch (op.op) {
        case 'add': {
          if (op.id && items.some((item) => item.id === op.id))
            ctx.fail(`Id "${op.id}" already exists.`, { path: 'id' });
          const id = op.id ?? nextId(items);
          const position = op.after ? index(op.after) + 1 : 0;
          items.splice(position, 0, { id, text: op.text });
          createdRefs.push(id);
          break;
        }
        case 'edit':
          items[index(op.id)]!.text = op.text;
          break;
        case 'remove':
          items.splice(index(op.id), 1);
          break;
      }
    }
    return { content: { items }, createdRefs, warnings: [] };
  },
  read(content, request: ReadRequest) {
    const items = content.items.map((item) => ({
      id: item.id,
      text: `${item.text} <!-- #${item.id} -->`,
      outline: `- ${item.id}: ${ellipsis(item.text, 30)}`,
    }));
    const projection = paginate(items, {
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      outlineOnly: request.mode === 'outline',
    });
    return {
      text: projection.text,
      truncated: projection.truncated,
      ...(projection.cursor ? { cursor: projection.cursor } : {}),
    };
  },
  diff(before, after) {
    const changes = [];
    const was = new Map(before.items.map((item) => [item.id, item.text]));
    const now = new Map(after.items.map((item) => [item.id, item.text]));
    for (const [id, text] of now) {
      if (!was.has(id)) changes.push({ type: 'added' as const, target: `item:${id}`, summary: text });
      else if (was.get(id) !== text)
        changes.push({ type: 'changed' as const, target: `item:${id}`, summary: text });
    }
    for (const id of was.keys())
      if (!now.has(id)) changes.push({ type: 'removed' as const, target: `item:${id}`, summary: id });
    return changes;
  },
  lint(content): LintIssue[] {
    return content.items
      .filter((item) => item.text.trim() === '')
      .map((item) => ({
        code: 'empty',
        severity: 'warning' as const,
        target: `item:${item.id}`,
        message: 'Empty item.',
      }));
  },
  parsePartial(raw) {
    try {
      const parsed = contentSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  },
  migrations: [
    {
      from: 'note@1',
      to: 'note@2',
      migrate: (content) => ({
        items: (content as { lines: string[] }).lines.map((text, i) => ({ id: `m${i + 1}`, text })),
      }),
    },
  ],
  limits: { items: 5 },
  measure: (content) => ({ items: content.items.length }),
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
};

export const noteFormats: AnyFormatAdapter[] = [noteFormat];
