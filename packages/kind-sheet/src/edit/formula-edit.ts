import { cellKey, formatRange, quoteSheetName, type Rect } from '../address.js';
import { FUNCTIONS, type FunctionSpec } from '../formula/functions.js';

/** Function-name prefix being typed at the caret (`=SU|` → `SU`), for autocomplete. */
export function functionPrefixAt(text: string, caret: number): { start: number; prefix: string } | undefined {
  if (!text.startsWith('=')) return undefined;
  const before = text.slice(0, caret);
  if (inString(before)) return undefined;
  const match = /(^|[=(,;+\-*/^&<> ])([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
  if (!match) return undefined;
  const prefix = match[2]!;
  // A cell reference being typed (A1) is not a function prefix.
  if (/^[A-Za-z]{1,3}\d+$/.test(prefix)) return undefined;
  return { start: caret - prefix.length, prefix };
}

function inString(text: string): boolean {
  return (text.match(/"/g) ?? []).length % 2 === 1;
}

/** Supported functions starting with the prefix (autocomplete is limited to the supported subset). */
export function suggestFunctions(prefix: string, limit = 8): FunctionSpec[] {
  const upper = prefix.toUpperCase();
  return [...FUNCTIONS.values()].filter((spec) => spec.name.startsWith(upper)).slice(0, limit);
}

/** Replaces the typed prefix with `NAME(` and returns the new text and caret. */
export function applySuggestion(text: string, caret: number, name: string): { text: string; caret: number } {
  const found = functionPrefixAt(text, caret);
  const start = found?.start ?? caret;
  const next = `${text.slice(0, start)}${name}(${text.slice(caret)}`;
  return { text: next, caret: start + name.length + 1 };
}

/** Function whose argument list contains the caret, to show its signature while typing. */
export function enclosingFunction(text: string, caret: number): FunctionSpec | undefined {
  if (!text.startsWith('=')) return undefined;
  let depth = 0;
  let quoted = false;
  const before = text.slice(0, caret);
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]!;
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const name = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(before.slice(0, i))?.[1];
        return name ? FUNCTIONS.get(name.toUpperCase()) : undefined;
      }
      depth--;
    }
  }
  return undefined;
}

/**
 * "Point mode": clicking the grid while typing a formula inserts a reference when the caret follows an
 * operator, "(", "," or the leading "=".
 */
export function acceptsReference(text: string, caret: number): boolean {
  if (!text.startsWith('=')) return false;
  const before = text.slice(0, caret).trimEnd();
  if (inString(before)) return false;
  return /[=(,;+\-*/^&<>:]$/.test(before);
}

/** Reference text for a rectangle, prefixed with the sheet when it is not the formula's sheet. */
export function referenceText(rect: Rect, sheetName: string, formulaSheet: string): string {
  const range =
    rect.top === rect.bottom && rect.left === rect.right ? cellKey(rect.top, rect.left) : formatRange(rect);
  return sheetName.toUpperCase() === formulaSheet.toUpperCase()
    ? range
    : `${quoteSheetName(sheetName)}!${range}`;
}

/**
 * Inserts (or, while dragging, replaces the previously inserted) reference at the caret. Returns the text,
 * caret and the span of the inserted reference.
 */
export function insertReference(
  text: string,
  caret: number,
  reference: string,
  replace?: { start: number; end: number },
): { text: string; caret: number; span: { start: number; end: number } } {
  const start = replace?.start ?? caret;
  const end = replace?.end ?? caret;
  const next = text.slice(0, start) + reference + text.slice(end);
  return { text: next, caret: start + reference.length, span: { start, end: start + reference.length } };
}
