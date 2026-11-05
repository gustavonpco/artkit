import type { ArtifactExporter, ExportContext } from '@artkit-ai/core';
import {
  type CellRange,
  formatAddress,
  orderedSheets,
  type SheetData,
  type WorkbookContent,
} from '@artkit-ai/format-sheet';
import ExcelJS from 'exceljs';

/** Excel column width in characters from the pixel width used by Univer. */
function widthChars(px: number): number {
  return Math.max(8, Math.round(px / 7));
}

function addressToCell(row: number, column: number): string {
  return formatAddress(row, column);
}

/** Maps a Univer style id or inline style to Excel font and number format (spec §11.7). */
function styleOf(
  workbook: WorkbookContent,
  cell: { s?: unknown },
): { font?: Partial<ExcelJS.Font>; numFmt?: string; alignment?: Partial<ExcelJS.Alignment> } {
  const raw =
    typeof cell.s === 'string'
      ? (workbook.styles[cell.s] as Record<string, unknown> | undefined)
      : (cell.s as Record<string, unknown> | undefined);
  if (!raw) return {};
  const font: Partial<ExcelJS.Font> = {};
  if (raw.bl === 1) font.bold = true;
  if (raw.it === 1) font.italic = true;
  const color = raw.cl as { rgb?: string } | undefined;
  if (color?.rgb) font.color = { argb: `FF${color.rgb.replace('#', '').toUpperCase()}` };
  const numFmt = (raw.n as { pattern?: string } | undefined)?.pattern;
  const alignment: Partial<ExcelJS.Alignment> = {};
  if (raw.ht === 2) alignment.horizontal = 'center';
  if (raw.ht === 3) alignment.horizontal = 'right';
  if (raw.tb === 3) alignment.wrapText = true;
  return { font, ...(numFmt ? { numFmt } : {}), alignment };
}

function fillSheet(
  book: ExcelJS.Workbook,
  source: SheetData,
  workbook: WorkbookContent,
  warn: (message: string) => void,
): void {
  const sheet = book.addWorksheet(source.name.slice(0, 31));
  sheet.views = source.freeze
    ? [
        {
          state: 'frozen',
          xSplit: source.freeze.xSplit,
          ySplit: source.freeze.ySplit,
          topLeftCell: addressToCell(
            Math.max(source.freeze.startRow, 0),
            Math.max(source.freeze.startColumn, 0),
          ),
        },
      ]
    : [];
  for (const [row, cells] of Object.entries(source.cellData)) {
    for (const [column, cell] of Object.entries(cells)) {
      const target = sheet.getCell(Number(row) + 1, Number(column) + 1);
      if (cell.f) {
        target.value = {
          formula: cell.f.replace(/^=/, ''),
          result: (cell.v ?? undefined) as ExcelJS.CellFormulaValue['result'],
        };
      } else if (cell.v !== undefined && cell.v !== null) {
        target.value = cell.v as ExcelJS.CellValue;
      }
      const style = styleOf(workbook, cell);
      if (style.font) target.font = style.font;
      if (style.numFmt) target.numFmt = style.numFmt;
      if (style.alignment && Object.keys(style.alignment).length > 0) target.alignment = style.alignment;
    }
  }
  for (const merge of source.mergeData ?? []) {
    const range: CellRange = {
      startRow: Number(merge.startRow),
      endRow: Number(merge.endRow),
      startColumn: Number(merge.startColumn),
      endColumn: Number(merge.endColumn),
    };
    sheet.mergeCells(range.startRow + 1, range.startColumn + 1, range.endRow + 1, range.endColumn + 1);
  }
  for (const [column, data] of Object.entries(source.columnData ?? {})) {
    const width = (data as { w?: number }).w;
    if (width) sheet.getColumn(Number(column) + 1).width = widthChars(width);
  }
  for (const [row, data] of Object.entries(source.rowData ?? {})) {
    const height = (data as { h?: number }).h;
    if (height) sheet.getRow(Number(row) + 1).height = height * 0.75;
  }
  if (
    Object.values(source.cellData).some((cells) =>
      Object.values(cells).some((cell) => cell.f && cell.v === undefined),
    )
  ) {
    warn(`Há fórmulas sem valor calculado na aba "${source.name}"; o Excel recalcula ao abrir.`);
  }
}

/** xlsx exporter: one worksheet per Univer sheet, in tab order. */
export const sheetXlsxExporter: ArtifactExporter<WorkbookContent> = {
  format: 'univer-sheet',
  target: 'xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
  runtime: 'node',
  async export(content: WorkbookContent, ctx: ExportContext): Promise<Uint8Array> {
    const book = new ExcelJS.Workbook();
    book.creator = 'artkit';
    book.created = new Date(0);
    book.title = ctx.title;
    for (const sheet of orderedSheets(content)) fillSheet(book, sheet, content, ctx.warn);
    const buffer = await book.xlsx.writeBuffer();
    return new Uint8Array(buffer as ArrayBuffer);
  },
};

export { sheetXlsxExporter as xlsxExporter };
