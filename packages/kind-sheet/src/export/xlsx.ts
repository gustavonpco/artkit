import { type ArtifactExporter, type ExportContext, resolveColor } from '@artkit/core';
import type ExcelJS from 'exceljs';
import { columnIndex, parseCellKey } from '../address.js';
import { resolveCurrency, xlsxNumberFormat } from '../display.js';
import type { Cell, CellStyle, SheetContent } from '../schema.js';
import { isErrorValue } from '../schema.js';

type ExcelModule = typeof ExcelJS;

async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as unknown as { default?: ExcelModule } & ExcelModule;
  return mod.default ?? mod;
}

/** `#14AB83` → `FF14AB83` (exceljs ARGB). */
function argb(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`;
}

function cellValue(cell: Cell): ExcelJS.CellValue {
  const literal = (value: Cell['v']) =>
    isErrorValue(value) ? ({ error: value.error } as ExcelJS.CellErrorValue) : value;
  if (cell.f !== undefined) {
    const result = cell.v === undefined ? undefined : literal(cell.v);
    return { formula: cell.f, ...(result === undefined ? {} : { result }) } as ExcelJS.CellFormulaValue;
  }
  return cell.v === undefined ? null : (literal(cell.v) as ExcelJS.CellValue);
}

function applyStyle(target: ExcelJS.Cell, style: CellStyle, ctx: ExportContext): void {
  const font: Partial<ExcelJS.Font> = {};
  if (style.bold) font.bold = true;
  if (style.italic) font.italic = true;
  if (style.underline) font.underline = true;
  if (style.strike) font.strike = true;
  if (style.fontSize) font.size = style.fontSize;
  if (style.color) font.color = { argb: argb(resolveColor(ctx.theme, style.color)) };
  if (Object.keys(font).length > 0) target.font = font;
  if (style.background) {
    target.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: argb(resolveColor(ctx.theme, style.background)) },
    };
  }
  const alignment: Partial<ExcelJS.Alignment> = {};
  if (style.align) alignment.horizontal = style.align;
  if (style.valign) alignment.vertical = style.valign;
  if (style.wrap) alignment.wrapText = true;
  if (Object.keys(alignment).length > 0) target.alignment = alignment;
  if (style.border) {
    const color = style.border.color
      ? { argb: argb(resolveColor(ctx.theme, style.border.color)) }
      : undefined;
    const border: Partial<ExcelJS.Borders> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const kind = style.border[side];
      if (kind) border[side] = { style: kind, ...(color ? { color } : {}) };
    }
    target.border = border;
  }
}

/** Data-validation list formula: a quoted, comma-separated list limited to 255 characters by Excel. */
function listFormula(values: (string | number)[]): string | undefined {
  const items = values.map(String);
  if (items.some((item) => item.includes(',') || item.includes('"'))) return undefined;
  const joined = items.join(',');
  return joined.length > 255 ? undefined : `"${joined}"`;
}

/** Builds the workbook in memory (shared by the exporter and tests). */
export async function buildWorkbook(content: SheetContent, ctx: ExportContext): Promise<ExcelJS.Workbook> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  wb.title = ctx.title;
  wb.creator = 'artkit';
  wb.calcProperties.fullCalcOnLoad = true;
  const display = { locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) };
  for (const sheet of content.sheets) {
    const frozen =
      sheet.frozen && (sheet.frozen.rows > 0 || sheet.frozen.cols > 0) ? sheet.frozen : undefined;
    const ws = wb.addWorksheet(sheet.name, {
      state: sheet.hidden ? 'hidden' : 'visible',
      views: frozen ? [{ state: 'frozen', xSplit: frozen.cols, ySplit: frozen.rows }] : [],
    });
    for (const [letter, column] of Object.entries(sheet.columns ?? {}))
      ws.getColumn(columnIndex(letter) + 1).width = column.width;
    for (const [row, value] of Object.entries(sheet.rows ?? {})) ws.getRow(Number(row)).height = value.height;
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (!parseCellKey(key)) continue;
      const target = ws.getCell(key);
      target.value = cellValue(cell);
      if (cell.fmt && cell.fmt !== 'general') target.numFmt = xlsxNumberFormat(cell.fmt, display);
      if (cell.s) applyStyle(target, cell.s, ctx);
      if (cell.note) target.note = cell.note;
    }
    for (const merge of sheet.merges ?? []) ws.mergeCells(merge);
    const validations = (
      ws as unknown as { dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void } }
    ).dataValidations;
    for (const validation of sheet.validations ?? []) {
      const formula = listFormula(validation.values);
      if (!formula) {
        ctx.warn(
          `Validation ${sheet.name}!${validation.range} was not exported: Excel lists cannot contain commas or quotes and are limited to 255 characters.`,
        );
        continue;
      }
      validations.add(validation.range, {
        type: 'list',
        allowBlank: validation.allowBlank ?? true,
        formulae: [formula],
        showErrorMessage: true,
      });
    }
  }
  for (const name of content.names ?? []) {
    if (name.ref.includes('#REF!')) {
      ctx.warn(`Name ${name.name} was not exported because its reference is #REF!.`);
      continue;
    }
    wb.definedNames.add(name.ref, name.name);
  }
  return wb;
}

export const sheetXlsxExporter: ArtifactExporter<SheetContent> = {
  kind: 'sheet',
  format: 'xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
  runtime: 'any',
  async export(content, ctx) {
    const wb = await buildWorkbook(content, ctx);
    const buffer = await wb.xlsx.writeBuffer();
    return new Uint8Array(buffer as ArrayBuffer);
  },
};
