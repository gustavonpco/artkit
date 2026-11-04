import type { CellValue } from '../schema.js';
import { FUNCTIONS } from './functions.js';
import { type Node, parseCached } from './parser.js';
import { type EvalContext, isRange, makeRange, toScalar, type Value } from './runtime.js';
import { FormulaSyntaxError } from './tokenizer.js';
import {
  compareScalars,
  ERR,
  FormulaError,
  isError,
  normalizeNumber,
  type Scalar,
  toNumber,
  toText,
} from './values.js';
import { refRect, type SheetIndex } from './workbook.js';

/** Resolves a defined name to the range it refers to. */
export function resolveName(name: string, ctx: EvalContext): Value {
  const defined = ctx.wb.definedName(name);
  if (!defined) return ERR.NAME;
  let ast: Node;
  try {
    ast = parseCached(defined.ref).ast;
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return ERR.REF;
    throw error;
  }
  if (ast.type === 'error') return FormulaError.of(ast.code);
  if (ast.type !== 'ref') return ERR.REF;
  return evaluate(ast, ctx);
}

function refValue(node: Extract<Node, { type: 'ref' }>, ctx: EvalContext): Value {
  let sheet: SheetIndex | undefined = ctx.sheet;
  if (node.ref.sheet !== undefined) sheet = ctx.wb.sheetByName(node.ref.sheet);
  if (!sheet) return ERR.REF;
  const rect = refRect(node.ref);
  return makeRange(sheet, rect.top, rect.left, rect.bottom, rect.right);
}

function binary(op: Extract<Node, { type: 'binary' }>['op'], left: Scalar, right: Scalar): Scalar {
  if (isError(left)) return left;
  if (isError(right)) return right;
  switch (op) {
    case '&': {
      const a = toText(left);
      if (isError(a)) return a;
      const b = toText(right);
      if (isError(b)) return b;
      return a + b;
    }
    case '=':
      return compareScalars(left, right) === 0;
    case '<>':
      return compareScalars(left, right) !== 0;
    case '<':
      return compareScalars(left, right) < 0;
    case '>':
      return compareScalars(left, right) > 0;
    case '<=':
      return compareScalars(left, right) <= 0;
    case '>=':
      return compareScalars(left, right) >= 0;
    default: {
      const a = toNumber(left);
      if (isError(a)) return a;
      const b = toNumber(right);
      if (isError(b)) return b;
      if (op === '+') return normalizeNumber(a + b);
      if (op === '-') return normalizeNumber(a - b);
      if (op === '*') return normalizeNumber(a * b);
      if (op === '/') return b === 0 ? ERR.DIV0 : normalizeNumber(a / b);
      if (a === 0 && b === 0) return ERR.NUM;
      if (a === 0 && b < 0) return ERR.DIV0;
      return normalizeNumber(a ** b);
    }
  }
}

/** Evaluates an AST node. References stay ranges until a scalar is needed. */
export function evaluate(node: Node, ctx: EvalContext): Value {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'bool':
      return node.value;
    case 'error':
      return FormulaError.of(node.code);
    case 'missing':
      return null;
    case 'ref':
      return refValue(node, ctx);
    case 'name':
      return resolveName(node.name, ctx);
    case 'unary': {
      const value = toScalar(evaluate(node.operand, ctx), ctx);
      if (node.op === '+') return value;
      const n = toNumber(value);
      return isError(n) ? n : normalizeNumber(-n);
    }
    case 'percent': {
      const n = toNumber(toScalar(evaluate(node.operand, ctx), ctx));
      return isError(n) ? n : normalizeNumber(n / 100);
    }
    case 'binary':
      return binary(
        node.op,
        toScalar(evaluate(node.left, ctx), ctx),
        toScalar(evaluate(node.right, ctx), ctx),
      );
    case 'call': {
      const spec = FUNCTIONS.get(node.name);
      if (!spec) return ERR.NAME;
      if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) return ERR.VALUE;
      const missing = new Set<number>();
      const args = node.args.map((arg, index) => {
        if (arg.type === 'missing') missing.add(index);
        return evaluate(arg, ctx);
      });
      return spec.call(args, ctx, missing);
    }
  }
}

/** Evaluates a whole formula to the value cached in the cell (a blank result shows as 0, like Excel). */
export function evaluateFormula(formula: string, ctx: EvalContext): CellValue {
  let ast: Node;
  try {
    ast = parseCached(formula).ast;
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return { error: '#NAME?' };
    throw error;
  }
  const raw = evaluate(ast, ctx);
  const value = isRange(raw) ? toScalar(raw, ctx) : raw;
  return toCellValue(value);
}

export function toCellValue(value: Scalar): CellValue {
  if (value === null) return 0;
  if (isError(value)) return { error: value.code };
  if (typeof value === 'number') {
    const n = normalizeNumber(value);
    return isError(n) ? { error: n.code } : n;
  }
  return value;
}
