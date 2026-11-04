import type { FormulaErrorCode } from '../schema.js';
import { FormulaSyntaxError, type RefToken, type Token, tokenize } from './tokenizer.js';

interface Span {
  start: number;
  end: number;
}

export type Node =
  | (Span & { type: 'number'; value: number })
  | (Span & { type: 'string'; value: string })
  | (Span & { type: 'bool'; value: boolean })
  | (Span & { type: 'error'; code: FormulaErrorCode })
  | (Span & { type: 'ref'; ref: RefToken })
  | (Span & { type: 'name'; name: string })
  | (Span & { type: 'call'; name: string; args: Node[] })
  | (Span & { type: 'unary'; op: '+' | '-'; operand: Node })
  | (Span & { type: 'percent'; operand: Node })
  | (Span & { type: 'binary'; op: BinaryOp; left: Node; right: Node })
  | (Span & { type: 'missing' });

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

const PRECEDENCE: Record<BinaryOp, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

export interface ParsedFormula {
  ast: Node;
  tokens: Token[];
}

/** Removes the optional leading `=` (formulas are stored without it). */
export function stripEquals(formula: string): string {
  const trimmed = formula.trim();
  return trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
}

/**
 * Parses a formula with Excel precedence: comparison < `&` < `+ -` < `* /` < `^` (left associative)
 * < postfix `%` < unary minus (so `-2^2` is 4, as in Excel).
 */
export function parseFormula(formula: string): ParsedFormula {
  const source = stripEquals(formula);
  const tokens = tokenize(source);
  if (tokens.length === 0) throw new FormulaSyntaxError('The formula is empty.', 0);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const end = source.length;

  const expect = (type: Token['type'], what: string): Token => {
    const token = next();
    if (!token || token.type !== type) throw new FormulaSyntaxError(`Expected ${what}.`, token?.start ?? end);
    return token;
  };

  function parseExpression(minPrec: number): Node {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (token?.type !== 'op' || token.text === '%') break;
      const op = token.text as BinaryOp;
      const prec = PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = parseExpression(prec + 1);
      left = { type: 'binary', op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  function parseUnary(): Node {
    const token = peek();
    if (token?.type === 'op' && (token.text === '-' || token.text === '+')) {
      next();
      const operand = parseUnary();
      return { type: 'unary', op: token.text, operand, start: token.start, end: operand.end };
    }
    let node = parsePrimary();
    while (peek()?.type === 'op' && peek()?.text === '%') {
      const percent = next()!;
      node = { type: 'percent', operand: node, start: node.start, end: percent.end };
    }
    return node;
  }

  function parsePrimary(): Node {
    const token = next();
    if (!token) throw new FormulaSyntaxError('The formula ends unexpectedly.', end);
    const span = { start: token.start, end: token.end };
    switch (token.type) {
      case 'number':
        return { type: 'number', value: token.number!, ...span };
      case 'string':
        return { type: 'string', value: token.string!, ...span };
      case 'bool':
        return { type: 'bool', value: token.bool!, ...span };
      case 'error':
        return { type: 'error', code: token.error!, ...span };
      case 'ref':
        return { type: 'ref', ref: token.ref!, ...span };
      case 'name':
        return { type: 'name', name: token.ident!, ...span };
      case 'func':
        return parseCall(token);
      case 'lparen': {
        const inner = parseExpression(1);
        const close = expect('rparen', 'a closing parenthesis ")"');
        return { ...inner, start: token.start, end: close.end };
      }
      default:
        throw new FormulaSyntaxError(`Unexpected "${token.text}".`, token.start);
    }
  }

  function parseCall(token: Token): Node {
    expect('lparen', '"(" after the function name');
    const args: Node[] = [];
    if (peek()?.type === 'rparen') {
      const close = next()!;
      return { type: 'call', name: token.ident!, args, start: token.start, end: close.end };
    }
    for (;;) {
      const current = peek();
      if (!current)
        throw new FormulaSyntaxError(`A closing parenthesis ")" is missing for ${token.ident}.`, end);
      if (current.type === 'comma' || current.type === 'rparen') {
        args.push({ type: 'missing', start: current.start, end: current.start });
      } else {
        args.push(parseExpression(1));
      }
      const separator = next();
      if (!separator)
        throw new FormulaSyntaxError(`A closing parenthesis ")" is missing for ${token.ident}.`, end);
      if (separator.type === 'rparen')
        return { type: 'call', name: token.ident!, args, start: token.start, end: separator.end };
      if (separator.type !== 'comma')
        throw new FormulaSyntaxError(`Expected "," or ")" in ${token.ident}.`, separator.start);
      if (args.length >= 255) throw new FormulaSyntaxError('Too many arguments (max 255).', separator.start);
    }
  }

  const ast = parseExpression(1);
  const extra = peek();
  if (extra) throw new FormulaSyntaxError(`Unexpected "${extra.text}".`, extra.start);
  return { ast, tokens };
}

// Above the filled-cell limit so a full recalculation never evicts its own formulas.
const CACHE_LIMIT = 60_000;
const cache = new Map<string, ParsedFormula | FormulaSyntaxError>();

/** Memoized parse (pure: the same text always gives the same tree). Throws `FormulaSyntaxError`. */
export function parseCached(formula: string): ParsedFormula {
  let hit = cache.get(formula);
  if (hit === undefined) {
    try {
      hit = parseFormula(formula);
    } catch (error) {
      if (!(error instanceof FormulaSyntaxError)) throw error;
      hit = error;
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(formula, hit);
  }
  if (hit instanceof FormulaSyntaxError) throw hit;
  return hit;
}

/** Visits every node depth-first. */
export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  switch (node.type) {
    case 'call':
      for (const arg of node.args) walk(arg, visit);
      break;
    case 'unary':
    case 'percent':
      walk(node.operand, visit);
      break;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    default:
      break;
  }
}
