import { type AdapterContext, resolveColor } from '@artkit-ai/core';
import { z } from 'zod';
import { type CellRange, columnToIndex, indexToColumn, parseAddress, parseRange } from './a1.js';
import { findSheet, type WorkbookContent } from './model.js';

const sheetRef = z.string().min(1).max(64).describe('Sheet id or name, from the outline.');
const rangeRef = z.string().min(1).max(40).describe('A1 range, e.g. "A1" or "B2:D9".');
const letters = z
  .string()
  .regex(/^[A-Za-z]{1,3}$/)
  .describe('Column letters, e.g. "C".');
const cellValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

export const sheetOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('set_values'),
      sheet: sheetRef,
      at: rangeRef.describe('Top-left cell of the matrix.'),
      values: z.array(z.array(cellValue)).min(1).max(500),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_format'),
      sheet: sheetRef,
      range: rangeRef,
      format: z.enum(['integer', 'decimal', 'percent', 'currency', 'date', 'text']),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_style'),
      sheet: sheetRef,
      range: rangeRef,
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      color: z.string().max(40).optional().describe('Theme token (e.g. "accent") or hex color.'),
      background: z.string().max(40).optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      wrap: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('insert_rows'),
      sheet: sheetRef,
      at: z.number().int().min(1).max(10_000),
      count: z.number().int().min(1).max(500),
    })
    .strict(),
  z
    .object({
      op: z.literal('delete_rows'),
      sheet: sheetRef,
      from: z.number().int().min(1).max(10_000),
      count: z.number().int().min(1).max(500),
    })
    .strict(),
  z
    .object({
      op: z.literal('insert_columns'),
      sheet: sheetRef,
      at: letters,
      count: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal('delete_columns'),
      sheet: sheetRef,
      from: letters,
      count: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal('add_sheet'),
      name: z.string().min(1).max(31),
      index: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ op: z.literal('rename_sheet'), sheet: sheetRef, name: z.string().min(1).max(31) }).strict(),
  z.object({ op: z.literal('move_sheet'), sheet: sheetRef, index: z.number().int().min(0) }).strict(),
  z.object({ op: z.literal('remove_sheet'), sheet: sheetRef }).strict(),
  z.object({ op: z.literal('merge'), sheet: sheetRef, range: rangeRef }).strict(),
  z.object({ op: z.literal('unmerge'), sheet: sheetRef, range: rangeRef }).strict(),
  z
    .object({
      op: z.literal('set_column_width'),
      sheet: sheetRef,
      column: letters,
      width: z.number().int().min(20).max(1000),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_row_height'),
      sheet: sheetRef,
      row: z.number().int().min(1).max(10_000),
      height: z.number().int().min(10).max(1000),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_frozen'),
      sheet: sheetRef,
      rows: z.number().int().min(0).max(100),
      columns: z.number().int().min(0).max(26),
    })
    .strict(),
  z
    .object({
      op: z.literal('clear_range'),
      sheet: sheetRef,
      range: rangeRef,
      what: z.enum(['values', 'all']),
    })
    .strict(),
  z
    .object({
      op: z.literal('fill_range'),
      sheet: sheetRef,
      from: z.string().min(1).max(20).describe('Source cell, e.g. "D2"; its value or formula is copied.'),
      to: rangeRef.describe(
        'Destination range, e.g. "D2:D9"; relative references shift by the distance from the source.',
      ),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_validation'),
      sheet: sheetRef,
      range: rangeRef.describe('Cells that accept only the listed values (a dropdown in the grid).'),
      list: z.array(z.string().min(1).max(100)).min(1).max(50).describe('Allowed values, in dropdown order.'),
    })
    .strict(),
]);

/** Style changes in semantic form; the engine maps them to Univer style commands. */
export interface SheetStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
}

export type SheetOperation = z.infer<typeof sheetOperationSchema>;

export const SHEET_OPERATION_NAMES = [
  'set_values',
  'set_format',
  'set_style',
  'insert_rows',
  'delete_rows',
  'insert_columns',
  'delete_columns',
  'add_sheet',
  'rename_sheet',
  'move_sheet',
  'remove_sheet',
  'merge',
  'unmerge',
  'set_column_width',
  'set_row_height',
  'set_frozen',
  'clear_range',
  'fill_range',
  'set_validation',
] as const;

