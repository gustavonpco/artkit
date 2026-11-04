import { type ApplyContext, formatPath, itemIdSchema } from '@artkit-ai/core';
import { z } from 'zod';
import { blockIssues } from './integrity.js';
import { parseMarkdown } from './markdown/parse.js';
import { canonicalBlock, idPrefix } from './normalize.js';
import { countOccurrences, replaceInRuns, runsText } from './runs.js';
import {
  ALIGNS,
  BLOCK_TYPES,
  type Block,
  type BlockInput,
  blockInputSchema,
  blockSchema,
  CALLOUT_TONES,
  COLUMN_ALIGNS,
  cellSchema,
  coverSchema,
  type DocumentContent,
  type ListItem,
  listItemSchema,
  pageSchema,
  type Run,
  runsSchema,
} from './schema.js';

const afterField = itemIdSchema
  .optional()
  .describe('Id of the block to insert after. Omit to insert at the start.');

/** A cell given as plain text or as runs. */
export const cellInputSchema = z
  .union([z.string().max(20_000), cellSchema])
  .describe('Cell as plain text ("40") or runs ([{"text":"40","bold":true}]).');

/** Every block field, all optional, for `update_block`. */
export const blockFieldsSchema = z
  .object({
    type: z
      .enum(BLOCK_TYPES)
      .optional()
      .describe('Changing the type rebuilds the block from the given fields only (the id is kept).'),
    level: z.number().int().min(1).max(4).optional(),
    runs: runsSchema.optional(),
    align: z
      .union([z.enum(ALIGNS), z.array(z.enum(COLUMN_ALIGNS)).max(50)])
      .optional()
      .describe('Paragraph alignment or per-column table alignment.'),
    ordered: z.boolean().optional(),
    start: z.number().int().min(0).max(1_000_000).optional(),
    items: z.array(listItemSchema).min(1).max(1_000).optional(),
    header: z.array(cellSchema).min(1).max(50).optional(),
    rows: z.array(z.array(cellSchema).max(50)).max(10_000).optional(),
    widths: z.array(z.number().positive().max(1_000)).max(50).optional(),
    footer: z.array(cellSchema).max(50).optional(),
    caption: z.string().max(500).optional(),
    tone: z.enum(CALLOUT_TONES).optional(),
    title: z.string().max(300).optional(),
    attribution: z.string().max(300).optional(),
    language: z.string().max(40).optional(),
    text: z.string().max(100_000).optional(),
    asset: z.string().max(200).optional(),
    alt: z.string().max(500).optional(),
    width: z.number().min(0.1).max(1).optional(),
    maxLevel: z.number().int().min(1).max(4).optional(),
  })
  .strict();

const UNSETTABLE = [
  'align',
  'ordered',
  'start',
  'widths',
  'footer',
  'caption',
  'title',
  'attribution',
  'language',
  'width',
  'maxLevel',
] as const;

const cellTargetSchema = z
  .object({
    section: z.enum(['header', 'body', 'footer']).optional().describe('Default "body".'),
    row: z.number().int().min(0).optional().describe('0-based body row index (required for "body").'),
    col: z.number().int().min(0).describe('0-based column index.'),
    value: cellInputSchema,
  })
  .strict();

