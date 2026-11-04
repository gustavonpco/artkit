import { ArtifactError, type ContentInput, type InputContext, zodIssuesToErrorIssues } from '@artkit-ai/core';
import { z } from 'zod';
import { cellKey, columnLetter, MAX_COLS, MAX_ROWS, SHEET_NAME_PATTERN } from './address.js';
import { type CsvDelimiter, parseCsv } from './csv.js';
import { formatCellValue, resolveCurrency } from './display.js';
import { canonicalFormula } from './formula/rewrite.js';
import { type InferredValue, inferValue } from './infer.js';
import type { Cell, NamedFormat, SheetContent } from './schema.js';

const scalar = z.union([z.string().max(32_767), z.number(), z.boolean(), z.null()]);

export const tableInputSchema = z
  .object({
    name: z
      .string()
      .regex(SHEET_NAME_PATTERN)
      .optional()
      .describe('Sheet name (default "Sheet1", "Planilha1" in Portuguese).'),
    header: z.array(z.string().max(255)).min(1).max(1000).describe('Column titles (row 1, bold and frozen).'),
    rows: z
      .array(z.array(scalar).max(1000))
      .max(MAX_ROWS - 1)
      .describe(
        'Rows of values. Text is typed: "1.234,56", "15%", "R$ 10", "2026-11-09", "TRUE"; "=..." is a formula.',
      ),
  })
  .strict();

export const csvInputSchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1).describe('CSV text (RFC 4180).'),
      delimiter: z.enum([',', ';', '\t']).optional().describe('Detected when omitted.'),
      name: z.string().regex(SHEET_NAME_PATTERN).optional(),
      header: z.boolean().optional().describe('First row is a header (default true).'),
    })
    .strict(),
]);

export type TableInput = z.infer<typeof tableInputSchema>;
export type CsvInput = z.infer<typeof csvInputSchema>;

function defaultName(locale: string): string {
  return locale.toLowerCase().startsWith('pt') ? 'Planilha1' : 'Sheet1';
}

function slugId(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return /^[a-z0-9]/.test(slug) ? slug : 'sheet1';
}

function invalid(message: string, path: string): never {
  throw new ArtifactError('INVALID_CONTENT', message, { issues: [{ path, message }] });
}

function toCell(value: string | number | boolean | null, locale: string): InferredValue | undefined {
  if (value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return { v: value };
  return inferValue(value, locale);
}

/**
 * Builds a one-sheet workbook from a header and rows (deterministic). Values are typed by the locale and a
 * column whose values share a format (percent, currency, date) gets it on every cell. Widths follow content.
 */
export function tableToContent(input: TableInput, ctx: InputContext): SheetContent {
  const locale = ctx.locale;
  const width = Math.max(input.header.length, ...input.rows.map((row) => row.length));
  if (width > MAX_COLS) invalid(`Too many columns (${width}).`, 'input.header');
  const inferred = input.rows.map((row) =>
    Array.from({ length: width }, (_, col) => toCell(row[col] ?? null, locale)),
  );
  const columnFormats: (NamedFormat | undefined)[] = Array.from({ length: width }, (_, col) => {
    const formats = new Set(
      inferred
        .map((row) => row[col])
        .filter((cell) => cell?.v !== undefined)
        .map((cell) => cell!.fmt),
    );
    const [only] = [...formats];
    return formats.size === 1 && only !== undefined ? only : undefined;
  });
  const cells: Record<string, Cell> = {};
  input.header.forEach((title, col) => {
    if (title !== '') cells[cellKey(0, col)] = { v: title, s: { bold: true, background: 'surface' } };
  });
  inferred.forEach((row, r) => {
    row.forEach((value, col) => {
      if (!value) return;
      const cell: Cell = {};
      if (value.f !== undefined) cell.f = canonicalFormula(value.f);
      else if (value.v !== undefined) cell.v = value.v;
      const fmt = value.fmt ?? (typeof value.v === 'number' ? columnFormats[col] : undefined);
      if (fmt) cell.fmt = fmt;
      cells[cellKey(r + 1, col)] = cell;
    });
  });
  const display = { locale, currency: resolveCurrency({}, locale) };
  const columns: Record<string, { width: number }> = {};
  for (let col = 0; col < width; col++) {
    let longest = [...(input.header[col] ?? '')].length + 2;
    for (let r = 0; r < input.rows.length && r < 500; r++) {
      const cell = cells[cellKey(r + 1, col)];
      if (cell?.v !== undefined)
        longest = Math.max(longest, [...formatCellValue(cell.v, cell.fmt, display)].length + 1);
    }
    const chars = Math.min(60, Math.max(8, longest));
    if (chars !== 10) columns[columnLetter(col)] = { width: chars };
  }
  const name = input.name ?? defaultName(locale);
  return {
    sheets: [
      {
        id: slugId(name),
        name,
        cells,
        ...(Object.keys(columns).length > 0 ? { columns } : {}),
        frozen: { rows: 1, cols: 0 },
      },
    ],
  };
}

/** Parses CSV (delimiter detection for `,` `;` and tab) and converts it like the `table` input. */
export function csvToContent(input: CsvInput, ctx: InputContext): SheetContent {
  const options = typeof input === 'string' ? { text: input } : input;
  const rows = parseCsv(options.text, options.delimiter as CsvDelimiter | undefined);
  if (rows.length === 0) invalid('The CSV is empty.', 'input');
  if (options.header === false) {
    const width = Math.max(...rows.map((row) => row.length));
    const content = tableToContent(
      {
        ...(options.name ? { name: options.name } : {}),
        header: Array.from({ length: width }, () => ''),
        rows,
      },
      ctx,
    );
    // Without a header the data starts at row 1.
    const sheet = content.sheets[0]!;
    const shifted: Record<string, Cell> = {};
    for (const [key, cell] of Object.entries(sheet.cells)) {
      const match = /^([A-Z]+)(\d+)$/.exec(key)!;
      shifted[`${match[1]}${Number(match[2]) - 1}`] = cell;
    }
    sheet.cells = shifted;
    delete sheet.frozen;
    return content;
  }
  const [header, ...body] = rows;
  return tableToContent(
    { ...(options.name ? { name: options.name } : {}), header: header!, rows: body },
    ctx,
  );
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown, locale: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ArtifactError('INVALID_CONTENT', 'Invalid input.', {
      issues: zodIssuesToErrorIssues(parsed.error.issues, locale, 'input'),
    });
  }
  return parsed.data;
}

export const sheetInputs: Record<string, ContentInput<SheetContent>> = {
  table: {
    description:
      'One sheet from {"header": [...], "rows": [[...]]}. Text values are typed by locale (numbers, "15%", "R$ 10", dates, TRUE/FALSE); "=..." is a formula. Header is bold and frozen.',
    schema: tableInputSchema,
    toContent: (input, ctx) => tableToContent(parseInput(tableInputSchema, input, ctx.locale), ctx),
  },
  csv: {
    description:
      'One sheet from CSV text (RFC 4180; delimiter "," ";" or tab detected). Pass a string or {"text", "delimiter"?, "name"?, "header"?}.',
    schema: csvInputSchema,
    toContent: (input, ctx) => csvToContent(parseInput(csvInputSchema, input, ctx.locale), ctx),
  },
};
