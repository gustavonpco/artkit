import type { FormulaErrorCode } from '../schema.js';
import { serialFromIso } from './dates.js';

/** Formula error value. One shared instance per code, so identity comparison works. */
export class FormulaError {
  private constructor(readonly code: FormulaErrorCode) {}

  static readonly instances = new Map<FormulaErrorCode, FormulaError>();

  static of(code: FormulaErrorCode): FormulaError {
    let found = FormulaError.instances.get(code);
    if (!found) {
      found = new FormulaError(code);
      FormulaError.instances.set(code, found);
    }
    return found;
  }

  toString(): string {
    return this.code;
  }
}

export const ERR = {
  NULL: FormulaError.of('#NULL!'),
  DIV0: FormulaError.of('#DIV/0!'),
  VALUE: FormulaError.of('#VALUE!'),
  REF: FormulaError.of('#REF!'),
  NAME: FormulaError.of('#NAME?'),
  NUM: FormulaError.of('#NUM!'),
  NA: FormulaError.of('#N/A'),
} as const;

/** `null` is a blank cell. */
export type Scalar = number | string | boolean | null | FormulaError;

export function isError(value: unknown): value is FormulaError {
  return value instanceof FormulaError;
}

/** Normalizes arithmetic results to 15 significant digits like Excel, so 0.1 + 0.2 = 0.3. */
export function normalizeNumber(value: number): number | FormulaError {
  if (!Number.isFinite(value)) return ERR.NUM;
  if (value === 0) return 0;
  return Number(value.toPrecision(15));
}

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Text that Excel would coerce to a number: `"12"`, `" 3.5 "`, `"15%"`, `"2026-11-09"`. */
export function parseNumericText(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (NUMERIC_TEXT.test(trimmed)) return Number(trimmed);
  if (trimmed.endsWith('%') && NUMERIC_TEXT.test(trimmed.slice(0, -1).trim()))
    return Number(trimmed.slice(0, -1)) / 100;
  return serialFromIso(trimmed);
}

export function toNumber(value: Scalar): number | FormulaError {
  if (typeof value === 'number') return value;
  if (value === null) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (isError(value)) return value;
  const parsed = parseNumericText(value);
  return parsed === undefined ? ERR.VALUE : parsed;
}

/** Number to text as Excel's General format does inside formulas (15 significant digits). */
export function numberToText(value: number): string {
  if (value === 0) return '0';
  const normalized = Number(value.toPrecision(15));
  const abs = Math.abs(normalized);
  if (abs >= 1e21 || abs < 1e-6) {
    const [mantissa, exponent] = normalized.toExponential().split('e');
    const exp = Number(exponent);
    return `${mantissa!.replace(/\.?0+$/, '')}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return String(normalized);
}

export function toText(value: Scalar): string | FormulaError {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (isError(value)) return value;
  return numberToText(value);
}

export function toBoolean(value: Scalar): boolean | FormulaError {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null) return false;
  if (isError(value)) return value;
  const upper = value.trim().toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return ERR.VALUE;
}

function typeRank(value: number | string | boolean): number {
  return typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2;
}

/**
 * Excel comparison: blanks compare as 0, "" or FALSE depending on the other side; numbers < text < logicals;
 * text is case-insensitive (ordinal on upper case, so results do not depend on the runtime's ICU data).
 */
export function compareScalars(a: Exclude<Scalar, FormulaError>, b: Exclude<Scalar, FormulaError>): number {
  const blankFor = (other: Exclude<Scalar, FormulaError>): number | string | boolean =>
    typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0;
  const left = a === null ? blankFor(b) : a;
  const right = b === null ? blankFor(a) : b;
  const ra = typeRank(left);
  const rb = typeRank(right);
  if (ra !== rb) return ra - rb;
  if (typeof left === 'string') {
    const x = left.toUpperCase();
    const y = (right as string).toUpperCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof left === 'boolean') return Number(left) - Number(right);
  return (left as number) < (right as number) ? -1 : (left as number) > (right as number) ? 1 : 0;
}
