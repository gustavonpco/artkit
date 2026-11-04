import { columnIndex, MAX_COLS, MAX_ROWS } from '../address.js';
import { FORMULA_ERRORS, type FormulaErrorCode } from '../schema.js';

/** One endpoint of a reference. `row`/`col` are zero-based; absent for whole-column or whole-row refs. */
export interface RefPart {
  row?: number;
  col?: number;
  rowAbs: boolean;
  colAbs: boolean;
}

export type RefKind = 'cell' | 'area' | 'cols' | 'rows';

export interface RefToken {
  /** Sheet name as written (unquoted), when the reference has a sheet prefix. */
  sheet?: string;
  kind: RefKind;
  a: RefPart;
  b: RefPart;
}

export type TokenType =
  | 'number'
  | 'string'
  | 'bool'
  | 'error'
  | 'ref'
  | 'name'
  | 'func'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma';

export interface Token {
  type: TokenType;
  /** Exact source text. */
  text: string;
  start: number;
  end: number;
  number?: number;
  string?: string;
  bool?: boolean;
  error?: FormulaErrorCode;
  ref?: RefToken;
  /** Upper-case identifier for `func` and `name` tokens (function prefixes like `_xlfn.` removed). */
  ident?: string;
  /** Sheet prefix written before `#REF!` (`Resumo!#REF!`). */
  sheet?: string;
}

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

const AREA = /(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7}):(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})/y;
const CELL = /(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})/y;
const COLS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/y;
const ROWS = /(\$?)([0-9]{1,7}):(\$?)([0-9]{1,7})/y;
const NUMBER = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const WORD = /[\p{L}\p{N}_.\\]+/uy;
const WORD_CHAR = /[\p{L}\p{N}_.\\$(!]/u;
const SPACE = /\s/;

function boundary(source: string, index: number): boolean {
  const ch = source[index];
  return ch === undefined || !WORD_CHAR.test(ch);
}

function exec(pattern: RegExp, source: string, index: number): RegExpExecArray | undefined {
  pattern.lastIndex = index;
  const match = pattern.exec(source);
  return match && boundary(source, pattern.lastIndex) ? match : undefined;
}

function cellPart(colAbs: string, letters: string, rowAbs: string, digits: string): RefPart | undefined {
  const col = columnIndex(letters);
  const row = Number(digits) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0) return undefined;
  return { col, row, colAbs: colAbs === '$', rowAbs: rowAbs === '$' };
}

/** Tries to read a reference body (`A1`, `$A$1:B9`, `C:C`, `2:5`) at `index`. */
function readRef(source: string, index: number): { ref: Omit<RefToken, 'sheet'>; end: number } | undefined {
  let m = exec(AREA, source, index);
  if (m) {
    const a = cellPart(m[1]!, m[2]!, m[3]!, m[4]!);
    const b = cellPart(m[5]!, m[6]!, m[7]!, m[8]!);
    if (a && b) return { ref: { kind: 'area', a, b }, end: index + m[0].length };
  }
  m = exec(CELL, source, index);
  if (m) {
    const a = cellPart(m[1]!, m[2]!, m[3]!, m[4]!);
    if (a) return { ref: { kind: 'cell', a, b: { ...a } }, end: index + m[0].length };
  }
  m = exec(COLS, source, index);
  if (m) {
    const c1 = columnIndex(m[2]!);
    const c2 = columnIndex(m[4]!);
    if (c1 >= 0 && c2 >= 0 && c1 < MAX_COLS && c2 < MAX_COLS) {
      return {
        ref: {
          kind: 'cols',
          a: { col: c1, colAbs: m[1] === '$', rowAbs: false },
          b: { col: c2, colAbs: m[3] === '$', rowAbs: false },
        },
        end: index + m[0].length,
      };
    }
  }
  m = exec(ROWS, source, index);
  if (m) {
    const r1 = Number(m[2]) - 1;
    const r2 = Number(m[4]) - 1;
    if (r1 >= 0 && r2 >= 0) {
      return {
        ref: {
          kind: 'rows',
          a: { row: r1, rowAbs: m[1] === '$', colAbs: false },
          b: { row: r2, rowAbs: m[3] === '$', colAbs: false },
        },
        end: index + m[0].length,
      };
    }
  }
  return undefined;
}

function readError(source: string, index: number): { code: FormulaErrorCode; end: number } | undefined {
  const rest = source.slice(index, index + 8).toUpperCase();
  for (const code of FORMULA_ERRORS) if (rest.startsWith(code)) return { code, end: index + code.length };
  return undefined;
}

