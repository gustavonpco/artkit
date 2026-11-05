/** A1 addressing (spec §11.3): zero-based indexes internally, letters and numbers in the content and in operations. */

export interface CellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export function columnToIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

export function indexToColumn(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function formatAddress(row: number, column: number): string {
  return `${indexToColumn(column)}${row + 1}`;
}

const CELL = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/;

export function parseAddress(address: string): { row: number; column: number } | undefined {
  const match = CELL.exec(address.trim());
  if (!match) return undefined;
  return { row: Number(match[2]) - 1, column: columnToIndex(match[1]!) };
}

/** `A1` or `A1:D3` (or a single column/row span as `A:A`, `2:4`, expanded to the whole sheet by the caller). */
export function parseRange(range: string): CellRange | undefined {
  const [from, to = from] = range.split(':');
  const start = parseAddress(from ?? '');
  const end = parseAddress(to ?? '');
  if (!start || !end) return undefined;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

export function formatRange(range: CellRange): string {
  const from = formatAddress(range.startRow, range.startColumn);
  const to = formatAddress(range.endRow, range.endColumn);
  return from === to ? from : `${from}:${to}`;
}
