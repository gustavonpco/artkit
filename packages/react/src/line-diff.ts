export type LineDiffType = 'equal' | 'insert' | 'delete';

export interface LineDiffEntry {
  type: LineDiffType;
  text: string;
  /** 1-based line number in the old text (equal and delete). */
  oldLine?: number;
  /** 1-based line number in the new text (equal and insert). */
  newLine?: number;
}

export interface LineDiffOptions {
  /**
   * Upper bound for the LCS table (rows × columns) after trimming the common prefix and suffix.
   * Above it the middle is reported as a block replacement, keeping memory bounded on huge projections.
   */
  maxCells?: number;
}

const splitLines = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

/** Line diff based on the longest common subsequence, with common prefix/suffix trimmed first. */
export function diffLines(before: string, after: string, options: LineDiffOptions = {}): LineDiffEntry[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const maxCells = options.maxCells ?? 4_000_000;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: LineDiffEntry[] = [];
  for (let i = 0; i < start; i++) out.push({ type: 'equal', text: a[i]!, oldLine: i + 1, newLine: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n > 0 && m > 0 && n * m <= maxCells) {
    // lengths[i][j] = LCS length of midA[i..] and midB[j..], stored flat.
    const width = m + 1;
    const lengths = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * width + j] =
          midA[i] === midB[j]
            ? lengths[(i + 1) * width + j + 1]! + 1
            : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ type: 'equal', text: midA[i]!, oldLine: start + i + 1, newLine: start + j + 1 });
        i++;
        j++;
      } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
        out.push({ type: 'delete', text: midA[i]!, oldLine: start + i + 1 });
        i++;
      } else {
        out.push({ type: 'insert', text: midB[j]!, newLine: start + j + 1 });
        j++;
      }
    }
    for (; i < n; i++) out.push({ type: 'delete', text: midA[i]!, oldLine: start + i + 1 });
    for (; j < m; j++) out.push({ type: 'insert', text: midB[j]!, newLine: start + j + 1 });
  } else {
    for (let k = 0; k < n; k++) out.push({ type: 'delete', text: midA[k]!, oldLine: start + k + 1 });
    for (let k = 0; k < m; k++) out.push({ type: 'insert', text: midB[k]!, newLine: start + k + 1 });
  }

  for (let k = 0; k < a.length - endA; k++) {
    out.push({ type: 'equal', text: a[endA + k]!, oldLine: endA + k + 1, newLine: endB + k + 1 });
  }
  return out;
}

export interface SplitRow {
  left?: LineDiffEntry;
  right?: LineDiffEntry;
}

/** Pairs deletions with the insertions that follow them, for a side-by-side layout. */
export function toSplitRows(entries: LineDiffEntry[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index]!;
    if (entry.type === 'equal') {
      rows.push({ left: entry, right: entry });
      index++;
      continue;
    }
    const deletes: LineDiffEntry[] = [];
    const inserts: LineDiffEntry[] = [];
    while (index < entries.length && entries[index]!.type === 'delete') deletes.push(entries[index++]!);
    while (index < entries.length && entries[index]!.type === 'insert') inserts.push(entries[index++]!);
    for (let k = 0; k < Math.max(deletes.length, inserts.length); k++) {
      const row: SplitRow = {};
      if (deletes[k]) row.left = deletes[k];
      if (inserts[k]) row.right = inserts[k];
      rows.push(row);
    }
  }
  return rows;
}
