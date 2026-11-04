import { serialFromIso, serialFromParts } from './formula/dates.js';
import type { NamedFormat } from './schema.js';

/** A value typed by a person or read from a table/CSV, converted to cell fields. */
export interface InferredValue {
  v?: string | number | boolean;
  f?: string;
  fmt?: NamedFormat;
}

interface Separators {
  decimal: string;
  group: string;
  /** Day before month in numeric dates (dd/mm/yyyy). */
  dayFirst: boolean;
}

const cache = new Map<string, Separators>();

/** Decimal/grouping separators and date order of a locale, read from Intl. */
export function localeSeparators(locale: string): Separators {
  let found = cache.get(locale);
  if (!found) {
    let parts: Intl.NumberFormatPart[];
    let dateParts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
      dateParts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).formatToParts(
        new Date(Date.UTC(2026, 10, 24)),
      );
    } catch {
      parts = new Intl.NumberFormat('en-US').formatToParts(12345.6);
      dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).formatToParts(
        new Date(Date.UTC(2026, 10, 24)),
      );
    }
    const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
    const group = parts.find((part) => part.type === 'group')?.value ?? (decimal === ',' ? '.' : ',');
    const order = dateParts
      .filter((part) => part.type === 'day' || part.type === 'month')
      .map((part) => part.type);
    found = { decimal, group: group.replace(/\s/g, ' '), dayFirst: order[0] === 'day' };
    cache.set(locale, found);
  }
  return found;
}

const CURRENCY_SYMBOL = /^(?:R\$|US\$|\$|€|£|¥|₹|BRL|USD|EUR|GBP)\s*|\s*(?:R\$|€|£|BRL|USD|EUR|GBP)$/;

/** Parses a localized number ("1.234,56" in pt-BR, "1,234.56" in en-US, plain "1234.5" anywhere). */
export function parseLocaleNumber(text: string, locale: string): number | undefined {
  const trimmed = text.trim().replace(/ | /g, ' ');
  if (trimmed === '') return undefined;
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
  const { decimal, group } = localeSeparators(locale);
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
  const body = trimmed.replace(/^[(+-]|\)$/g, '').trim();
  const groupPattern = group === '.' ? '\\.' : group === ' ' ? ' ' : ',';
  const decimalPattern = decimal === ',' ? ',' : '\\.';
  const pattern = new RegExp(
    `^\\d{1,3}(?:${groupPattern}\\d{3})*(?:${decimalPattern}\\d+)?$|^\\d+(?:${decimalPattern}\\d+)?$`,
  );
  if (!pattern.test(body)) return undefined;
  const normalized = body.split(group).join('').replace(decimal, '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return undefined;
  return negative ? -value : value;
}

/** Parses dates written as ISO, dd/mm/yyyy (day-first locales) or mm/dd/yyyy (en-US). */
export function parseLocaleDate(
  text: string,
  locale: string,
): { serial: number; withTime: boolean } | undefined {
  const trimmed = text.trim();
  const iso = serialFromIso(trimmed);
  if (iso !== undefined) return { serial: iso, withTime: /[T ]\d/.test(trimmed) };
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const { dayFirst } = localeSeparators(locale);
  const a = Number(match[1]);
  const b = Number(match[2]);
  const [day, month] = dayFirst ? [a, b] : [b, a];
  const year = Number(match[3]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    year < 1900
  )
    return undefined;
  let serial = serialFromParts(year, month, day);
  const withTime = match[4] !== undefined;
  if (withTime) {
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    if (hours > 23 || minutes > 59) return undefined;
    serial += (hours * 60 + minutes) / 1440;
  }
  return { serial, withTime };
}

const TRUE_WORDS = new Set(['TRUE', 'VERDADEIRO']);
const FALSE_WORDS = new Set(['FALSE', 'FALSO']);

/**
 * Infers a cell from text: formulas ("=…"), booleans, percents, currency amounts, localized numbers and
 * dates. Anything else stays text. Empty text returns `undefined`.
 */
export function inferValue(raw: string, locale: string): InferredValue | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  if (text.length > 1 && text.startsWith('=')) return { f: text.slice(1) };
  const upper = text.toUpperCase();
  if (TRUE_WORDS.has(upper)) return { v: true };
  if (FALSE_WORDS.has(upper)) return { v: false };
  if (text.endsWith('%')) {
    const n = parseLocaleNumber(text.slice(0, -1), locale);
    if (n !== undefined) return { v: Number((n / 100).toPrecision(15)), fmt: 'percent' };
  }
  if (CURRENCY_SYMBOL.test(text)) {
    const n = parseLocaleNumber(text.replace(CURRENCY_SYMBOL, '').replace(/^-\s*/, '-'), locale);
    if (n !== undefined) return { v: text.trim().startsWith('-') && n > 0 ? -n : n, fmt: 'currency' };
  }
  // Codes with leading zeros ("00123") stay text, as spreadsheets would lose the zeros.
  if (!/^0\d/.test(text)) {
    const n = parseLocaleNumber(text, locale);
    if (n !== undefined) return { v: n };
  }
  const date = parseLocaleDate(text, locale);
  if (date) return { v: date.serial, fmt: date.withTime ? 'datetime' : 'date' };
  return { v: raw };
}
