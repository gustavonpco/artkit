/** RFC 4180 CSV parsing and writing (pure, no dependencies). */

export type CsvDelimiter = ',' | ';' | '\t';

const CANDIDATES: CsvDelimiter[] = [',', ';', '\t'];

/** Counts delimiter candidates outside quotes per line and picks the most consistent one. */
export function detectDelimiter(text: string): CsvDelimiter {
  const lines: Record<CsvDelimiter, number>[] = [];
  let counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let content = false;
  let quoted = false;
  for (let i = 0; i < text.length && lines.length < 20; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
    else if (!quoted && ch === '\n') {
      if (content) lines.push(counts);
      counts = { ',': 0, ';': 0, '\t': 0 };
      content = false;
      continue;
    }
    if (ch !== '\r') content = true;
  }
  if (content) lines.push(counts);
  let best: CsvDelimiter = ',';
  let bestScore = 0;
  for (const candidate of CANDIDATES) {
    const first = lines[0]?.[candidate] ?? 0;
    if (first === 0) continue;
    // Prefer the delimiter whose count is the same on every line, then the most frequent one.
    const consistent = lines.filter((line) => line[candidate] === first).length / lines.length;
    const score = consistent * 1000 + first;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Parses CSV into rows of strings. Handles quoted fields, escaped quotes and CRLF/LF line endings. */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Quotes a field when it contains the delimiter, quotes or line breaks. */
export function csvField(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function writeCsv(rows: string[][], delimiter: string = ','): string {
  return rows.map((row) => row.map((value) => csvField(value, delimiter)).join(delimiter)).join('\r\n');
}
