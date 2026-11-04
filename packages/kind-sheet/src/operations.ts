import { type ApplyContext, colorSchema, itemIdSchema } from '@artkit/core';
import { z } from 'zod';
import {
  cellKey,
  columnIndex,
  columnLetter,
  formatRange,
  looksLikeReference,
  MAX_COLS,
  MAX_ROWS,
  parseCellKey,
  parseRange,
  type Rect,
  rectCells,
  rectEquals,
  rectSize,
  rectsIntersect,
  sameName,
  subtractRect,
} from './address.js';
import { type CellPatch, checkFormula, coerceLiteral, normalizeAddress, patchCell } from './cells.js';
import { serialFromIso } from './formula/dates.js';
import { parseCached, walk } from './formula/parser.js';
import {
  adjustFormula,
  invalidateSheetInFormula,
  printRef,
  renameSheetInFormula,
  type StructuralChange,
  shiftInterval,
  shiftRect,
  shiftRelative,
} from './formula/rewrite.js';
import { FormulaSyntaxError, type RefPart, tokenize } from './formula/tokenizer.js';
import {
  borderSchema,
  type Cell,
  columnSchema,
  frozenSchema,
  namedFormatSchema,
  rowSchema,
  type Sheet,
  type SheetContent,
  sheetNameSchema,
  validationSchema,
} from './schema.js';

/** Largest number of cells a single range operation may touch (same as the filled-cell limit). */
export const MAX_RANGE_CELLS = 50_000;

const sheetRef = itemIdSchema.describe('Sheet id (from the projection header "(id: …)").');
const rangeText = z
  .string()
  .min(2)
  .max(32)
  .describe('A1 range on the sheet, e.g. "B2:D9" (a single cell like "B2" is fine).');
const addressKey = z
  .string()
  .regex(/^\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6}$/, 'Cell keys are A1 addresses like "B12".');

const stylePatchSchema = z
  .object({
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
    strike: z.boolean().nullable().optional(),
    fontSize: z.number().int().min(6).max(48).nullable().optional(),
    color: colorSchema.describe('Text color.').nullable().optional(),
    background: colorSchema.describe('Fill color.').nullable().optional(),
    align: z.enum(['left', 'center', 'right']).nullable().optional(),
    valign: z.enum(['top', 'middle', 'bottom']).nullable().optional(),
    wrap: z.boolean().nullable().optional(),
    border: borderSchema.nullable().optional(),
  })
  .strict()
  .describe('Style properties to set; null removes a property.');

