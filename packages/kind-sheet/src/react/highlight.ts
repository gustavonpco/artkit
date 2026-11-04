import { MAX_COLS, MAX_ROWS, type Rect } from '../address.js';
import { FormulaSyntaxError, type RefToken, type Token, tokenize } from '../formula/tokenizer.js';
import { refRect } from '../formula/workbook.js';

/** Colors cycled through for the references of a formula (grid outlines and formula text). */
export const REFERENCE_COLORS = [
  '#2563EB',
  '#D97706',
  '#15803D',
  '#B91C1C',
  '#7C3AED',
  '#0891B2',
  '#DB2777',
  '#4D7C0F',
];

export interface FormulaReference {
  /** Span in the formula text (without the leading `=`). */
  start: number;
  end: number;
  ref: RefToken;
  /** Rectangle clipped to the grid. */
  rect: Rect;
  color: string;
  /** Sheet name the reference points to (the formula's sheet when unprefixed). */
  sheet: string;
}

/**
 * References of a (possibly incomplete) formula with stable colors: the same reference text gets the same
 * color. Text that does not tokenize yet yields the references found before the error.
 */
export function formulaReferences(formula: string, ownSheet: string): FormulaReference[] {
  let tokens: Token[];
  const source = formula.startsWith('=') ? formula.slice(1) : formula;
  const offset = formula.length - source.length;
  try {
    tokens = tokenize(source);
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
    try {
      tokens = tokenize(source.slice(0, error.position));
    } catch {
      tokens = [];
    }
  }
  const colors = new Map<string, string>();
  const out: FormulaReference[] = [];
  for (const token of tokens) {
    if (token.type !== 'ref' || !token.ref) continue;
    const text = token.text.replace(/\$/g, '').toUpperCase();
    if (!colors.has(text)) colors.set(text, REFERENCE_COLORS[colors.size % REFERENCE_COLORS.length]!);
    const rect = refRect(token.ref);
    out.push({
      start: token.start + offset,
      end: token.end + offset,
      ref: token.ref,
      rect: {
        top: rect.top,
        left: rect.left,
        bottom: Math.min(rect.bottom, MAX_ROWS - 1),
        right: Math.min(rect.right, MAX_COLS - 1),
      },
      color: colors.get(text)!,
      sheet: token.ref.sheet ?? ownSheet,
    });
  }
  return out;
}

/** Outlines to draw on a sheet for a formula's references. */
export function highlightsFor(
  formula: string,
  ownSheet: string,
  shownSheet: string,
): { rect: Rect; color: string }[] {
  return formulaReferences(formula, ownSheet)
    .filter((reference) => reference.sheet.toUpperCase() === shownSheet.toUpperCase())
    .map(({ rect, color }) => ({ rect, color }));
}