export const documentOperationSchema = z.discriminatedUnion('op', [
  z
    .object({ op: z.literal('insert_block'), after: afterField, block: blockInputSchema })
    .strict()
    .describe('Inserts one block after a block id (or at the start). The id is generated when omitted.'),
  z
    .object({
      op: z.literal('insert_markdown'),
      after: afterField,
      markdown: z.string().min(1).max(200_000).describe('GFM Markdown converted into blocks.'),
    })
    .strict()
    .describe('Converts Markdown into blocks and inserts them after a block id (or at the start).'),
  z
    .object({
      op: z.literal('update_block'),
      id: itemIdSchema,
      fields: blockFieldsSchema,
      unset: z
        .array(z.enum(UNSETTABLE))
        .max(UNSETTABLE.length)
        .optional()
        .describe('Optional fields to remove.'),
    })
    .strict()
    .describe('Replaces fields of a block, keeping its id.'),
  z.object({ op: z.literal('remove_block'), id: itemIdSchema }).strict(),
  z.object({ op: z.literal('move_block'), id: itemIdSchema, after: afterField }).strict(),
  z
    .object({
      op: z.literal('replace_text'),
      id: itemIdSchema,
      find: z
        .string()
        .min(1)
        .max(5_000)
        .describe('Exact text to find; must occur exactly once in the block.'),
      replace: z.string().max(20_000),
    })
    .strict()
    .describe('Replaces an exact, unique text anchor inside one block, keeping the formatting of the runs.'),
  z
    .object({
      op: z.literal('set_cover'),
      cover: coverSchema.optional().describe('Omit to remove the cover.'),
    })
    .strict(),
  z
    .object({ op: z.literal('set_page'), page: pageSchema.optional().describe('Omit to reset to defaults.') })
    .strict(),
  z
    .object({
      op: z.literal('table_set_cells'),
      id: itemIdSchema,
      cells: z.array(cellTargetSchema).min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      op: z.literal('table_insert_row'),
      id: itemIdSchema,
      index: z.number().int().min(0).optional().describe('0-based position among body rows. Omit to append.'),
      cells: z.array(cellInputSchema).max(50),
    })
    .strict(),
  z
    .object({
      op: z.literal('table_remove_row'),
      id: itemIdSchema,
      index: z.number().int().min(0).describe('0-based body row index.'),
    })
    .strict(),
]);

export type DocumentOperation = z.infer<typeof documentOperationSchema>;
export type BlockFields = z.infer<typeof blockFieldsSchema>;

const say = (ctx: ApplyContext, ptText: string, enText: string) =>
  ctx.locale.toLowerCase().startsWith('pt') ? ptText : enText;

function toCell(value: string | Run[]): Run[] {
  return typeof value === 'string' ? (value ? [{ text: value }] : []) : value;
}

function indexOf(draft: DocumentContent, id: string, ctx: ApplyContext, path: string): number {
  const index = draft.blocks.findIndex((block) => block.id === id);
  if (index < 0) {
    ctx.fail(say(ctx, `O bloco "${id}" não existe.`, `Block "${id}" does not exist.`), {
      hint: say(
        ctx,
        'Use um id que aparece na projeção (<!-- #id -->).',
        'Use an id shown in the projection (<!-- #id -->).',
      ),
      path,
    });
  }
  return index;
}

function insertionIndex(draft: DocumentContent, after: string | undefined, ctx: ApplyContext): number {
  return after === undefined ? 0 : indexOf(draft, after, ctx, 'after') + 1;
}

function tableAt(draft: DocumentContent, id: string, ctx: ApplyContext): Block & { type: 'table' } {
  const block = draft.blocks[indexOf(draft, id, ctx, 'id')]!;
  if (block.type !== 'table') {
    ctx.fail(
      say(
        ctx,
        `O bloco "${id}" é ${block.type}, não uma tabela.`,
        `Block "${id}" is a ${block.type}, not a table.`,
      ),
      { path: 'id' },
    );
  }
  return block as Block & { type: 'table' };
}

function checkBlock(block: Block, ctx: ApplyContext, path: string): void {
  const issue = blockIssues(block, ctx.locale)[0];
  if (issue)
    ctx.fail(issue.message, { ...(issue.hint ? { hint: issue.hint } : {}), path: `${path}.${issue.path}` });
}

