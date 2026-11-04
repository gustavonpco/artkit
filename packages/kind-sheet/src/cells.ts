import { parseCellKey } from './address.js';
import { serialFromIso } from './formula/dates.js';
import { type FormulaIssue, formulaMessages } from './formula/engine.js';
import {
  FUNCTION_ALTERNATIVES,
  FUNCTIONS,
  PROHIBITED_FUNCTIONS,
  similarFunctions,
} from './formula/functions.js';
import { parseCached, walk } from './formula/parser.js';
import { canonicalFormula } from './formula/rewrite.js';
import { FormulaSyntaxError } from './formula/tokenizer.js';
import type { Cell, CellStyle, NamedFormat } from './schema.js';

/** Style patch: `null` on a property removes it. */
export type StylePatch = { [K in keyof CellStyle]?: CellStyle[K] | null };

/** Cell patch used by `set_cells`: absent keeps, `null` removes. */
export interface CellPatch {
  v?: string | number | boolean | null;
  f?: string | null;
  fmt?: NamedFormat | null;
  s?: StylePatch | null;
  note?: string | null;
}

/** `$b$2` → `B2`; undefined when the key is not a valid in-grid address. */
export function normalizeAddress(key: string): string | undefined {
  const upper = key.replace(/\$/g, '').toUpperCase();
  return parseCellKey(upper) ? upper : undefined;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;

/**
 * Literal coercion shared by operations, `normalize` and inputs: ISO dates become date serials with a date
 * format (cells store dates as Excel serial numbers).
 */
export function coerceLiteral(
  value: string | number | boolean,
  fmt: NamedFormat | undefined,
): { v: string | number | boolean; fmt: NamedFormat | undefined } {
  if (typeof value !== 'string' || fmt === 'text') return { v: value, fmt };
  if (ISO_DAY.test(value) && (fmt === undefined || fmt === 'date' || fmt === 'datetime')) {
    const serial = serialFromIso(value);
    if (serial !== undefined) return { v: serial, fmt: fmt ?? 'date' };
  }
  if (ISO_DATETIME.test(value) && (fmt === undefined || fmt === 'date' || fmt === 'datetime')) {
    const serial = serialFromIso(value);
    if (serial !== undefined) return { v: serial, fmt: fmt ?? 'datetime' };
  }
  return { v: value, fmt };
}

/** A `v` text starting with "=" is a formula, like typing it in a spreadsheet (unless the format is text). */
export function isFormulaText(value: unknown, fmt: NamedFormat | null | undefined): value is string {
  return typeof value === 'string' && value.length > 1 && value.startsWith('=') && fmt !== 'text';
}

export function isEmptyCell(cell: Cell | undefined): boolean {
  return !cell || Object.keys(cell).length === 0;
}

function mergeStyle(current: CellStyle | undefined, patch: StylePatch): CellStyle | undefined {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length > 0 ? (next as CellStyle) : undefined;
}

/** Applies a patch to a cell and returns the new cell (undefined when it ends up empty). Pure. */
export function patchCell(current: Cell | undefined, patch: CellPatch): Cell | undefined {
  const cell: Cell = { ...current };
  if (patch.fmt !== undefined) {
    if (patch.fmt === null) delete cell.fmt;
    else cell.fmt = patch.fmt;
  }
  let formula: string | null | undefined = patch.f;
  let value = patch.v;
  if ((formula === undefined || formula === null) && isFormulaText(value, cell.fmt)) {
    formula = value;
    value = undefined;
  }
  if (typeof formula === 'string') {
    cell.f = canonicalFormula(formula);
    delete cell.v;
  } else if (formula === null) {
    if (cell.f !== undefined) delete cell.v;
    delete cell.f;
  }
  if (value !== undefined && typeof formula !== 'string') {
    if (value === null) {
      delete cell.v;
      delete cell.f;
    } else {
      const coerced = coerceLiteral(value, cell.fmt);
      cell.v = coerced.v;
      if (coerced.fmt) cell.fmt = coerced.fmt;
      delete cell.f;
    }
  }
  if (patch.s !== undefined) {
    const style = patch.s === null ? undefined : mergeStyle(cell.s, patch.s);
    if (style) cell.s = style;
    else delete cell.s;
  }
  if (patch.note !== undefined) {
    if (patch.note === null || patch.note === '') delete cell.note;
    else cell.note = patch.note;
  }
  return isEmptyCell(cell) ? undefined : cell;
}

/**
 * Context-free formula checks done when an operation writes a formula, so the error points at the
 * operation: syntax, supported functions and argument counts. References are checked by `validate`.
 */
export function checkFormula(formula: string, locale?: string): FormulaIssue | undefined {
  const m = formulaMessages(locale);
  try {
    const { ast } = parseCached(formula);
    let issue: FormulaIssue | undefined;
    walk(ast, (node) => {
      if (issue || node.type !== 'call') return;
      const spec = FUNCTIONS.get(node.name);
      if (!spec) {
        issue = PROHIBITED_FUNCTIONS.has(node.name)
          ? { code: 'PROHIBITED_FUNCTION', message: m.prohibited(node.name), hint: m.prohibitedHint }
          : {
              code: 'UNKNOWN_FUNCTION',
              message: m.unknownFunction(node.name),
              hint: m.unknownFunctionHint(
                similarFunctions(node.name).join(', '),
                FUNCTION_ALTERNATIVES[node.name],
              ),
            };
      } else if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        issue = {
          code: 'ARGUMENT_COUNT',
          message: m.arity(spec.name, spec.minArgs, spec.maxArgs, node.args.length),
          hint: m.arityHint(spec.signature),
        };
      }
    });
    return issue;
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
    return { code: 'SYNTAX', message: m.syntax(error.message), hint: m.syntaxHint, start: error.position };
  }
}