export const cellPatchSchema = z
  .object({
    v: z
      .union([
        z.number().refine(Number.isFinite, 'Numbers must be finite.'),
        z.string().max(32_767),
        z.boolean(),
      ])
      .nullable()
      .optional()
      .describe(
        'Literal value. Text starting with "=" is stored as a formula. ISO dates ("2026-11-09") become dates.',
      ),
    f: z
      .string()
      .min(1)
      .max(8192)
      .nullable()
      .optional()
      .describe('Formula, with or without the leading "=".'),
    fmt: namedFormatSchema.nullable().optional(),
    s: stylePatchSchema.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

const valuesSchema = validationSchema.shape.values;

export const sheetOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('set_cells'),
      sheet: sheetRef,
      cells: z
        .record(addressKey, cellPatchSchema.nullable())
        .refine(
          (cells) => Object.keys(cells).length > 0 && Object.keys(cells).length <= 10_000,
          'Give 1 to 10000 cells.',
        )
        .describe('Cells keyed by A1 address. A patch merges into the cell; null removes the whole cell.'),
    })
    .strict()
    .describe('Sets values, formulas, formats, styles and notes of many cells.'),
  z
    .object({ op: z.literal('set_range_style'), sheet: sheetRef, range: rangeText, style: stylePatchSchema })
    .strict(),
  z
    .object({
      op: z.literal('set_range_format'),
      sheet: sheetRef,
      range: rangeText,
      fmt: namedFormatSchema.nullable(),
    })
    .strict(),
  z
    .object({
      op: z.literal('sort_range'),
      sheet: sheetRef,
      range: rangeText.describe('Rows to sort, e.g. "A2:D20" (include every column of the rows).'),
      by: z
        .array(
          z
            .object({
              column: z.string().regex(/^[A-Z]{1,3}$/, 'Use a column letter inside the range, like "C".'),
              descending: z.boolean().default(false),
            })
            .strict(),
        )
        .min(1)
        .max(3)
        .describe('Sort keys in priority order.'),
      header: z
        .boolean()
        .default(false)
        .describe('The first row of the range is a header and stays in place.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('clear_range'),
      sheet: sheetRef,
      range: rangeText,
      what: z
        .enum(['contents', 'formats', 'all'])
        .default('contents')
        .describe('contents: values and formulas; formats: fmt and style; all.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('insert_rows'),
      sheet: sheetRef,
      at: z
        .number()
        .int()
        .min(1)
        .max(MAX_ROWS)
        .describe('1-based row where the new rows start; that row and below move down.'),
      count: z.number().int().min(1).max(10_000).default(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('delete_rows'),
      sheet: sheetRef,
      at: z.number().int().min(1).max(MAX_ROWS).describe('First 1-based row to delete.'),
      count: z.number().int().min(1).max(MAX_ROWS).default(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('insert_columns'),
      sheet: sheetRef,
      at: z
        .string()
        .regex(/^[A-Za-z]{1,3}$/)
        .describe('Column letter where the new columns start; it and the following move right.'),
      count: z.number().int().min(1).max(1000).default(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('delete_columns'),
      sheet: sheetRef,
      at: z
        .string()
        .regex(/^[A-Za-z]{1,3}$/)
        .describe('First column letter to delete.'),
      count: z.number().int().min(1).max(MAX_COLS).default(1),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_sheet'),
      id: itemIdSchema.optional(),
      name: sheetNameSchema,
      position: z.number().int().min(1).optional().describe('1-based tab position (default: last).'),
      cells: z.record(addressKey, cellPatchSchema).optional(),
      columns: z.record(z.string().regex(/^[A-Za-z]{1,3}$/), columnSchema).optional(),
      rows: z.record(z.string().regex(/^[1-9][0-9]{0,5}$/), rowSchema).optional(),
      frozen: frozenSchema.optional(),
      merges: z.array(rangeText).optional(),
      validations: z.array(validationSchema).optional(),
      hidden: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal('rename_sheet'), sheet: sheetRef, name: sheetNameSchema }).strict(),
  z.object({ op: z.literal('remove_sheet'), sheet: sheetRef }).strict(),
  z
    .object({
      op: z.literal('move_sheet'),
      sheet: sheetRef,
      position: z.number().int().min(1).describe('1-based tab position.'),
    })
    .strict(),
  z.object({ op: z.literal('set_sheet_hidden'), sheet: sheetRef, hidden: z.boolean() }).strict(),
  z.object({ op: z.literal('merge_cells'), sheet: sheetRef, range: rangeText }).strict(),
  z
    .object({
      op: z.literal('unmerge_cells'),
      sheet: sheetRef,
      range: rangeText.describe('Every merge intersecting this range is removed.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_column_width'),
      sheet: sheetRef,
      column: z.string().regex(/^[A-Za-z]{1,3}$/),
      count: z.number().int().min(1).max(1000).default(1),
      width: columnSchema.shape.width
        .nullable()
        .describe('Width in characters (4–80); null restores the default.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_row_height'),
      sheet: sheetRef,
      row: z.number().int().min(1).max(MAX_ROWS),
      count: z.number().int().min(1).max(10_000).default(1),
      height: rowSchema.shape.height
        .nullable()
        .describe('Height in points (6–409); null restores the default.'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_frozen'),
      sheet: sheetRef,
      rows: z.number().int().min(0).max(1000).describe('Rows frozen at the top (0 for none).'),
      cols: z.number().int().min(0).max(100).describe('Columns frozen at the left (0 for none).'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_name'),
      name: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[\p{L}_\\][\p{L}\p{N}_.]*$/u, 'Names start with a letter or "_".'),
      ref: z
        .string()
        .min(2)
        .max(300)
        .describe('Reference with the sheet name, e.g. "Parametros!B2" (stored absolute).'),
    })
    .strict(),
  z.object({ op: z.literal('remove_name'), name: z.string().min(1).max(255) }).strict(),
  z
    .object({
      op: z.literal('set_validation'),
      sheet: sheetRef,
      range: rangeText,
      values: valuesSchema
        .nullable()
        .describe('Allowed values (dropdown); null removes validation from the range.'),
      allowBlank: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('fill_range'),
      sheet: sheetRef,
      source: rangeText.describe('Model cell or block, e.g. "D2".'),
      target: rangeText.describe(
        'Range to fill, e.g. "D2:D40". Relative references shift per row/column; $ keeps them.',
      ),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_settings'),
      calculationDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional()
        .describe('Date returned by TODAY() (YYYY-MM-DD); null unsets it.'),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable()
        .optional()
        .describe('ISO 4217 code for the currency format; null uses the locale currency.'),
    })
    .strict(),
]);

export type SheetOperation = z.infer<typeof sheetOperationSchema>;
export type SheetOperationInput = z.input<typeof sheetOperationSchema>;

// ---- Messages ----

const isPt = (ctx: Pick<ApplyContext, 'locale'>) => ctx.locale.toLowerCase().startsWith('pt');

function text(ctx: ApplyContext, en: string, pt: string): string {
  return isPt(ctx) ? pt : en;
}

// ---- Helpers ----

function findSheet(draft: SheetContent, id: string, ctx: ApplyContext, path = 'sheet'): Sheet {
  const sheet = draft.sheets.find((candidate) => candidate.id === id);
  if (!sheet) {
    const ids = draft.sheets.map((candidate) => `${candidate.id} ("${candidate.name}")`).join(', ');
    ctx.fail(text(ctx, `Sheet "${id}" does not exist.`, `A aba "${id}" não existe.`), {
      path,
      hint: text(ctx, `Use a sheet id: ${ids}.`, `Use um id de aba: ${ids}.`),
    });
  }
  return sheet;
}

function rangeOrFail(value: string, ctx: ApplyContext, path: string): Rect {
  const rect = parseRange(value);
  if (!rect) {
    ctx.fail(text(ctx, `Invalid range "${value}".`, `Intervalo inválido "${value}".`), {
      path,
      hint: text(
        ctx,
        'Use A1 notation like "B2:D9" within A1:XFD100000.',
        'Use notação A1 como "B2:D9" dentro de A1:XFD100000.',
      ),
    });
  }
  if (rectSize(rect) > MAX_RANGE_CELLS) {
    ctx.fail(
      text(
        ctx,
        `Range ${value} has more than ${MAX_RANGE_CELLS} cells.`,
        `O intervalo ${value} tem mais de ${MAX_RANGE_CELLS} células.`,
      ),
      {
        path,
        hint: text(
          ctx,
          'Split the operation into smaller ranges.',
          'Divida a operação em intervalos menores.',
        ),
      },
    );
  }
  return rect;
}

function formulaOrFail(formula: string, ctx: ApplyContext, path: string): void {
  const issue = checkFormula(formula, ctx.locale);
  if (issue) ctx.fail(issue.message, { path, ...(issue.hint ? { hint: issue.hint } : {}) });
}

function setCell(sheet: Sheet, key: string, cell: Cell | undefined): void {
  if (cell) sheet.cells[key] = cell;
  else delete sheet.cells[key];
}

function forEachFormula(draft: SheetContent, visit: (cell: Cell, sheet: Sheet) => void): void {
  for (const sheet of draft.sheets)
    for (const cell of Object.values(sheet.cells)) if (cell.f !== undefined) visit(cell, sheet);
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Deterministic sheet id: the name's slug when free, otherwise `sheet<n>`. */
export function sheetIdFor(name: string, ctx: Pick<ApplyContext, 'hasId' | 'nextId'>): string {
  const candidate = slug(name);
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidate) && !ctx.hasId(candidate)) return candidate;
  return ctx.nextId('sheet');
}

function applyPatch(sheet: Sheet, key: string, patch: CellPatch, ctx: ApplyContext, path: string): void {
  const next = patchCell(sheet.cells[key], patch);
  if (next?.f !== undefined && (patch.f !== undefined || typeof patch.v === 'string'))
    formulaOrFail(next.f, ctx, path);
  setCell(sheet, key, next);
}

/** Moves cells, layout, merges and validations of a sheet and rewrites formulas and names everywhere. */
function applyStructural(
  draft: SheetContent,
  sheet: Sheet,
  change: StructuralChange,
  ctx: ApplyContext,
): void {
  const max = change.axis === 'row' ? MAX_ROWS : MAX_COLS;
  const moved: Record<string, Cell> = {};
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    const coordinate = change.axis === 'row' ? pos.row : pos.col;
    const shifted = shiftInterval(coordinate, coordinate, change, max);
    if (!shifted) {
      if (change.type === 'insert') {
        ctx.fail(text(ctx, `Cell ${key} would move outside the grid.`, `A célula ${key} sairia da grade.`), {
          hint: text(
            ctx,
            'Delete rows or columns at the end first.',
            'Exclua linhas ou colunas do final antes.',
          ),
        });
      }
      continue;
    }
    moved[change.axis === 'row' ? cellKey(shifted[0], pos.col) : cellKey(pos.row, shifted[0])] = cell;
  }
  sheet.cells = moved;
  forEachFormula(draft, (cell, owner) => {
    cell.f = adjustFormula(cell.f!, owner.name, change);
  });
  for (const name of draft.names ?? []) name.ref = adjustFormula(name.ref, '', change);
  if (sheet.merges) {
    sheet.merges = sheet.merges.flatMap((merge) => {
      const rect = parseRange(merge);
      const next = rect ? shiftRect(rect, change) : null;
      return next && rectSize(next) > 1 ? [formatRange(next)] : [];
    });
    if (sheet.merges.length === 0) delete sheet.merges;
  }
  if (sheet.validations) {
    sheet.validations = sheet.validations.flatMap((validation) => {
      const rect = parseRange(validation.range);
      const next = rect ? shiftRect(rect, change) : null;
      return next ? [{ ...validation, range: formatRange(next) }] : [];
    });
    if (sheet.validations.length === 0) delete sheet.validations;
  }
  if (change.axis === 'row' && sheet.rows) {
    const rows: NonNullable<Sheet['rows']> = {};
    for (const [key, value] of Object.entries(sheet.rows)) {
      const shifted = shiftInterval(Number(key) - 1, Number(key) - 1, change, max);
      if (shifted) rows[String(shifted[0] + 1)] = value;
    }
    sheet.rows = rows;
  }
  if (change.axis === 'col' && sheet.columns) {
    const columns: NonNullable<Sheet['columns']> = {};
    for (const [key, value] of Object.entries(sheet.columns)) {
      const shifted = shiftInterval(columnIndex(key), columnIndex(key), change, max);
      if (shifted) columns[columnLetter(shifted[0])] = value;
    }
    sheet.columns = columns;
  }
  if (sheet.frozen) {
    const field = change.axis === 'row' ? 'rows' : 'cols';
    const frozen = sheet.frozen[field];
    if (frozen > 0) {
      if (change.type === 'insert' && change.index < frozen)
        sheet.frozen[field] = Math.min(frozen + change.count, field === 'rows' ? 1000 : 100);
      if (change.type === 'delete') {
        const overlap = Math.max(0, Math.min(frozen, change.index + change.count) - change.index);
        sheet.frozen[field] = frozen - overlap;
      }
    }
  }
}

/** Parses a defined-name reference: one reference with a sheet prefix. Returns the canonical absolute text. */
export function canonicalNameRef(text: string): string | undefined {
  const source = text.trim().replace(/^=/, '');
  try {
    const tokens = tokenize(source);
    if (tokens.length !== 1) return undefined;
    const token = tokens[0]!;
    if (token.type === 'error' && token.error === '#REF!') return '#REF!';
    const ref = token.ref;
    if (token.type !== 'ref' || !ref || ref.sheet === undefined) return undefined;
    const abs = (part: RefPart): RefPart => ({
      ...part,
      rowAbs: part.row !== undefined,
      colAbs: part.col !== undefined,
    });
    return printRef({ ...ref, a: abs(ref.a), b: abs(ref.b) });
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return undefined;
    throw error;
  }
}

function formulaUsesName(formula: string, name: string): boolean {
  try {
    let found = false;
    walk(parseCached(formula).ast, (node) => {
      if (node.type === 'name' && node.name === name.toUpperCase()) found = true;
    });
    return found;
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return false;
    throw error;
  }
}

function fillRange(sheet: Sheet, source: Rect, target: Rect): void {
  const height = source.bottom - source.top + 1;
  const width = source.right - source.left + 1;
  const snapshot = new Map<string, Cell | undefined>();
  for (const pos of rectCells(source))
    snapshot.set(cellKey(pos.row, pos.col), sheet.cells[cellKey(pos.row, pos.col)]);
  for (const { row, col } of rectCells(target)) {
    const sr = source.top + ((((row - source.top) % height) + height) % height);
    const sc = source.left + ((((col - source.left) % width) + width) % width);
    const origin = snapshot.get(cellKey(sr, sc));
    const key = cellKey(row, col);
    if (row === sr && col === sc) continue;
    if (!origin) {
      delete sheet.cells[key];
      continue;
    }
    const copy: Cell = structuredClone(origin);
    delete copy.note;
    if (copy.f !== undefined) {
      copy.f = shiftRelative(copy.f, row - sr, col - sc);
      delete copy.v;
    }
    setCell(sheet, key, Object.keys(copy).length > 0 ? copy : undefined);
  }
}

type SortKey = { kind: 0 | 1 | 2; number: number; text: string };

/** Excel order: numbers (and booleans) before text, blanks always last whatever the direction. */
function sortKey(cell: Cell | undefined): SortKey {
  const value = cell?.v;
  if (value === undefined || value === null || value === '') return { kind: 2, number: 0, text: '' };
  if (typeof value === 'number') return { kind: 0, number: value, text: '' };
  if (typeof value === 'boolean') return { kind: 0, number: value ? 1 : 0, text: '' };
  return { kind: 1, number: 0, text: String(value).toLocaleLowerCase() };
}

function compareKeys(a: SortKey, b: SortKey, descending: boolean): number {
  if (a.kind === 2 || b.kind === 2) return a.kind === b.kind ? 0 : a.kind === 2 ? 1 : -1;
  const sign = descending ? -1 : 1;
  if (a.kind !== b.kind) return (a.kind - b.kind) * sign;
  if (a.kind === 0) return (a.number - b.number) * sign;
  return a.text.localeCompare(b.text, undefined, { numeric: true }) * sign;
}

/**
 * Sorts the rows of a range in place (stable). Whole rows of the range move together; formulas inside
 * moved cells keep pointing at the same relative neighbours, like a spreadsheet sort.
 */
function sortRange(
  sheet: Sheet,
  rect: Rect,
  op: Extract<SheetOperation, { op: 'sort_range' }>,
  ctx: ApplyContext,
): void {
  const top = op.header ? rect.top + 1 : rect.top;
  if (top > rect.bottom) return;
  for (const merge of sheet.merges ?? []) {
    const other = parseRange(merge);
    if (other && rectsIntersect(other, { ...rect, top })) {
      ctx.fail(
        text(
          ctx,
          `Cannot sort across the merge ${merge}.`,
          `Não é possível ordenar sobre a mesclagem ${merge}.`,
        ),
        { path: 'range', hint: text(ctx, `Unmerge ${merge} first.`, `Desfaça a mesclagem ${merge} antes.`) },
      );
    }
  }
  const keys = op.by.map((key, index) => {
    const col = columnIndex(key.column);
    if (col < rect.left || col > rect.right) {
      ctx.fail(
        text(
          ctx,
          `Column ${key.column} is outside ${op.range}.`,
          `A coluna ${key.column} está fora de ${op.range}.`,
        ),
        { path: `by[${index}].column` },
      );
    }
    return { col, descending: key.descending };
  });
  const rows: { source: number; cells: (Cell | undefined)[] }[] = [];
  for (let row = top; row <= rect.bottom; row++) {
    const cells: (Cell | undefined)[] = [];
    for (let col = rect.left; col <= rect.right; col++) cells.push(sheet.cells[cellKey(row, col)]);
    rows.push({ source: row, cells });
  }
  const ordered = rows
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) => {
      for (const key of keys) {
        const result = compareKeys(
          sortKey(a.cells[key.col - rect.left]),
          sortKey(b.cells[key.col - rect.left]),
          key.descending,
        );
        if (result !== 0) return result;
      }
      return a.index - b.index;
    });
  ordered.forEach((row, index) => {
    const target = top + index;
    row.cells.forEach((cell, offset) => {
      const key = cellKey(target, rect.left + offset);
      if (!cell) {
        delete sheet.cells[key];
        return;
      }
      const copy: Cell = structuredClone(cell);
      if (copy.f !== undefined && target !== row.source)
        copy.f = shiftRelative(copy.f, target - row.source, 0);
      sheet.cells[key] = copy;
    });
  });
}