/** Assigns an explicit or generated id, rejecting collisions. */
function claimId(input: BlockInput, ctx: ApplyContext, path: string): Block {
  if (input.id !== undefined) {
    if (ctx.hasId(input.id)) {
      ctx.fail(say(ctx, `O id "${input.id}" já existe.`, `Id "${input.id}" already exists.`), {
        hint: say(
          ctx,
          'Omita o id para gerar um novo ou escolha outro.',
          'Omit the id to generate one, or pick another.',
        ),
        path,
      });
    }
    ctx.reserveId(input.id);
    return canonicalBlock({ ...input, id: input.id } as Block);
  }
  return canonicalBlock({ ...input, id: ctx.nextId(idPrefix(input.type)) } as Block);
}

interface TextSlot {
  text: string;
  replace(find: string, replacement: string): void;
}

function itemSlots(items: ListItem[]): TextSlot[] {
  return items.flatMap((item) => [runsSlot(item), ...(item.children ? itemSlots(item.children) : [])]);
}

function runsSlot(holder: { runs: Run[] }): TextSlot {
  return {
    text: runsText(holder.runs),
    replace: (find, replacement) => {
      holder.runs = replaceInRuns(holder.runs, find, replacement);
    },
  };
}

function stringSlot<T extends object, K extends keyof T>(holder: T, key: K): TextSlot[] {
  const value = holder[key];
  if (typeof value !== 'string') return [];
  return [
    {
      text: value,
      replace: (find, replacement) => {
        (holder as Record<K, unknown>)[key] = value.replace(find, () => replacement);
      },
    },
  ];
}

/** Every editable text of a block, in reading order. */
function textSlots(block: Block): TextSlot[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return [runsSlot(block)];
    case 'quote':
      return [runsSlot(block), ...stringSlot(block, 'attribution')];
    case 'callout':
      return [...stringSlot(block, 'title'), runsSlot(block)];
    case 'list':
      return itemSlots(block.items);
    case 'table': {
      const rows = [block.header, ...block.rows, ...(block.footer ? [block.footer] : [])];
      const slots = rows.flatMap((row) =>
        row.map((_, col) =>
          runsSlot({
            get runs() {
              return row[col]!;
            },
            set runs(value: Run[]) {
              row[col] = value;
            },
          }),
        ),
      );
      return [...slots, ...stringSlot(block, 'caption')];
    }
    case 'code':
      return stringSlot(block, 'text');
    case 'image':
      return [...stringSlot(block, 'alt'), ...stringSlot(block, 'caption')];
    case 'toc':
      return stringSlot(block, 'title');
    default:
      return [];
  }
}

function applyUpdate(
  draft: DocumentContent,
  op: Extract<DocumentOperation, { op: 'update_block' }>,
  ctx: ApplyContext,
): void {
  const index = indexOf(draft, op.id, ctx, 'id');
  const current = draft.blocks[index]!;
  const typeChange = op.fields.type !== undefined && op.fields.type !== current.type;
  const merged: Record<string, unknown> = typeChange
    ? { id: current.id, ...op.fields }
    : { ...current, ...op.fields };
  for (const key of op.unset ?? []) delete merged[key];
  merged.id = current.id;
  const parsed = blockSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = issue.path[0];
    const inFields = typeof field === 'string' && field in op.fields;
    ctx.fail(
      say(
        ctx,
        `O bloco "${op.id}" (${String(merged.type)}) ficaria inválido: ${issue.message}`,
        `Block "${op.id}" (${String(merged.type)}) would be invalid: ${issue.message}`,
      ),
      {
        hint: typeChange
          ? say(
              ctx,
              'Ao mudar o tipo, informe todos os campos obrigatórios do novo tipo.',
              'When changing the type, give every required field of the new type.',
            )
          : say(
              ctx,
              'Informe apenas campos que existem nesse tipo de bloco.',
              'Only give fields that exist on this block type.',
            ),
        path: inFields ? formatPath(issue.path, 'fields') : 'fields',
      },
    );
  }
  const block = canonicalBlock(parsed.data as Block);
  checkBlock(block, ctx, 'fields');
  draft.blocks[index] = block;
}

