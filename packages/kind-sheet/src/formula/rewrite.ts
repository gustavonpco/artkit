import { columnLetter, MAX_COLS, MAX_ROWS, quoteSheetName, type Rect } from '../address.js';
import { parseCached } from './parser.js';
import { FormulaSyntaxError, type RefPart, type RefToken, type Token, tokenize } from './tokenizer.js';

export type Axis = 'row' | 'col';

/** Rows/columns inserted or deleted on a sheet. `index` is zero-based. */
export interface StructuralChange {
  sheet: string;
  axis: Axis;
  type: 'insert' | 'delete';
  index: number;
  count: number;
}

/** `undefined` keeps the reference, `null` turns it into `#REF!`. */
export type RefRewriter = (ref: RefToken) => RefToken | null | undefined;

function partText(part: RefPart, kind: RefToken['kind']): string {
  const col =
    part.col === undefined || kind === 'rows' ? '' : `${part.colAbs ? '$' : ''}${columnLetter(part.col)}`;
  const row = part.row === undefined || kind === 'cols' ? '' : `${part.rowAbs ? '$' : ''}${part.row + 1}`;
  return col + row;
}

/** Tokens of a formula, reusing the parse cache (structural edits rewrite every formula of a workbook). */
function tokensOf(formula: string): Token[] | undefined {
  try {
    return parseCached(formula).tokens;
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
  }
  try {
    return tokenize(formula);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return undefined;
    throw error;
  }
}

/** Prints a reference token (`'Estimativa 2'!$A$1:B9`, `C:C`, `2:5`). */
export function printRef(ref: RefToken): string {
  const prefix = ref.sheet === undefined ? '' : `${quoteSheetName(ref.sheet)}!`;
  if (ref.kind === 'cell') return prefix + partText(ref.a, 'cell');
  return `${prefix}${partText(ref.a, ref.kind)}:${partText(ref.b, ref.kind)}`;
}

/**
 * Rewrites every reference of a formula in place, keeping the rest of the text (spacing, case of
 * strings) untouched. Formulas that do not tokenize are returned unchanged.
 */
export function rewriteRefs(formula: string, rewrite: RefRewriter): string {
  const tokens = tokensOf(formula);
  if (!tokens) return formula;
  let out = '';
  let cursor = 0;
  for (const token of tokens) {
    if (token.type !== 'ref') continue;
    const next = rewrite(token.ref!);
    if (next === undefined) continue;
    out += formula.slice(cursor, token.start) + (next === null ? '#REF!' : printRef(next));
    cursor = token.end;
  }
  return cursor === 0 ? formula : out + formula.slice(cursor);
}

/** Moves an interval through an insertion or deletion; `null` when it is deleted or pushed out of the grid. */
export function shiftInterval(
  start: number,
  end: number,
  change: Pick<StructuralChange, 'type' | 'index' | 'count'>,
  max: number,
): [number, number] | null {
  const { index, count } = change;
  if (change.type === 'insert') {
    const s = start >= index ? start + count : start;
    const e = end >= index ? end + count : end;
    return e >= max ? null : [s, e];
  }
  const last = index + count - 1;
  if (start >= index && end <= last) return null;
  const s = start < index ? start : start > last ? start - count : index;
  const e = end < index ? end : end > last ? end - count : index - 1;
  return [s, e];
}

/** Applies a structural change to a rectangle on the changed sheet. */
export function shiftRect(rect: Rect, change: StructuralChange): Rect | null {
  if (change.axis === 'row') {
    const rows = shiftInterval(rect.top, rect.bottom, change, MAX_ROWS);
    return rows ? { ...rect, top: rows[0], bottom: rows[1] } : null;
  }
  const cols = shiftInterval(rect.left, rect.right, change, MAX_COLS);
  return cols ? { ...rect, left: cols[0], right: cols[1] } : null;
}

function sameSheet(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

/** Rewrites references after inserting or deleting rows/columns. `formulaSheet` resolves unprefixed refs. */
export function adjustFormula(formula: string, formulaSheet: string, change: StructuralChange): string {
  return rewriteRefs(formula, (ref) => {
    if (!sameSheet(ref.sheet ?? formulaSheet, change.sheet)) return undefined;
    if ((change.axis === 'row' && ref.kind === 'cols') || (change.axis === 'col' && ref.kind === 'rows'))
      return undefined;
    const key = change.axis === 'row' ? 'row' : 'col';
    const lo = Math.min(ref.a[key]!, ref.b[key]!);
    const hi = Math.max(ref.a[key]!, ref.b[key]!);
    const shifted = shiftInterval(lo, hi, change, change.axis === 'row' ? MAX_ROWS : MAX_COLS);
    if (!shifted) return null;
    if (shifted[0] === lo && shifted[1] === hi) return undefined;
    const aFirst = ref.a[key]! <= ref.b[key]!;
    return {
      ...ref,
      a: { ...ref.a, [key]: aFirst ? shifted[0] : shifted[1] },
      b: { ...ref.b, [key]: aFirst ? shifted[1] : shifted[0] },
    };
  });
}

/** Shifts relative references by an offset (fill and paste). Results outside the grid become `#REF!`. */
export function shiftRelative(formula: string, rows: number, cols: number): string {
  if (rows === 0 && cols === 0) return formula;
  return rewriteRefs(formula, (ref) => {
    const move = (part: RefPart): RefPart | null => {
      const next = { ...part };
      if (part.row !== undefined && !part.rowAbs && ref.kind !== 'cols') next.row = part.row + rows;
      if (part.col !== undefined && !part.colAbs && ref.kind !== 'rows') next.col = part.col + cols;
      if (next.row !== undefined && (next.row < 0 || next.row >= MAX_ROWS)) return null;
      if (next.col !== undefined && (next.col < 0 || next.col >= MAX_COLS)) return null;
      return next;
    };
    const a = move(ref.a);
    const b = move(ref.b);
    if (!a || !b) return null;
    return { ...ref, a, b };
  });
}

/** Renames the sheet prefix of references (rename_sheet). */
export function renameSheetInFormula(formula: string, from: string, to: string): string {
  return rewriteRefs(formula, (ref) =>
    ref.sheet !== undefined && sameSheet(ref.sheet, from) ? { ...ref, sheet: to } : undefined,
  );
}

/** Turns references to a removed sheet into `#REF!` (remove_sheet). */
export function invalidateSheetInFormula(formula: string, removed: string): string {
  return rewriteRefs(formula, (ref) =>
    ref.sheet !== undefined && sameSheet(ref.sheet, removed) ? null : undefined,
  );
}

/** Upper-cases function names and references and drops the leading `=`; strings are untouched. */
export function canonicalFormula(formula: string): string {
  const source = formula.trim().startsWith('=') ? formula.trim().slice(1).trim() : formula.trim();
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return source;
    throw error;
  }
  let out = '';
  let cursor = 0;
  for (const token of tokens) {
    let replacement: string | undefined;
    if (token.type === 'func') replacement = token.ident;
    else if (token.type === 'bool') replacement = token.text.toUpperCase();
    else if (token.type === 'ref') replacement = printRef(token.ref!);
    if (replacement === undefined || replacement === token.text) continue;
    out += source.slice(cursor, token.start) + replacement;
    cursor = token.end;
  }
  return cursor === 0 ? source : out + source.slice(cursor);
}
