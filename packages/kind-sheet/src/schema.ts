import { colorSchema, itemIdSchema } from '@artkit/core';
import { z } from 'zod';
import { SHEET_NAME_PATTERN } from './address.js';

/** Formula error codes, stored as `{ "error": "#DIV/0!" }` in a formula cell's cached value. */
export const FORMULA_ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'] as const;
export type FormulaErrorCode = (typeof FORMULA_ERRORS)[number];

export const NAMED_FORMATS = [
  'general',
  'integer',
  'decimal2',
  'percent',
  'currency',
  'date',
  'datetime',
  'text',
] as const;
export type NamedFormat = (typeof NAMED_FORMATS)[number];

export const errorValueSchema = z
  .object({ error: z.enum(FORMULA_ERRORS) })
  .strict()
  .describe('Formula error result, e.g. {"error":"#DIV/0!"}. Written by the engine, never by hand.');

export const cellValueSchema = z.union([
  z.number().refine(Number.isFinite, 'Numbers must be finite.'),
  z.string().max(32_767),
  z.boolean(),
  errorValueSchema,
]);

export const borderStyleSchema = z.enum(['thin', 'medium', 'thick', 'dashed', 'dotted', 'double']);

export const borderSchema = z
  .object({
    top: borderStyleSchema.optional(),
    right: borderStyleSchema.optional(),
    bottom: borderStyleSchema.optional(),
    left: borderStyleSchema.optional(),
    color: colorSchema.optional(),
  })
  .strict();

export const cellStyleSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    fontSize: z.number().int().min(6).max(48).optional().describe('Font size in points (default 11).'),
    color: colorSchema.optional().describe('Text color.'),
    background: colorSchema.optional().describe('Fill color.'),
    align: z.enum(['left', 'center', 'right']).optional(),
    valign: z.enum(['top', 'middle', 'bottom']).optional(),
    wrap: z.boolean().optional(),
    border: borderSchema.optional(),
  })
  .strict();

export const namedFormatSchema = z
  .enum(NAMED_FORMATS)
  .describe(
    'general, integer, decimal2, percent (0.15 shows 15%), currency (currency of the locale), date, datetime, text.',
  );

export const cellSchema = z
  .object({
    v: cellValueSchema
      .optional()
      .describe(
        'Literal value, or the cached result of `f` (computed by the engine; do not write it for formulas).',
      ),
    f: z
      .string()
      .min(1)
      .max(8192)
      .optional()
      .describe('Formula without the leading "=", e.g. "SUM(B2:B9)". A leading "=" is accepted and removed.'),
    fmt: namedFormatSchema.optional(),
    s: cellStyleSchema.optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();

export const cellKeySchema = z
  .string()
  .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/, 'Cell keys are A1 addresses like "B12".');
export const columnKeySchema = z.string().regex(/^[A-Z]{1,3}$/, 'Column keys are letters like "C".');
export const rowKeySchema = z.string().regex(/^[1-9][0-9]{0,5}$/, 'Row keys are 1-based numbers like "3".');

export const columnSchema = z
  .object({ width: z.number().min(4).max(80).describe('Width in characters (4–80).') })
  .strict();
export const rowSchema = z
  .object({ height: z.number().min(6).max(409).describe('Height in points (6–409).') })
  .strict();

export const frozenSchema = z
  .object({
    rows: z.number().int().min(0).max(1000).default(0),
    cols: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export const validationSchema = z
  .object({
    range: z.string().min(2).max(32).describe('A1 range on this sheet, e.g. "C2:C50".'),
    values: z
      .array(z.union([z.string().min(1).max(255), z.number()]))
      .min(1)
      .max(500)
      .describe('Allowed values (dropdown list).'),
    allowBlank: z.boolean().optional(),
  })
  .strict();

export const sheetNameSchema = z
  .string()
  .regex(
    SHEET_NAME_PATTERN,
    'Sheet names have 1–31 characters, none of \\ / ? * [ ] : and do not start or end with an apostrophe.',
  );

export const sheetSchema = z
  .object({
    id: itemIdSchema,
    name: sheetNameSchema,
    cells: z.record(cellKeySchema, cellSchema).default({}).describe('Cells keyed by A1 address.'),
    columns: z.record(columnKeySchema, columnSchema).optional().describe('Column widths keyed by letter.'),
    rows: z.record(rowKeySchema, rowSchema).optional().describe('Row heights keyed by 1-based row number.'),
    frozen: frozenSchema.optional(),
    merges: z.array(z.string().min(5).max(32)).optional().describe('Merged ranges like "A1:D1".'),
    validations: z.array(validationSchema).optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

export const definedNameSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(
        /^[\p{L}_\\][\p{L}\p{N}_.]*$/u,
        'Names start with a letter or "_" and use letters, digits, "_" or ".".',
      )
      .describe('Workbook name usable in formulas, e.g. "valor_hora".'),
    ref: z
      .string()
      .min(2)
      .max(300)
      .describe('Reference with sheet name, e.g. "Parametros!$B$2" or "\'Estimativa 2\'!A1:A20".'),
  })
  .strict();

export const settingsSchema = z
  .object({
    calculationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
      .optional()
      .describe('Date returned by TODAY(). Formulas never read the clock.'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Use an ISO 4217 code like "BRL".')
      .optional()
      .describe('Currency for the "currency" format. Defaults to the currency of the locale.'),
  })
  .strict();

export const sheetContentSchema = z
  .object({
    sheets: z.array(sheetSchema).min(1),
    names: z.array(definedNameSchema).optional(),
    settings: settingsSchema.optional(),
  })
  .strict();

export type CellErrorValue = z.infer<typeof errorValueSchema>;
export type CellValue = z.infer<typeof cellValueSchema>;
export type BorderStyle = z.infer<typeof borderStyleSchema>;
export type CellBorder = z.infer<typeof borderSchema>;
export type CellStyle = z.infer<typeof cellStyleSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type SheetValidation = z.infer<typeof validationSchema>;
export type Sheet = z.infer<typeof sheetSchema>;
export type DefinedName = z.infer<typeof definedNameSchema>;
export type SheetSettings = z.infer<typeof settingsSchema>;
export type SheetContent = z.infer<typeof sheetContentSchema>;

/** Initial limits (spec §6.6). */
export const SHEET_LIMITS = {
  sheets: 20,
  cells: 50_000,
  columns: 16_384,
  rows: 100_000,
} as const;

export function isErrorValue(value: unknown): value is CellErrorValue {
  return (
    typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'
  );
}
