/** A1 addressing helpers shared by the model, the formula engine, renderers and exporters. */

/** Addressable bounds (spec §6.6). References beyond them are invalid. */
export const MAX_ROWS = 100_000;
export const MAX_COLS = 16_384;

/** Zero-based cell coordinates. */
export interface CellPos {
  row: number;
  col: number;
}

/** Zero-based inclusive rectangle. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const CELL_KEY = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const RANGE = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})(?::\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6}))?$/;

/** `0 → A`, `25 → Z`, `26 → AA`. */
export function columnLetter(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** `A → 0`, `AA → 26`. Returns -1 for invalid letters. */
export function columnIndex(letters: string): number {
  const upper = letters.toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(upper)) return -1;
  let n = 0;
  for (const ch of upper) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellKey(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`;
}

/** Parses a canonical cell key (`B12`, uppercase, no `$`). */
export function parseCellKey(key: string): CellPos | undefined {
  const match = CELL_KEY.exec(key);
  if (!match) return undefined;
  const col = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;
  if (col < 0 || col >= MAX_COLS || row >= MAX_ROWS) return undefined;
  return { row, col };
}

export function isCellKey(key: string): boolean {
  return parseCellKey(key) !== undefined;
}

/** Parses `A1` or `A1:C9` (with optional `$`, any case) into a normalized rectangle. */
export function parseRange(text: string): Rect | undefined {
  const match = RANGE.exec(text.trim());
  if (!match) return undefined;
  const c1 = columnIndex(match[1]!);
  const r1 = Number(match[2]) - 1;
  const c2 = match[3] ? columnIndex(match[3]) : c1;
  const r2 = match[4] ? Number(match[4]) - 1 : r1;
  if ([c1, c2].some((c) => c < 0 || c >= MAX_COLS) || [r1, r2].some((r) => r >= MAX_ROWS)) return undefined;
  return { top: Math.min(r1, r2), left: Math.min(c1, c2), bottom: Math.max(r1, r2), right: Math.max(c1, c2) };
}

export function formatRange(rect: Rect): string {
  const a = cellKey(rect.top, rect.left);
  if (rect.top === rect.bottom && rect.left === rect.right) return a;
  return `${a}:${cellKey(rect.bottom, rect.right)}`;
}

export function rectSize(rect: Rect): number {
  return (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
}

export function rectContains(rect: Rect, row: number, col: number): boolean {
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

export function rectEquals(a: Rect, b: Rect): boolean {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

/** `a` minus `b` as up to four disjoint rectangles. */
export function subtractRect(a: Rect, b: Rect): Rect[] {
  if (!rectsIntersect(a, b)) return [a];
  const out: Rect[] = [];
  if (b.top > a.top) out.push({ top: a.top, left: a.left, bottom: b.top - 1, right: a.right });
  if (b.bottom < a.bottom) out.push({ top: b.bottom + 1, left: a.left, bottom: a.bottom, right: a.right });
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (b.left > a.left) out.push({ top, left: a.left, bottom, right: b.left - 1 });
  if (b.right < a.right) out.push({ top, left: b.right + 1, bottom, right: a.right });
  return out;
}

/** Iterates every cell of a rectangle row by row. */
export function* rectCells(rect: Rect): Generator<CellPos> {
  for (let row = rect.top; row <= rect.bottom; row++) {
    for (let col = rect.left; col <= rect.right; col++) yield { row, col };
  }
}

/** Sheet names: 1–31 characters, none of `\ / ? * [ ] :`, not starting or ending with `'` (spec §11.2). */
export const SHEET_NAME_PATTERN = /^(?!')[^\\/?*[\]:]{1,31}(?<!')$/;

/** Quotes a sheet name for formulas when needed: `Resumo`, `'Estimativa 2'`, `'O''Brien'`. */
export function quoteSheetName(name: string): string {
  const plain = /^[A-Za-z_À-￿][A-Za-z0-9_.À-￿]*$/.test(name) && !looksLikeReference(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

/** True when a bare word would be read as a cell reference or an R1C1 reference. */
export function looksLikeReference(word: string): boolean {
  if (/^[A-Za-z]{1,3}[0-9]+$/.test(word)) {
    const col = columnIndex(word.replace(/[0-9]+$/, ''));
    return col >= 0 && col < MAX_COLS;
  }
  return /^[Rr][0-9]*[Cc][0-9]*$/.test(word) || /^[RrCc]$/.test(word);
}

/** Case-insensitive comparison used for sheet and defined names, like spreadsheet applications. */
export function sameName(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}
