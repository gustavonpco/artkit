import { isError, parseNumericText, type Scalar } from './values.js';

export type CriteriaMatcher = (value: Scalar) => boolean;

/** Converts an Excel wildcard pattern (`*`, `?`, `~` escape) into an anchored, case-insensitive regex. */
export function wildcardRegex(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1]!)) {
      source += `\\${pattern[++i]}`;
    } else if (ch === '*') source += '[\\s\\S]*';
    else if (ch === '?') source += '[\\s\\S]';
    else source += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

export function hasWildcards(text: string): boolean {
  return /(^|[^~])[*?]/.test(text);
}

function numericValue(value: Scalar): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseNumericText(value);
  return undefined;
}

const isBlank = (value: Scalar) => value === null || value === '';

/**
 * Builds a matcher for COUNTIF/SUMIF-style criteria: numbers, logicals, or text with an optional
 * operator (`">10"`, `"<>x"`, `"=a*"`). Text criteria are case-insensitive and support wildcards.
 */
export function buildCriteria(criteria: Scalar): CriteriaMatcher {
  if (isError(criteria)) return (value) => value === criteria;
  if (criteria === null) return (value) => typeof value === 'number' && value === 0;
  if (typeof criteria === 'number')
    return (value) => numericValue(value) === criteria && typeof value !== 'boolean';
  if (typeof criteria === 'boolean') return (value) => value === criteria;

  const match = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(criteria)!;
  const op = match[1] ?? '';
  const operand = match[2]!;
  const number = parseNumericText(operand);
  const upper = operand.toUpperCase();
  const logical = upper === 'TRUE' ? true : upper === 'FALSE' ? false : undefined;

  if (op === '' || op === '=') {
    if (operand === '') return op === '=' ? (value) => value === null : isBlank;
    if (number !== undefined) return (value) => typeof value !== 'boolean' && numericValue(value) === number;
    if (logical !== undefined) return (value) => value === logical;
    const regex = wildcardRegex(operand);
    return (value) => typeof value === 'string' && regex.test(value);
  }
  if (op === '<>') {
    if (operand === '') return (value) => !isBlank(value);
    if (number !== undefined) return (value) => typeof value === 'boolean' || numericValue(value) !== number;
    if (logical !== undefined) return (value) => value !== logical;
    const regex = wildcardRegex(operand);
    return (value) => !(typeof value === 'string' && regex.test(value));
  }
  const test = (cmp: number) =>
    op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0;
  if (number !== undefined) return (value) => typeof value === 'number' && test(value - number);
  const key = operand.toUpperCase();
  return (value) => {
    if (typeof value !== 'string') return false;
    const other = value.toUpperCase();
    return test(other < key ? -1 : other > key ? 1 : 0);
  };
}