/** Applies one operation to the draft (mutates it). */
export function applyDocumentOperation(
  draft: DocumentContent,
  op: DocumentOperation,
  ctx: ApplyContext,
): void {
  switch (op.op) {
    case 'insert_block': {
      const position = insertionIndex(draft, op.after, ctx);
      const block = claimId(op.block as BlockInput, ctx, 'block.id');
      checkBlock(block, ctx, 'block');
      draft.blocks.splice(position, 0, block);
      return;
    }
    case 'insert_markdown': {
      const position = insertionIndex(draft, op.after, ctx);
      const parsed = parseMarkdown(op.markdown);
      const error = parsed.errors[0];
      if (error) ctx.fail(error.message, { ...(error.hint ? { hint: error.hint } : {}), path: 'markdown' });
      if (parsed.cover || parsed.page) {
        ctx.fail(
          say(
            ctx,
            'insert_markdown não aceita front matter.',
            'insert_markdown does not accept front matter.',
          ),
          {
            hint: say(
              ctx,
              'Remova o bloco "---" e use set_cover/set_page.',
              'Remove the "---" block and use set_cover/set_page.',
            ),
            path: 'markdown',
          },
        );
      }
      if (parsed.blocks.length === 0) {
        ctx.fail(say(ctx, 'O Markdown não gerou nenhum bloco.', 'The Markdown produced no blocks.'), {
          path: 'markdown',
        });
      }
      const blocks = parsed.blocks.map((input) => claimId(input, ctx, 'markdown'));
      for (const block of blocks) checkBlock(block, ctx, 'markdown');
      draft.blocks.splice(position, 0, ...blocks);
      return;
    }
    case 'update_block':
      applyUpdate(draft, op, ctx);
      return;
    case 'remove_block':
      draft.blocks.splice(indexOf(draft, op.id, ctx, 'id'), 1);
      return;
    case 'move_block': {
      if (op.after === op.id) {
        ctx.fail(
          say(
            ctx,
            'Um bloco não pode ser movido para depois de si mesmo.',
            'A block cannot be moved after itself.',
          ),
          { path: 'after' },
        );
      }
      const [block] = draft.blocks.splice(indexOf(draft, op.id, ctx, 'id'), 1);
      draft.blocks.splice(insertionIndex(draft, op.after, ctx), 0, block!);
      return;
    }
    case 'replace_text': {
      const index = indexOf(draft, op.id, ctx, 'id');
      const block = draft.blocks[index]!;
      const slots = textSlots(block);
      const total = slots.reduce((sum, slot) => sum + countOccurrences(slot.text, op.find), 0);
      if (total === 0) {
        ctx.fail(
          say(
            ctx,
            `O texto "${op.find}" não foi encontrado no bloco "${op.id}".`,
            `Text "${op.find}" was not found in block "${op.id}".`,
          ),
          {
            hint: say(
              ctx,
              'Copie a âncora exatamente como aparece na projeção (sem a formatação Markdown).',
              'Copy the anchor exactly as it appears in the projection, without Markdown formatting.',
            ),
            path: 'find',
          },
        );
      }
      if (total > 1) {
        ctx.fail(
          say(
            ctx,
            `O texto "${op.find}" aparece ${total} vezes no bloco "${op.id}".`,
            `Text "${op.find}" occurs ${total} times in block "${op.id}".`,
          ),
          {
            hint: say(
              ctx,
              'Inclua mais palavras ao redor para tornar a âncora única.',
              'Include more surrounding words so the anchor is unique.',
            ),
            path: 'find',
          },
        );
      }
      slots.find((slot) => slot.text.includes(op.find))!.replace(op.find, op.replace);
      draft.blocks[index] = canonicalBlock(block);
      return;
    }
    case 'set_cover':
      if (op.cover) draft.cover = op.cover;
      else delete draft.cover;
      return;
    case 'set_page':
      if (op.page) draft.page = op.page;
      else delete draft.page;
      return;
    case 'table_set_cells': {
      const table = tableAt(draft, op.id, ctx);
      op.cells.forEach((cell, i) => {
        const section = cell.section ?? 'body';
        const width = table.header.length;
        if (cell.col >= width) {
          ctx.fail(
            say(
              ctx,
              `A coluna ${cell.col} não existe (a tabela tem ${width}).`,
              `Column ${cell.col} does not exist (the table has ${width}).`,
            ),
            {
              hint: say(ctx, 'Colunas começam em 0.', 'Columns are 0-based.'),
              path: `cells[${i}].col`,
            },
          );
        }
        let row: Run[][];
        if (section === 'header') row = table.header;
        else if (section === 'footer') {
          if (!table.footer) {
            ctx.fail(say(ctx, 'A tabela não tem rodapé.', 'The table has no footer.'), {
              hint: say(
                ctx,
                'Crie o rodapé com update_block (fields.footer).',
                'Create it with update_block (fields.footer).',
              ),
              path: `cells[${i}].section`,
            });
          }
          row = table.footer!;
        } else {
          if (cell.row === undefined || cell.row >= table.rows.length) {
            ctx.fail(
              say(
                ctx,
                `A linha ${cell.row ?? '?'} não existe (a tabela tem ${table.rows.length}).`,
                `Row ${cell.row ?? '?'} does not exist (the table has ${table.rows.length}).`,
              ),
              {
                hint: say(ctx, 'Linhas do corpo começam em 0.', 'Body rows are 0-based.'),
                path: `cells[${i}].row`,
              },
            );
          }
          row = table.rows[cell.row!]!;
        }
        row[cell.col] = toCell(cell.value);
      });
      replaceBlock(draft, canonicalBlock(table));
      return;
    }
    case 'table_insert_row': {
      const table = tableAt(draft, op.id, ctx);
      const width = table.header.length;
      if (op.cells.length !== width) {
        ctx.fail(
          say(
            ctx,
            `A linha tem ${op.cells.length} células e o cabeçalho tem ${width}.`,
            `The row has ${op.cells.length} cells and the header has ${width}.`,
          ),
          { hint: say(ctx, `Informe ${width} células.`, `Give ${width} cells.`), path: 'cells' },
        );
      }
      const index = op.index ?? table.rows.length;
      if (index > table.rows.length) {
        ctx.fail(
          say(
            ctx,
            `Posição ${index} inválida (a tabela tem ${table.rows.length} linhas).`,
            `Position ${index} is out of range (the table has ${table.rows.length} rows).`,
          ),
          {
            path: 'index',
          },
        );
      }
      table.rows.splice(index, 0, op.cells.map(toCell));
      replaceBlock(draft, canonicalBlock(table));
      return;
    }
    case 'table_remove_row': {
      const table = tableAt(draft, op.id, ctx);
      if (op.index >= table.rows.length) {
        ctx.fail(
          say(
            ctx,
            `A linha ${op.index} não existe (a tabela tem ${table.rows.length}).`,
            `Row ${op.index} does not exist (the table has ${table.rows.length}).`,
          ),
          {
            hint: say(ctx, 'Linhas do corpo começam em 0.', 'Body rows are 0-based.'),
            path: 'index',
          },
        );
      }
      table.rows.splice(op.index, 1);
      return;
    }
  }
}

function replaceBlock(draft: DocumentContent, block: Block): void {
  const index = draft.blocks.findIndex((candidate) => candidate.id === block.id);
  draft.blocks[index] = block;
}

/** Item targets touched by an operation, in the same vocabulary as `diff` (`block:<id>`, `cover`, `page`). */
export function documentOperationTargets(op: DocumentOperation): string[] {
  switch (op.op) {
    case 'insert_block':
      return op.block.id ? [`block:${op.block.id}`] : [];
    case 'insert_markdown':
      return [];
    case 'set_cover':
      return ['cover'];
    case 'set_page':
      return ['page'];
    default:
      return [`block:${op.id}`];
  }
}
