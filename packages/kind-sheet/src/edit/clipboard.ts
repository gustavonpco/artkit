import { type CellPos, cellKey, MAX_COLS, MAX_ROWS, type Rect } from '../address.js';
import type { CellPatch } from '../cells.js';
import { formatCellValue } from '../display.js';
import { shiftRelative } from '../formula/rewrite.js';
import type { Cell, Sheet } from '../schema.js';
import { cellPatchFromText } from './input.js';

/** MIME type of the internal clipboard payload (keeps formulas, formats and styles). */
export const SHEET_CLIPBOARD_MIME = 'application/x-artkit-sheet+json';

export interface ClipboardPayload {
  /** Top-left of the copied block, used to shift relative references on paste. */
  origin: CellPos;
  cells: (Cell | null)[][];
}

/** Parses tab-separated text as spreadsheets put it on the clipboard (quoted fields may hold tabs/newlines). */
export function parseTsv(text: string): string[][] {
  const source = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

export function toTsv(grid: string[][]): string {
  return grid
    .map((row) =>
      row.map((value) => (/[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join('\t'),
    )
    .join('\n');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Extracts the first HTML table as text cells without a DOM (paste from other spreadsheets): `<br>` becomes a
 * line break, other tags are dropped, entities decoded, colspan padded with empty cells.
 */
export function parseHtmlTable(html: string): string[][] | undefined {
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) return undefined;
  const rows: string[][] = [];
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      // HTML whitespace is not significant; only <br> makes a line break.
      const text = decodeEntities(
        cellMatch[3]!
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
          .replace(/\s+/g, ' ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, ''),
      )
        .split('\n')
        .map((line) => line.trim())
        .join('\n');
      row.push(text);
      const span = /colspan\s*=\s*["']?(\d+)/i.exec(cellMatch[2]!);
      for (let i = 1; i < Math.min(Number(span?.[1] ?? 1), 1000); i++) row.push('');
    }
    rows.push(row);
  }
  return rows.length > 0 ? rows : undefined;
}

const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toHtmlTable(grid: string[][]): string {
  const body = grid
    .map(
      (row) =>
        `<tr>${row.map((value) => `<td>${escapeText(value).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table>${body}</table>`;
}

/** Copies a block: display text for TSV/HTML, full cells for the internal payload. */
export function copyBlock(
  sheet: Sheet,
  rect: Rect,
  display: { locale: string; currency: string },
): { text: string; html: string; payload: ClipboardPayload } {
  const text: string[][] = [];
  const cells: (Cell | null)[][] = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    const textRow: string[] = [];
    const cellRow: (Cell | null)[] = [];
    for (let col = rect.left; col <= rect.right; col++) {
      const cell = sheet.cells[cellKey(row, col)];
      textRow.push(formatCellValue(cell?.v, cell?.fmt, display));
      cellRow.push(cell ? structuredClone(cell) : null);
    }
    text.push(textRow);
    cells.push(cellRow);
  }
  return {
    text: toTsv(text),
    html: toHtmlTable(text),
    payload: { origin: { row: rect.top, col: rect.left }, cells },
  };
}

function patchFromCell(cell: Cell | null, rows: number, cols: number): CellPatch {
  if (!cell) return { v: null, f: null, fmt: null, s: null, note: null };
  const patch: CellPatch = { fmt: cell.fmt ?? null, s: cell.s ?? null, note: cell.note ?? null };
  if (cell.f !== undefined) patch.f = shiftRelative(cell.f, rows, cols);
  else if (cell.v !== undefined && typeof cell.v !== 'object') patch.v = cell.v;
  else patch.v = null;
  return patch;
}

/**
 * Turns pasted content into `set_cells` patches at `target`. Internal payloads keep formulas (relative
 * references shift by the paste offset), formats and styles; text grids are typed by locale. A single value
 * pasted over a larger selection fills it.
 */
export function pastePatches(
  source: ClipboardPayload | string[][],
  target: CellPos,
  locale: string,
  fillRect?: Rect,
): Record<string, CellPatch> {
  const patches: Record<string, CellPatch> = {};
  const grid = Array.isArray(source) ? source : source.cells;
  const height = grid.length;
  const width = Math.max(0, ...grid.map((row) => row.length));
  const single = height === 1 && width === 1;
  const area: Rect =
    single && fillRect
      ? fillRect
      : {
          top: target.row,
          left: target.col,
          bottom: Math.min(MAX_ROWS - 1, target.row + height - 1),
          right: Math.min(MAX_COLS - 1, target.col + width - 1),
        };
  for (let row = area.top; row <= area.bottom; row++) {
    for (let col = area.left; col <= area.right; col++) {
      const r = single ? 0 : row - area.top;
      const c = single ? 0 : col - area.left;
      const key = cellKey(row, col);
      if (Array.isArray(source)) {
        patches[key] = cellPatchFromText(source[r]?.[c] ?? '', locale);
      } else {
        patches[key] = patchFromCell(
          source.cells[r]?.[c] ?? null,
          row - (source.origin.row + r),
          col - (source.origin.col + c),
        );
      }
    }
  }
  return patches;
}