// ---- Apply ----

export function applySheetOperation(draft: SheetContent, op: SheetOperation, ctx: ApplyContext): void {
  switch (op.op) {
    case 'set_cells': {
      const sheet = findSheet(draft, op.sheet, ctx);
      for (const [rawKey, patch] of Object.entries(op.cells)) {
        const key = normalizeAddress(rawKey);
        const path = `cells.${rawKey}`;
        if (!key) {
          ctx.fail(
            text(ctx, `Cell ${rawKey} is outside the grid.`, `A célula ${rawKey} está fora da grade.`),
            {
              path,
              hint: text(
                ctx,
                'Use rows 1–100000 and columns A–XFD.',
                'Use linhas de 1 a 100000 e colunas de A a XFD.',
              ),
            },
          );
        }
        if (patch === null) delete sheet.cells[key];
        else applyPatch(sheet, key, patch, ctx, `${path}${patch.f ? '.f' : '.v'}`);
      }
      break;
    }
    case 'set_range_style': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      for (const { row, col } of rectCells(rect)) {
        const key = cellKey(row, col);
        setCell(sheet, key, patchCell(sheet.cells[key], { s: op.style }));
      }
      break;
    }
    case 'set_range_format': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      for (const { row, col } of rectCells(rect)) {
        const key = cellKey(row, col);
        const current = sheet.cells[key];
        if (!current && op.fmt === null) continue;
        let next = patchCell(current, { fmt: op.fmt });
        // Text dates become serials when a date format is applied.
        if (
          next &&
          typeof next.v === 'string' &&
          next.f === undefined &&
          (op.fmt === 'date' || op.fmt === 'datetime')
        ) {
          const coerced = coerceLiteral(next.v, op.fmt);
          next = { ...next, v: coerced.v };
        }
        setCell(sheet, key, next);
      }
      break;
    }
    case 'sort_range': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      sortRange(sheet, rect, op, ctx);
      return;
    }
    case 'clear_range': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      for (const key of Object.keys(sheet.cells)) {
        const pos = parseCellKey(key);
        if (!pos || !rectsIntersect(rect, { top: pos.row, bottom: pos.row, left: pos.col, right: pos.col }))
          continue;
        if (op.what === 'all') {
          delete sheet.cells[key];
          continue;
        }
        const patch: CellPatch = op.what === 'contents' ? { v: null, f: null } : { fmt: null, s: null };
        setCell(sheet, key, patchCell(sheet.cells[key], patch));
      }
      break;
    }
    case 'insert_rows':
    case 'delete_rows': {
      const sheet = findSheet(draft, op.sheet, ctx);
      applyStructural(
        draft,
        sheet,
        {
          sheet: sheet.name,
          axis: 'row',
          type: op.op === 'insert_rows' ? 'insert' : 'delete',
          index: op.at - 1,
          count: op.count,
        },
        ctx,
      );
      break;
    }
    case 'insert_columns':
    case 'delete_columns': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const index = columnIndex(op.at);
      if (index < 0 || index >= MAX_COLS)
        ctx.fail(text(ctx, `Invalid column "${op.at}".`, `Coluna inválida "${op.at}".`), {
          path: 'at',
          hint: 'A–XFD',
        });
      applyStructural(
        draft,
        sheet,
        {
          sheet: sheet.name,
          axis: 'col',
          type: op.op === 'insert_columns' ? 'insert' : 'delete',
          index,
          count: op.count,
        },
        ctx,
      );
      break;
    }
    case 'add_sheet': {
      if (draft.sheets.some((sheet) => sameName(sheet.name, op.name))) {
        ctx.fail(
          text(ctx, `A sheet named "${op.name}" already exists.`, `Já existe uma aba chamada "${op.name}".`),
          {
            path: 'name',
            hint: text(
              ctx,
              'Pick another name (names are case-insensitive).',
              'Escolha outro nome (sem diferenciar maiúsculas).',
            ),
          },
        );
      }
      if (op.id !== undefined && ctx.hasId(op.id)) {
        ctx.fail(text(ctx, `Id "${op.id}" is already used.`, `O id "${op.id}" já está em uso.`), {
          path: 'id',
          hint: text(
            ctx,
            'Omit id to generate one or pick an unused id.',
            'Omita o id para gerar um ou escolha outro.',
          ),
        });
      }
      const id = op.id ?? sheetIdFor(op.name, ctx);
      ctx.reserveId(id);
      const sheet: Sheet = { id, name: op.name, cells: {} };
      for (const [rawKey, patch] of Object.entries(op.cells ?? {})) {
        const key = normalizeAddress(rawKey);
        if (!key)
          ctx.fail(
            text(ctx, `Cell ${rawKey} is outside the grid.`, `A célula ${rawKey} está fora da grade.`),
            { path: `cells.${rawKey}` },
          );
        applyPatch(sheet, key, patch, ctx, `cells.${rawKey}`);
      }
      if (op.columns)
        sheet.columns = Object.fromEntries(
          Object.entries(op.columns).map(([key, value]) => [key.toUpperCase(), value]),
        );
      if (op.rows) sheet.rows = op.rows;
      if (op.frozen) sheet.frozen = op.frozen;
      if (op.merges)
        sheet.merges = op.merges.map((merge, index) =>
          formatRange(rangeOrFail(merge, ctx, `merges[${index}]`)),
        );
      if (op.validations) sheet.validations = op.validations;
      if (op.hidden) sheet.hidden = true;
      const position = Math.min(op.position ?? draft.sheets.length + 1, draft.sheets.length + 1);
      draft.sheets.splice(position - 1, 0, sheet);
      break;
    }
    case 'rename_sheet': {
      const sheet = findSheet(draft, op.sheet, ctx);
      if (sheet.name === op.name) break;
      if (draft.sheets.some((other) => other !== sheet && sameName(other.name, op.name))) {
        ctx.fail(
          text(ctx, `A sheet named "${op.name}" already exists.`, `Já existe uma aba chamada "${op.name}".`),
          {
            path: 'name',
            hint: text(ctx, 'Pick another name.', 'Escolha outro nome.'),
          },
        );
      }
      const old = sheet.name;
      forEachFormula(draft, (cell) => {
        cell.f = renameSheetInFormula(cell.f!, old, op.name);
      });
      for (const name of draft.names ?? []) name.ref = renameSheetInFormula(name.ref, old, op.name);
      sheet.name = op.name;
      break;
    }
    case 'remove_sheet': {
      const sheet = findSheet(draft, op.sheet, ctx);
      if (draft.sheets.length === 1) {
        ctx.fail(
          text(ctx, 'A workbook needs at least one sheet.', 'A pasta precisa de pelo menos uma aba.'),
          {
            path: 'sheet',
            hint: text(
              ctx,
              'Add another sheet before removing this one.',
              'Adicione outra aba antes de remover esta.',
            ),
          },
        );
      }
      draft.sheets = draft.sheets.filter((candidate) => candidate !== sheet);
      forEachFormula(draft, (cell) => {
        cell.f = invalidateSheetInFormula(cell.f!, sheet.name);
      });
      for (const name of draft.names ?? []) name.ref = invalidateSheetInFormula(name.ref, sheet.name);
      break;
    }
    case 'move_sheet': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const from = draft.sheets.indexOf(sheet);
      const to = Math.min(op.position, draft.sheets.length) - 1;
      draft.sheets.splice(from, 1);
      draft.sheets.splice(to, 0, sheet);
      break;
    }
    case 'set_sheet_hidden': {
      const sheet = findSheet(draft, op.sheet, ctx);
      if (
        op.hidden &&
        draft.sheets.filter((candidate) => !candidate.hidden && candidate !== sheet).length === 0
      ) {
        ctx.fail(
          text(ctx, 'At least one sheet must stay visible.', 'Pelo menos uma aba precisa ficar visível.'),
          { path: 'hidden' },
        );
      }
      if (op.hidden) sheet.hidden = true;
      else delete sheet.hidden;
      break;
    }
    case 'merge_cells': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      if (rectSize(rect) < 2)
        ctx.fail(
          text(ctx, 'A merge needs at least two cells.', 'Uma mesclagem precisa de pelo menos duas células.'),
          { path: 'range' },
        );
      for (const merge of sheet.merges ?? []) {
        const other = parseRange(merge);
        if (other && rectsIntersect(other, rect)) {
          ctx.fail(
            text(
              ctx,
              `Range ${op.range} overlaps the merge ${merge}.`,
              `O intervalo ${op.range} sobrepõe a mesclagem ${merge}.`,
            ),
            {
              path: 'range',
              hint: text(ctx, `Unmerge ${merge} first.`, `Desfaça a mesclagem ${merge} antes.`),
            },
          );
        }
      }
      for (const { row, col } of rectCells(rect)) {
        if (row === rect.top && col === rect.left) continue;
        const cell = sheet.cells[cellKey(row, col)];
        if (cell && (cell.v !== undefined || cell.f !== undefined)) {
          ctx.fail(
            text(
              ctx,
              `Cell ${cellKey(row, col)} has content and would be hidden by the merge.`,
              `A célula ${cellKey(row, col)} tem conteúdo e ficaria oculta pela mesclagem.`,
            ),
            {
              path: 'range',
              hint: text(
                ctx,
                'Only the top-left cell keeps content: clear the others with set_cells null first.',
                'Só a célula do canto superior esquerdo mantém conteúdo: limpe as demais com set_cells null antes.',
              ),
            },
          );
        }
      }
      sheet.merges = [...(sheet.merges ?? []), formatRange(rect)];
      break;
    }
    case 'unmerge_cells': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      const kept = (sheet.merges ?? []).filter((merge) => {
        const other = parseRange(merge);
        return !other || !rectsIntersect(other, rect);
      });
      if (kept.length === (sheet.merges ?? []).length) {
        ctx.fail(text(ctx, `No merge intersects ${op.range}.`, `Nenhuma mesclagem cruza ${op.range}.`), {
          path: 'range',
          hint: text(
            ctx,
            `Merges on this sheet: ${(sheet.merges ?? []).join(', ') || 'none'}.`,
            `Mesclagens desta aba: ${(sheet.merges ?? []).join(', ') || 'nenhuma'}.`,
          ),
        });
      }
      if (kept.length > 0) sheet.merges = kept;
      else delete sheet.merges;
      break;
    }
    case 'set_column_width': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const start = columnIndex(op.column);
      if (start < 0 || start + op.count > MAX_COLS)
        ctx.fail(text(ctx, `Invalid column "${op.column}".`, `Coluna inválida "${op.column}".`), {
          path: 'column',
        });
      const columns = { ...sheet.columns };
      for (let col = start; col < start + op.count; col++) {
        if (op.width === null) delete columns[columnLetter(col)];
        else columns[columnLetter(col)] = { width: op.width };
      }
      if (Object.keys(columns).length > 0) sheet.columns = columns;
      else delete sheet.columns;
      break;
    }
    case 'set_row_height': {
      const sheet = findSheet(draft, op.sheet, ctx);
      if (op.row + op.count - 1 > MAX_ROWS)
        ctx.fail(text(ctx, 'Rows outside the grid.', 'Linhas fora da grade.'), { path: 'row' });
      const rows = { ...sheet.rows };
      for (let row = op.row; row < op.row + op.count; row++) {
        if (op.height === null) delete rows[String(row)];
        else rows[String(row)] = { height: op.height };
      }
      if (Object.keys(rows).length > 0) sheet.rows = rows;
      else delete sheet.rows;
      break;
    }
    case 'set_frozen': {
      const sheet = findSheet(draft, op.sheet, ctx);
      if (op.rows === 0 && op.cols === 0) delete sheet.frozen;
      else sheet.frozen = { rows: op.rows, cols: op.cols };
      break;
    }
    case 'set_name': {
      if (looksLikeReference(op.name) || ['TRUE', 'FALSE'].includes(op.name.toUpperCase())) {
        ctx.fail(
          text(
            ctx,
            `"${op.name}" looks like a cell reference and cannot be a name.`,
            `"${op.name}" parece uma referência de célula e não pode ser um nome.`,
          ),
          {
            path: 'name',
            hint: text(
              ctx,
              'Use a descriptive name like "valor_hora".',
              'Use um nome descritivo como "valor_hora".',
            ),
          },
        );
      }
      const ref = canonicalNameRef(op.ref);
      if (!ref || ref === '#REF!') {
        ctx.fail(text(ctx, `Invalid reference "${op.ref}".`, `Referência inválida "${op.ref}".`), {
          path: 'ref',
          hint: text(
            ctx,
            'Use one reference with the sheet name, e.g. "Parametros!B2" or "\'My sheet\'!A1:A9".',
            'Use uma referência com o nome da aba, por exemplo "Parametros!B2" ou "\'Minha aba\'!A1:A9".',
          ),
        });
      }
      const names = draft.names ?? [];
      const existing = names.find((candidate) => sameName(candidate.name, op.name));
      if (existing) {
        existing.ref = ref;
      } else names.push({ name: op.name, ref });
      draft.names = names;
      break;
    }
    case 'remove_name': {
      const names = draft.names ?? [];
      const index = names.findIndex((candidate) => sameName(candidate.name, op.name));
      if (index < 0) {
        ctx.fail(text(ctx, `Name "${op.name}" does not exist.`, `O nome "${op.name}" não existe.`), {
          path: 'name',
          hint: text(
            ctx,
            `Defined names: ${names.map((n) => n.name).join(', ') || 'none'}.`,
            `Nomes definidos: ${names.map((n) => n.name).join(', ') || 'nenhum'}.`,
          ),
        });
      }
      const users: string[] = [];
      for (const sheet of draft.sheets) {
        for (const [key, cell] of Object.entries(sheet.cells))
          if (cell.f && formulaUsesName(cell.f, op.name)) users.push(`${sheet.name}!${key}`);
      }
      if (users.length > 0) {
        ctx.fail(
          text(
            ctx,
            `Name "${op.name}" is used by ${users.slice(0, 5).join(', ')}.`,
            `O nome "${op.name}" é usado por ${users.slice(0, 5).join(', ')}.`,
          ),
          {
            path: 'name',
            hint: text(ctx, 'Change those formulas first.', 'Altere essas fórmulas antes.'),
          },
        );
      }
      names.splice(index, 1);
      if (names.length > 0) draft.names = names;
      else delete draft.names;
      break;
    }
    case 'set_validation': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const rect = rangeOrFail(op.range, ctx, 'range');
      const kept = (sheet.validations ?? []).flatMap((validation) => {
        const other = parseRange(validation.range);
        if (!other) return [];
        if (rectEquals(other, rect)) return [];
        return subtractRect(other, rect).map((piece) => ({ ...validation, range: formatRange(piece) }));
      });
      if (op.values !== null)
        kept.push({
          range: formatRange(rect),
          values: op.values,
          ...(op.allowBlank === undefined ? {} : { allowBlank: op.allowBlank }),
        });
      if (kept.length > 0) sheet.validations = kept;
      else delete sheet.validations;
      break;
    }
    case 'fill_range': {
      const sheet = findSheet(draft, op.sheet, ctx);
      const source = rangeOrFail(op.source, ctx, 'source');
      const target = rangeOrFail(op.target, ctx, 'target');
      fillRange(sheet, source, target);
      break;
    }
    case 'set_settings': {
      const settings = { ...draft.settings };
      if (op.calculationDate !== undefined) {
        if (op.calculationDate === null) delete settings.calculationDate;
        else {
          if (serialFromIso(op.calculationDate) === undefined) {
            ctx.fail(
              text(ctx, `Invalid date "${op.calculationDate}".`, `Data inválida "${op.calculationDate}".`),
              { path: 'calculationDate', hint: 'YYYY-MM-DD' },
            );
          }
          settings.calculationDate = op.calculationDate;
        }
      }
      if (op.currency !== undefined) {
        if (op.currency === null) delete settings.currency;
        else settings.currency = op.currency;
      }
      if (Object.keys(settings).length > 0) draft.settings = settings;
      else delete draft.settings;
      break;
    }
  }
}