/** Shifts the relative A1 references of a formula by a row and column distance (`$` anchors stay). */
export function shiftFormula(formula: string, rows: number, columns: number): string {
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_(!])/g,
    (_match, colAbs: string, col: string, rowAbs: string, row: string) => {
      const column = colAbs ? col : indexToColumn(columnToIndex(col) + columns);
      const rowNumber = rowAbs ? row : String(Number(row) + rows);
      return `${colAbs}${column}${rowAbs}${rowNumber}`;
    },
  );
}

/** Operation with its sheet and addresses resolved to zero-based indexes, ready for the engine. */
export type ResolvedOperation =
  | {
      kind: 'set_values';
      sheetId: string;
      row: number;
      column: number;
      values: (string | number | boolean | null)[][];
    }
  | { kind: 'set_format'; sheetId: string; range: CellRange; pattern: string }
  | { kind: 'set_style'; sheetId: string; range: CellRange; style: SheetStyle }
  | { kind: 'insert_rows'; sheetId: string; at: number; count: number }
  | { kind: 'delete_rows'; sheetId: string; from: number; count: number }
  | { kind: 'insert_columns'; sheetId: string; at: number; count: number }
  | { kind: 'delete_columns'; sheetId: string; from: number; count: number }
  | { kind: 'add_sheet'; sheetId: string; name: string; index: number | undefined }
  | { kind: 'rename_sheet'; sheetId: string; name: string }
  | { kind: 'move_sheet'; sheetId: string; index: number }
  | { kind: 'remove_sheet'; sheetId: string }
  | { kind: 'merge' | 'unmerge'; sheetId: string; range: CellRange }
  | { kind: 'set_column_width'; sheetId: string; column: number; width: number }
  | { kind: 'set_row_height'; sheetId: string; row: number; height: number }
  | { kind: 'set_frozen'; sheetId: string; rows: number; columns: number }
  | { kind: 'clear_range'; sheetId: string; range: CellRange; what: 'values' | 'all' }
  | { kind: 'set_validation'; sheetId: string; range: CellRange; list: string[] };

const FORMAT_PATTERNS = {
  integer: '#,##0',
  decimal: '#,##0.00',
  percent: '0.00%',
  text: '@',
} as const;

function currencyPattern(locale: string): string {
  return locale.toLowerCase().startsWith('pt') ? '"R$" #,##0.00' : '"$" #,##0.00';
}

function datePattern(locale: string): string {
  return locale.toLowerCase().startsWith('pt') ? 'dd/mm/yyyy' : 'yyyy-mm-dd';
}

