import { type ProjectionItem, paginate, type ReadRequest, type ReadResult } from '@artkit-ai/core';
import { type CellRange, formatAddress, formatRange, parseRange } from './a1.js';
import { findSheet, orderedSheets, type SheetData, type WorkbookContent } from './model.js';

/** Display text of a cell: computed value, with the formula after an arrow when there is one (spec §11.3). */
export function displayCell(cell: { v?: unknown; f?: string; s?: unknown } | undefined): string | undefined {
  if (!cell) return undefined;
  const value = cell.v === undefined || cell.v === null ? '' : String(cell.v);
  if (cell.f) return `=${cell.f.replace(/^=/, '')} → ${value}`;
  return value === '' ? undefined : value;
}

function usedRange(sheet: SheetData): CellRange | undefined {
  let minRow = Infinity;
  let maxRow = -1;
  let minCol = Infinity;
  let maxCol = -1;
  for (const [row, cells] of Object.entries(sheet.cellData)) {
    for (const [column, cell] of Object.entries(cells)) {
      if (cell.v === undefined && cell.f === undefined) continue;
      minRow = Math.min(minRow, Number(row));
      maxRow = Math.max(maxRow, Number(row));
      minCol = Math.min(minCol, Number(column));
      maxCol = Math.max(maxCol, Number(column));
    }
  }
  if (maxRow < 0) return undefined;
  return { startRow: minRow, endRow: maxRow, startColumn: minCol, endColumn: maxCol };
}

function sheetOutline(sheet: SheetData): string {
  const used = usedRange(sheet);
  const formulas = Object.values(sheet.cellData).reduce(
    (count, row) => count + Object.values(row).filter((cell) => cell.f).length,
    0,
  );
  const parts = [
    `Aba "${sheet.name}" (id: ${sheet.id})`,
    used ? `usado ${formatRange(used)}` : 'vazia',
    `fórmulas: ${formulas}`,
  ];
  if (sheet.mergeData?.length) parts.push(`mesclagens: ${sheet.mergeData.length}`);
  if (sheet.freeze) parts.push(`congelado: ${sheet.freeze.ySplit} linhas, ${sheet.freeze.xSplit} colunas`);
  return parts.join(' · ');
}

/** One line per row with the non-empty cells of a range (`A1=Horas | B1=120`). */
function gridRows(sheet: SheetData, range: CellRange): string[] {
  const lines: string[] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    const cells: string[] = [];
    for (let column = range.startColumn; column <= range.endColumn; column++) {
      const text = displayCell(sheet.cellData[String(row)]?.[String(column)]);
      if (text !== undefined) cells.push(`${formatAddress(row, column)}=${text}`);
    }
    if (cells.length > 0) lines.push(cells.join(' | '));
  }
  return lines;
}

/** Compact reading (spec §11.3): `outline`, `range` (A1 with sheet prefix) and `full`, under the token budget. */
export function readWorkbook(content: WorkbookContent, request: ReadRequest): ReadResult {
  const sheets = orderedSheets(content);
  const budget = {
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    ...(request.charsPerToken === undefined ? {} : { charsPerToken: request.charsPerToken }),
  };
  if (request.mode === 'outline') {
    const items: ProjectionItem[] = sheets.map((sheet) => ({
      id: sheet.id,
      text: sheetOutline(sheet),
      outline: sheetOutline(sheet),
    }));
    const projection = paginate(items, { header: 'Abas:', ...budget, outlineOnly: true });
    return {
      text: projection.text,
      truncated: projection.truncated,
      ...(projection.cursor ? { cursor: projection.cursor } : {}),
    };
  }
  const items: ProjectionItem[] = [];
  if (request.mode === 'range') {
    const [sheetName, addressPart] = request.range?.includes('!')
      ? request.range.split('!')
      : [undefined, request.range];
    const sheet = sheetName ? findSheet(content, sheetName) : sheets[0];
    if (!sheet) return { text: `Aba "${sheetName}" não encontrada.`, truncated: false };
    const parsed = parseRange(addressPart ?? 'A1:Z100');
    if (!parsed) return { text: `Intervalo "${request.range}" inválido.`, truncated: false };
    for (const line of gridRows(sheet, parsed))
      items.push({ id: line, text: line, outline: line.slice(0, 80) });
    const projection = paginate(items, { header: `${sheet.name}!${formatRange(parsed)}`, ...budget });
    return {
      text: projection.text,
      truncated: projection.truncated,
      ...(projection.cursor ? { cursor: projection.cursor } : {}),
    };
  }
  for (const sheet of sheets) {
    items.push({ id: `${sheet.id}:outline`, text: sheetOutline(sheet), outline: sheetOutline(sheet) });
    const used = usedRange(sheet);
    if (!used) continue;
    for (const line of gridRows(sheet, used))
      items.push({
        id: `${sheet.id}:${line}`,
        text: `${sheet.name}: ${line}`,
        outline: `${sheet.name}: ${line.slice(0, 60)}`,
      });
  }
  const projection = paginate(items, budget);
  return {
    text: projection.text,
    truncated: projection.truncated,
    ...(projection.cursor ? { cursor: projection.cursor } : {}),
  };
}
