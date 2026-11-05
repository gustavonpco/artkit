import { type CellRange, formatRange, parseRange } from './a1.js';
import type { ValidationRule } from './model.js';
import type { ResolvedOperation } from './operations.js';

/** A dropdown rule with its range parsed, used while a batch runs. */
export interface ParsedRule {
  sheetId: string;
  range: CellRange;
  list: string[];
}

export function parseRules(rules: ValidationRule[] | undefined): ParsedRule[] {
  return (rules ?? []).flatMap((rule) => {
    const range = parseRange(rule.range);
    return range ? [{ sheetId: rule.sheet, range, list: rule.list }] : [];
  });
}

export function serializeRules(rules: ParsedRule[]): ValidationRule[] {
  return rules.map((rule) => ({ sheet: rule.sheetId, range: formatRange(rule.range), list: rule.list }));
}

function contains(range: CellRange, row: number, column: number): boolean {
  return (
    row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn
  );
}

/**
 * Where a range goes when rows or columns are inserted or removed (Excel-like): cells that move keep their rule,
 * a range that is entirely removed has no rule left.
 */
export function shiftRange(
  range: CellRange,
  change: { axis: 'row' | 'column'; kind: 'insert' | 'delete'; at: number; count: number },
): CellRange | undefined {
  const start = change.axis === 'row' ? range.startRow : range.startColumn;
  const end = change.axis === 'row' ? range.endRow : range.endColumn;
  let nextStart = start;
  let nextEnd = end;
  if (change.kind === 'insert') {
    if (start >= change.at) {
      nextStart = start + change.count;
      nextEnd = end + change.count;
    } else if (end >= change.at) {
      nextEnd = end + change.count;
    }
  } else {
    const removedEnd = change.at + change.count - 1;
    if (start >= change.at && end <= removedEnd) return undefined;
    // A start inside the removed rows moves to the first surviving row; an end inside them moves to the row before.
    nextStart = start < change.at ? start : start <= removedEnd ? change.at : start - change.count;
    nextEnd = end < change.at ? end : end <= removedEnd ? change.at - 1 : end - change.count;
    if (nextEnd < nextStart) return undefined;
  }
  return change.axis === 'row'
    ? { ...range, startRow: nextStart, endRow: nextEnd }
    : { ...range, startColumn: nextStart, endColumn: nextEnd };
}

/** Moves the rules of the sheets after a structural operation. Rules whose range disappears are dropped. */
export function shiftRules(rules: ParsedRule[], op: ResolvedOperation): ParsedRule[] {
  if (
    op.kind !== 'insert_rows' &&
    op.kind !== 'delete_rows' &&
    op.kind !== 'insert_columns' &&
    op.kind !== 'delete_columns'
  ) {
    return rules;
  }
  const change =
    op.kind === 'insert_rows'
      ? { axis: 'row' as const, kind: 'insert' as const, at: op.at, count: op.count }
      : op.kind === 'delete_rows'
        ? { axis: 'row' as const, kind: 'delete' as const, at: op.from, count: op.count }
        : op.kind === 'insert_columns'
          ? { axis: 'column' as const, kind: 'insert' as const, at: op.at, count: op.count }
          : { axis: 'column' as const, kind: 'delete' as const, at: op.from, count: op.count };
  return rules.flatMap((rule) => {
    if (rule.sheetId !== op.sheetId) return [rule];
    const range = shiftRange(rule.range, change);
    return range ? [{ ...rule, range }] : [];
  });
}

/** Upserts the rule of a range (a range has one rule). */
export function upsertRule(rules: ParsedRule[], rule: ParsedRule): ParsedRule[] {
  const same = (other: ParsedRule) =>
    other.sheetId === rule.sheetId && formatRange(other.range) === formatRange(rule.range);
  return rules.some(same) ? rules.map((other) => (same(other) ? rule : other)) : [...rules, rule];
}

/** The first value written into a dropdown range that is not in its list, or undefined. */
export function offendingValue(
  rules: ParsedRule[],
  sheetId: string,
  row: number,
  column: number,
  value: string | number | boolean | null,
): { list: string[]; value: string } | undefined {
  if (value === null || (typeof value === 'string' && value.startsWith('='))) return undefined;
  for (const rule of rules) {
    if (rule.sheetId !== sheetId || !contains(rule.range, row, column)) continue;
    const text = String(value);
    if (!rule.list.includes(text)) return { list: rule.list, value: text };
  }
  return undefined;
}