/** Resolves sheet references and A1 addresses against the current content, failing with model-facing hints. */
export function resolveOperation(
  content: WorkbookContent,
  op: SheetOperation,
  index: number,
  ctx: AdapterContext,
  nextSheetId: () => string,
): ResolvedOperation {
  const sheet = (ref: string, path = 'sheet') => {
    const found = findSheet(content, ref);
    if (!found) {
      ctx.fail(`A aba "${ref}" não existe.`, {
        path,
        hint: `Use uma destas abas: ${content.sheetOrder.map((id) => content.sheets[id]?.name).join(', ')}.`,
      });
    }
    return found.id;
  };
  const range = (text: string, path = 'range') => {
    const parsed = parseRange(text);
    if (!parsed)
      ctx.fail(`O intervalo "${text}" não é um endereço A1 válido.`, {
        path,
        hint: 'Use formatos como "B2" ou "A1:D9".',
      });
    return parsed;
  };
  const freshName = (name: string) => {
    const taken = content.sheetOrder.some(
      (id) => content.sheets[id]?.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken)
      ctx.fail(`Já existe uma aba chamada "${name}".`, { path: 'name', hint: 'Escolha outro nome.' });
  };
  switch (op.op) {
    case 'set_values': {
      const start = range(op.at, 'at');
      return {
        kind: 'set_values',
        sheetId: sheet(op.sheet),
        row: start.startRow,
        column: start.startColumn,
        values: op.values,
      };
    }
    case 'set_format': {
      const pattern =
        op.format === 'currency'
          ? currencyPattern(content.locale ?? 'en')
          : op.format === 'date'
            ? datePattern(content.locale ?? 'en')
            : FORMAT_PATTERNS[op.format];
      return { kind: 'set_format', sheetId: sheet(op.sheet), range: range(op.range), pattern };
    }
    case 'set_style': {
      const style: SheetStyle = {};
      if (op.bold !== undefined) style.bold = op.bold;
      if (op.italic !== undefined) style.italic = op.italic;
      if (op.color !== undefined) style.color = resolveColor(ctx.theme, op.color);
      if (op.background !== undefined) style.background = resolveColor(ctx.theme, op.background);
      if (op.align !== undefined) style.align = op.align;
      if (op.wrap !== undefined) style.wrap = op.wrap;
      return { kind: 'set_style', sheetId: sheet(op.sheet), range: range(op.range), style };
    }
    case 'insert_rows':
      return { kind: 'insert_rows', sheetId: sheet(op.sheet), at: op.at - 1, count: op.count };
    case 'delete_rows':
      return { kind: 'delete_rows', sheetId: sheet(op.sheet), from: op.from - 1, count: op.count };
    case 'insert_columns':
      return { kind: 'insert_columns', sheetId: sheet(op.sheet), at: columnToIndex(op.at), count: op.count };
    case 'delete_columns':
      return {
        kind: 'delete_columns',
        sheetId: sheet(op.sheet),
        from: columnToIndex(op.from),
        count: op.count,
      };
    case 'add_sheet':
      freshName(op.name);
      return { kind: 'add_sheet', sheetId: nextSheetId(), name: op.name, index: op.index };
    case 'rename_sheet': {
      const id = sheet(op.sheet);
      freshName(op.name);
      return { kind: 'rename_sheet', sheetId: id, name: op.name };
    }
    case 'move_sheet':
      return { kind: 'move_sheet', sheetId: sheet(op.sheet), index: op.index };
    case 'remove_sheet': {
      if (content.sheetOrder.length === 1)
        ctx.fail('A planilha precisa ter pelo menos uma aba.', {
          hint: 'Adicione outra aba antes de remover esta.',
        });
      return { kind: 'remove_sheet', sheetId: sheet(op.sheet) };
    }
    case 'merge':
    case 'unmerge':
      return { kind: op.op, sheetId: sheet(op.sheet), range: range(op.range) };
    case 'set_column_width':
      return {
        kind: 'set_column_width',
        sheetId: sheet(op.sheet),
        column: columnToIndex(op.column),
        width: op.width,
      };
    case 'set_row_height':
      return { kind: 'set_row_height', sheetId: sheet(op.sheet), row: op.row - 1, height: op.height };
    case 'set_frozen':
      return { kind: 'set_frozen', sheetId: sheet(op.sheet), rows: op.rows, columns: op.columns };
    case 'clear_range':
      return { kind: 'clear_range', sheetId: sheet(op.sheet), range: range(op.range), what: op.what };
    case 'set_validation':
      return { kind: 'set_validation', sheetId: sheet(op.sheet), range: range(op.range), list: op.list };
    case 'fill_range': {
      const sheetId = sheet(op.sheet);
      const source = parseAddress(op.from);
      if (!source)
        ctx.fail(`"${op.from}" não é um endereço A1 válido.`, {
          path: 'from',
          hint: 'Use uma célula como "D2".',
        });
      const target = range(op.to, 'to');
      const cell = content.sheets[sheetId]?.cellData[String(source.row)]?.[String(source.column)];
      const values: (string | number | boolean | null)[][] = [];
      for (let row = target.startRow; row <= target.endRow; row++) {
        const line: (string | number | boolean | null)[] = [];
        for (let column = target.startColumn; column <= target.endColumn; column++) {
          const rowDelta = row - source.row;
          const columnDelta = column - source.column;
          if (cell?.f) line.push(`=${shiftFormula(cell.f.replace(/^=/, ''), rowDelta, columnDelta)}`);
          else line.push(cell?.v ?? null);
        }
        values.push(line);
      }
      return { kind: 'set_values', sheetId, row: target.startRow, column: target.startColumn, values };
    }
    default:
      ctx.fail(`Operação ${index} desconhecida.`);
  }
}
