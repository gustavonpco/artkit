/**
 * Line-based OpenUI Lang syntax (spec §12.1): one declaration per line, `name = Component(args)`. This module only
 * tokenizes and edits text; schema checks belong to the parser of `@openuidev/lang-core`.
 */

export interface Statement {
  name: string;
  expr: string;
}

const DECLARATION = /^([a-z][A-Za-z0-9_]{0,63})\s*=\s*(.+)$/;

export interface ParsedLines {
  statements: Statement[];
  /** 1-based numbers of non-empty lines that are not declarations. */
  invalidLines: number[];
}

export function parseStatements(content: string): ParsedLines {
  const statements: Statement[] = [];
  const invalidLines: number[] = [];
  content.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const match = DECLARATION.exec(line.trim());
    if (match) statements.push({ name: match[1]!, expr: match[2]!.trim() });
    else invalidLines.push(index + 1);
  });
  return { statements, invalidLines };
}

export function serializeStatements(statements: readonly Statement[]): string {
  return `${statements.map((statement) => `${statement.name} = ${statement.expr}`).join('\n')}\n`;
}

export function formatStatement(statement: Statement): string {
  return `${statement.name} = ${statement.expr}`;
}

export type Token =
  | { kind: 'string'; text: string; start: number; end: number }
  | { kind: 'ident'; text: string; start: number; end: number }
  | { kind: 'punct'; text: string; start: number; end: number }
  | { kind: 'other'; text: string; start: number; end: number };

/** Tokenizes an expression. Strings keep their quotes and escapes; identifiers may contain dots (e.g. `Q1.total`). */
export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const char = expr[i]!;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== '"') j += expr[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, expr.length);
      tokens.push({ kind: 'string', text: expr.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_.]/.test(expr[j]!)) j += 1;
      tokens.push({ kind: 'ident', text: expr.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    if ('()[],'.includes(char)) {
      tokens.push({ kind: 'punct', text: char, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < expr.length && !/[\sA-Za-z_"()[\],]/.test(expr[j]!)) j += 1;
    tokens.push({ kind: 'other', text: expr.slice(i, j), start: i, end: j });
    i = j;
  }
  return tokens;
}

const LITERALS = new Set(['true', 'false', 'null']);

/** Names a declaration refers to: identifiers that are not component calls, literals or function calls. */
export function references(expr: string): string[] {
  const tokens = tokenize(expr);
  const refs: string[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'ident' || LITERALS.has(token.text)) return;
    const next = tokens[index + 1];
    if (next?.kind === 'punct' && next.text === '(') return;
    refs.push(token.text);
  });
  return refs;
}

/** Component name of a declaration (`Slide` for `Slide("title", [...])`), or undefined when there is none. */
export function componentOf(expr: string): string | undefined {
  const first = tokenize(expr)[0];
  return first?.kind === 'ident' ? first.text : undefined;
}

/** Replaces every reference to `from` with `to`, keeping the rest of the text untouched. */
export function renameReferences(expr: string, from: string, to: string): string {
  return rewriteTokens(expr, (token, next) => {
    if (token.kind === 'ident' && token.text === from && !(next?.kind === 'punct' && next.text === '('))
      return to;
    return undefined;
  });
}

/** Removes every reference to `name` inside array items (cascade). Items that are whole references are dropped. */
export function removeReferences(expr: string, name: string): string {
  const span = firstArraySpan(expr);
  if (!span) return expr;
  const items = splitItems(expr.slice(span.start + 1, span.end));
  const kept = items.filter((item) => item !== name);
  return `${expr.slice(0, span.start)}[${kept.join(', ')}]${expr.slice(span.end + 1)}`;
}

/** Position of the first `[ ... ]` argument of the outer call, or undefined. */
export function firstArraySpan(expr: string): { start: number; end: number } | undefined {
  let depth = 0;
  let start = -1;
  const tokens = tokenize(expr);
  for (const token of tokens) {
    if (token.kind === 'punct' && (token.text === '(' || token.text === '[')) {
      if (token.text === '[' && depth === 1 && start < 0) start = token.start;
      depth += 1;
    } else if (token.kind === 'punct' && (token.text === ')' || token.text === ']')) {
      depth -= 1;
      if (token.text === ']' && start >= 0 && depth === 1) return { start, end: token.start };
    }
  }
  return undefined;
}

/** Splits the inside of an array into top-level items (commas inside calls and strings do not split). Items keep their text. */
export function splitItems(inner: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let first: Token | undefined;
  let last: Token | undefined;
  const flush = () => {
    if (first && last) items.push(inner.slice(first.start, last.end));
    first = undefined;
    last = undefined;
  };
  for (const token of tokenize(inner)) {
    if (token.kind === 'punct' && token.text === ',' && depth === 0) {
      flush();
      continue;
    }
    if (token.kind === 'punct' && (token.text === '(' || token.text === '[')) depth += 1;
    if (token.kind === 'punct' && (token.text === ')' || token.text === ']')) depth -= 1;
    first ??= token;
    last = token;
  }
  flush();
  return items;
}

/** Children of the first array argument (names and inline components), in order. */
export function childrenOf(expr: string): string[] {
  const span = firstArraySpan(expr);
  return span ? splitItems(expr.slice(span.start + 1, span.end)) : [];
}

/** Replaces the children of the first array argument with `items`. */
export function setChildren(expr: string, items: string[]): string | undefined {
  const span = firstArraySpan(expr);
  if (!span) return undefined;
  return `${expr.slice(0, span.start)}[${items.join(', ')}]${expr.slice(span.end + 1)}`;
}

function rewriteTokens(
  expr: string,
  replace: (token: Token, next: Token | undefined) => string | undefined,
): string {
  const tokens = tokenize(expr);
  let out = '';
  let cursor = 0;
  tokens.forEach((token, index) => {
    const replacement = replace(token, tokens[index + 1]);
    if (replacement === undefined) return;
    out += expr.slice(cursor, token.start) + replacement;
    cursor = token.end;
  });
  return out + expr.slice(cursor);
}

export interface ComponentCall {
  component: string;
  /** Text between the parentheses of this call. */
  inner: string;
}

/** Every component call in an expression, outer and inline ones (`Slide(…, [Bullets([…])])` yields both). */
export function callsOf(expr: string): ComponentCall[] {
  const tokens = tokenize(expr);
  const calls: ComponentCall[] = [];
  tokens.forEach((token, index) => {
    const next = tokens[index + 1];
    if (token.kind !== 'ident' || next?.kind !== 'punct' || next.text !== '(') return;
    let depth = 0;
    for (let j = index + 1; j < tokens.length; j++) {
      const current = tokens[j]!;
      if (current.kind !== 'punct') continue;
      if (current.text === '(') depth += 1;
      if (current.text === ')') {
        depth -= 1;
        if (depth === 0) {
          calls.push({ component: token.text, inner: expr.slice(next.end, current.start) });
          return;
        }
      }
    }
  });
  return calls;
}

/** Top-level arguments of a call's inside text (commas inside nested calls and arrays do not split). */
export function argsOf(inner: string): string[] {
  return splitItems(inner);
}