const FUNCTION_PREFIX = /^(?:_XLFN\.|_XLWS\.)+/;
const OPERATORS = ['<=', '>=', '<>', '<', '>', '=', '+', '-', '*', '/', '^', '&', '%'];

/**
 * Splits a formula (without the leading `=`) into tokens with exact source spans, so references can be
 * rewritten in place without reformatting the rest of the formula.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (token: Omit<Token, 'text'>) =>
    tokens.push({ ...token, text: source.slice(token.start, token.end) });

  const afterSheet = (sheet: string, start: number, bodyStart: number) => {
    const error = readError(source, bodyStart);
    if (error?.code === '#REF!') {
      push({ type: 'error', error: '#REF!', sheet, start, end: error.end });
      return error.end;
    }
    const ref = readRef(source, bodyStart);
    if (!ref) throw new FormulaSyntaxError(`Invalid reference after sheet "${sheet}".`, bodyStart);
    push({ type: 'ref', ref: { ...ref.ref, sheet }, start, end: ref.end });
    return ref.end;
  };

  while (i < source.length) {
    const ch = source[i]!;
    if (SPACE.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    if (ch === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length)
          throw new FormulaSyntaxError('Unterminated text: a closing quote (") is missing.', start);
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += source[i];
        i++;
      }
      push({ type: 'string', string: value, start, end: i });
      continue;
    }
    if (ch === '#') {
      const error = readError(source, i);
      if (!error) throw new FormulaSyntaxError('Unknown error literal.', i);
      push({ type: 'error', error: error.code, start, end: error.end });
      i = error.end;
      continue;
    }
    if (ch === "'") {
      let name = '';
      i++;
      for (;;) {
        if (i >= source.length)
          throw new FormulaSyntaxError(
            "Unterminated sheet name: a closing apostrophe (') is missing.",
            start,
          );
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            name += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        name += source[i];
        i++;
      }
      if (source[i] !== '!')
        throw new FormulaSyntaxError(`A quoted sheet name must be followed by "!" and a reference.`, i);
      i = afterSheet(name, start, i + 1);
      continue;
    }
    if (ch === '{') throw new FormulaSyntaxError('Array constants ({...}) are not supported.', i);
    if (ch === '[')
      throw new FormulaSyntaxError('Structured and external references ([...]) are not supported.', i);
    if (ch === '(' || ch === ')') {
      push({ type: ch === '(' ? 'lparen' : 'rparen', start, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      push({ type: 'comma', start, end: i + 1 });
      i++;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      push({ type: 'op', start, end: i + op.length });
      i += op.length;
      continue;
    }
    // A reference must win over numbers (`2:5`) and words (`A1`, `$B$2`).
    const ref = readRef(source, i);
    if (ref) {
      push({ type: 'ref', ref: ref.ref, start, end: ref.end });
      i = ref.end;
      continue;
    }
    if (ch === '$') throw new FormulaSyntaxError('Invalid absolute reference.', i);
    if (/[0-9.]/.test(ch)) {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(source);
      if (match) {
        const value = Number(match[0]);
        if (!Number.isFinite(value)) throw new FormulaSyntaxError('Number out of range.', i);
        push({ type: 'number', number: value, start, end: NUMBER.lastIndex });
        i = NUMBER.lastIndex;
        if (i < source.length && /[\p{L}_]/u.test(source[i]!))
          throw new FormulaSyntaxError('Unexpected letter after a number.', i);
        continue;
      }
    }
    WORD.lastIndex = i;
    const word = WORD.exec(source);
    if (word) {
      const end = WORD.lastIndex;
      if (source[end] === '!') {
        i = afterSheet(word[0], start, end + 1);
        continue;
      }
      let next = end;
      while (next < source.length && SPACE.test(source[next]!)) next++;
      const upper = word[0].toUpperCase();
      if (source[next] === '(') {
        push({ type: 'func', ident: upper.replace(FUNCTION_PREFIX, ''), start, end });
      } else if (upper === 'TRUE' || upper === 'FALSE') {
        push({ type: 'bool', bool: upper === 'TRUE', start, end });
      } else {
        push({ type: 'name', ident: upper, start, end });
      }
      i = end;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected character "${ch}".`, i);
  }
  return tokens;
}

/** Reference endpoints are within the addressable grid (spec §6.6). */
export function refInBounds(ref: RefToken): boolean {
  for (const p of [ref.a, ref.b]) {
    if (p.row !== undefined && p.row >= MAX_ROWS) return false;
    if (p.col !== undefined && p.col >= MAX_COLS) return false;
  }
  return true;
}