/** Item targets an operation touches (spec §8.3), in the same vocabulary as `diff`. */
export function operationTargets(op: SheetOperation): string[] {
  const cellTargets = (sheet: string, keys: Iterable<string>) => {
    const out = [`sheet:${sheet}`];
    for (const key of keys) {
      const normalized = normalizeAddress(key);
      if (normalized) out.push(`cell:${sheet}!${normalized}`);
    }
    return out;
  };
  const rangeTargets = (sheet: string, range: string) => {
    const rect = parseRange(range);
    if (!rect || rectSize(rect) > DIFF_DETAIL_LIMIT) return [`sheet:${sheet}`];
    return cellTargets(
      sheet,
      [...rectCells(rect)].map((pos) => cellKey(pos.row, pos.col)),
    );
  };
  switch (op.op) {
    case 'set_cells':
      return cellTargets(op.sheet, Object.keys(op.cells));
    case 'set_range_style':
    case 'set_range_format':
    case 'clear_range':
    case 'sort_range':
      return rangeTargets(op.sheet, op.range);
    case 'fill_range':
      return rangeTargets(op.sheet, op.target);
    case 'insert_rows':
    case 'delete_rows':
    case 'insert_columns':
    case 'delete_columns':
    case 'rename_sheet':
    case 'remove_sheet':
    case 'move_sheet':
    case 'set_sheet_hidden':
      return [`sheet:${op.sheet}`];
    case 'add_sheet':
      return [`sheet:${op.id ?? '+'}`];
    case 'merge_cells':
    case 'unmerge_cells':
    case 'set_validation':
    case 'set_column_width':
    case 'set_row_height':
    case 'set_frozen':
      return [`layout:${op.sheet}`];
    case 'set_name':
    case 'remove_name':
      return [`name:${op.name.toUpperCase()}`];
    case 'set_settings':
      return ['settings'];
  }
}

/** Cells reported one by one in a diff before it is summarized as a sheet-level change. */
export const DIFF_DETAIL_LIMIT = 50;
