import type { ValidationResult } from '@artkit-ai/core';
import { z } from 'zod';
import { formatAddress, parseRange } from './a1.js';

/** Subset of Univer's `IWorkbookData` that the adapter reads and writes (spec §11.1). Other fields pass through. */
export const cellSchema = z
  .object({
    v: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
    f: z.string().optional(),
    t: z.number().int().optional(),
    s: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  })
  .passthrough();

export type SheetCell = z.infer<typeof cellSchema>;

export const sheetSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    name: z.string().min(1).max(31),
    rowCount: z.number().int().min(1).max(10_000),
    columnCount: z.number().int().min(1).max(702),
    cellData: z.record(z.string(), z.record(z.string(), cellSchema)).default({}),
    mergeData: z.array(z.record(z.string(), z.number())).optional(),
    freeze: z
      .object({
        startRow: z.number().int(),
        startColumn: z.number().int(),
        ySplit: z.number().int(),
        xSplit: z.number().int(),
      })
      .optional(),
  })
  .passthrough();

export type SheetData = z.infer<typeof sheetSchema>;

export const MAX_VALIDATIONS = 100;

export const validationSchema = z.object({
  sheet: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  range: z.string().min(1).max(40),
  list: z.array(z.string().min(1).max(100)).min(1).max(50),
});

export type ValidationRule = z.infer<typeof validationSchema>;

export const workbookSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    name: z.string().min(1).max(120),
    locale: z.string().optional(),
    sheetOrder: z.array(z.string()),
    sheets: z.record(z.string(), sheetSchema),
    styles: z.record(z.string(), z.unknown()).default({}),
    appVersion: z.string().optional(),
    /** Dropdown rules of the format (spec §11.4 `set_validation`): allowed values of a range of a sheet. */
    validations: z.array(validationSchema).max(MAX_VALIDATIONS).optional(),
  })
  .passthrough();

export type WorkbookContent = z.infer<typeof workbookSchema>;

export const MAX_SHEETS = 20;
export const MAX_FILLED_CELLS = 50_000;
export const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:]/;

/** Functions that read the clock or randomness during recalculation (not allowed: apply must be deterministic). */
export const VOLATILE_FUNCTIONS = ['TODAY', 'NOW', 'RAND', 'RANDBETWEEN'] as const;
/** Functions with external effects (spec §18). */
export const EXTERNAL_FUNCTIONS = [
  'WEBSERVICE',
  'IMPORTDATA',
  'IMPORTXML',
  'IMPORTRANGE',
  'IMPORTHTML',
  'CALL',
  'REGISTER.ID',
  'INDIRECT',
  'OFFSET',
] as const;

export function emptyWorkbook(id = 'wb_1', name = 'Planilha', locale = 'pt-BR'): WorkbookContent {
  return {
    id,
    name,
    locale,
    sheetOrder: ['sheet1'],
    sheets: { sheet1: { id: 'sheet1', name: 'Plan1', rowCount: 100, columnCount: 26, cellData: {} } },
    styles: {},
    appVersion: '1',
  };
}

/** Sheets in tab order. */
export function orderedSheets(content: WorkbookContent): SheetData[] {
  return content.sheetOrder
    .map((id) => content.sheets[id])
    .filter((sheet): sheet is SheetData => sheet !== undefined);
}

/** Resolves a sheet by id or by name (case-insensitive). */
export function findSheet(content: WorkbookContent, ref: string): SheetData | undefined {
  const byId = content.sheets[ref];
  if (byId) return byId;
  const lower = ref.toLowerCase();
  return orderedSheets(content).find((sheet) => sheet.name.toLowerCase() === lower);
}

export function filledCells(content: WorkbookContent): number {
  let count = 0;
  for (const sheet of orderedSheets(content)) {
    for (const row of Object.values(sheet.cellData))
      count += Object.values(row).filter((cell) => cell.v != null || cell.f).length;
  }
  return count;
}

/** Formula names used in a formula text (e.g. `=SUMIF(…)` → SUMIF). */
export function formulaFunctions(formula: string): string[] {
  return [...formula.toUpperCase().matchAll(/([A-Z][A-Z0-9.]*)\s*\(/g)].map((match) => match[1]!);
}

/** Validates the workbook beyond the schema: names, sheet count, filled cells and forbidden functions. */
export function validateWorkbook(raw: unknown): ValidationResult<WorkbookContent> {
  const parsed = workbookSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: ['content', ...issue.path.map(String)].join('.'),
        message: issue.message,
        hint: 'Envie um IWorkbookData do Univer com id, name, sheetOrder e sheets.',
      })),
    };
  }
  const content = parsed.data;
  const issues: { path: string; message: string; hint?: string }[] = [];
  const sheets = orderedSheets(content);
  if (sheets.length !== Object.keys(content.sheets).length || sheets.length !== content.sheetOrder.length) {
    issues.push({
      path: 'content.sheetOrder',
      message: 'sheetOrder precisa listar exatamente as abas.',
      hint: 'Use os ids das abas em sheets.',
    });
  }
  if (sheets.length > MAX_SHEETS) {
    issues.push({
      path: 'content.sheets',
      message: `Máximo de ${MAX_SHEETS} abas.`,
      hint: 'Divida a planilha em mais artefatos.',
    });
  }
  const names = new Set<string>();
  for (const sheet of sheets) {
    const key = sheet.name.toLowerCase();
    if (SHEET_NAME_FORBIDDEN.test(sheet.name)) {
      issues.push({
        path: `content.sheets.${sheet.id}.name`,
        message: `O nome "${sheet.name}" tem caracteres proibidos.`,
        hint: 'Não use \\ / ? * [ ] :',
      });
    }
    if (names.has(key)) {
      issues.push({
        path: `content.sheets.${sheet.id}.name`,
        message: `O nome de aba "${sheet.name}" está repetido.`,
        hint: 'Cada aba precisa de um nome único.',
      });
    }
    names.add(key);
    for (const [row, cells] of Object.entries(sheet.cellData)) {
      for (const [column, cell] of Object.entries(cells)) {
        const where = `${sheet.name}!${formatAddress(Number(row), Number(column))}`;
        if (cell.f) {
          for (const fn of formulaFunctions(cell.f)) {
            if ((VOLATILE_FUNCTIONS as readonly string[]).includes(fn)) {
              issues.push({
                path: `content.sheets.${sheet.id}.cellData.${row}.${column}.f`,
                message: `${where} usa ${fn}(), que lê o relógio ou o acaso a cada recálculo.`,
                hint: 'Guarde a data como valor fixo numa célula de premissas e referencie essa célula.',
              });
            }
            if ((EXTERNAL_FUNCTIONS as readonly string[]).includes(fn)) {
              issues.push({
                path: `content.sheets.${sheet.id}.cellData.${row}.${column}.f`,
                message: `${where} usa ${fn}(), que tem efeitos externos e não é permitida.`,
                hint: 'Use apenas funções de cálculo local.',
              });
            }
          }
        }
      }
    }
  }
  for (const [index, rule] of (content.validations ?? []).entries()) {
    if (!content.sheets[rule.sheet]) {
      issues.push({
        path: `content.validations.${index}.sheet`,
        message: `A regra aponta para a aba "${rule.sheet}", que não existe.`,
        hint: 'Use o id de uma aba listada no outline.',
      });
    }
    if (!parseRange(rule.range)) {
      issues.push({
        path: `content.validations.${index}.range`,
        message: `"${rule.range}" não é um intervalo A1.`,
        hint: 'Use formatos como "C2:C9".',
      });
    }
  }
  if (filledCells(content) > MAX_FILLED_CELLS) {
    issues.push({
      path: 'content',
      message: `Máximo de ${MAX_FILLED_CELLS} células preenchidas.`,
      hint: 'Divida os dados em mais planilhas.',
    });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, content };
}
