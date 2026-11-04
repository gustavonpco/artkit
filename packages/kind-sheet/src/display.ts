import { partsFromSerial, timeFromSerial } from './formula/dates.js';
import { numberToText } from './formula/values.js';
import { type CellValue, isErrorValue, type NamedFormat, type SheetContent } from './schema.js';

/** Currency of a locale's region (falls back to the language, then USD). */
const REGION_CURRENCY: Record<string, string> = {
  BR: 'BRL',
  US: 'USD',
  GB: 'GBP',
  PT: 'EUR',
  ES: 'EUR',
  FR: 'EUR',
  DE: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  IE: 'EUR',
  AT: 'EUR',
  BE: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  JP: 'JPY',
  CN: 'CNY',
  IN: 'INR',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  MX: 'MXN',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',
  UY: 'UYU',
  PY: 'PYG',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  ZA: 'ZAR',
  AO: 'AOA',
  MZ: 'MZN',
};

const LANGUAGE_CURRENCY: Record<string, string> = {
  pt: 'BRL',
  en: 'USD',
  es: 'EUR',
  fr: 'EUR',
  de: 'EUR',
  it: 'EUR',
  nl: 'EUR',
  ja: 'JPY',
  zh: 'CNY',
};

export function currencyForLocale(locale: string): string {
  const [language, ...rest] = locale.split(/[-_]/);
  const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  return (region && REGION_CURRENCY[region]) ?? LANGUAGE_CURRENCY[(language ?? '').toLowerCase()] ?? 'USD';
}

/** Currency used by the `currency` format: `settings.currency` or the locale's currency. */
export function resolveCurrency(content: Pick<SheetContent, 'settings'>, locale: string): string {
  return content.settings?.currency ?? currencyForLocale(locale);
}

export interface DisplayOptions {
  locale: string;
  currency: string;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `${locale}|${key}`;
  let found = numberFormats.get(id);
  if (!found) {
    try {
      found = new Intl.NumberFormat(locale, options);
    } catch {
      found = new Intl.NumberFormat('en-US', options);
    }
    numberFormats.set(id, found);
  }
  return found;
}

function dateFormat(locale: string, withTime: boolean): Intl.DateTimeFormat {
  const id = `${locale}|${withTime}`;
  let found = dateFormats.get(id);
  if (!found) {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
    };
    try {
      found = new Intl.DateTimeFormat(locale, options);
    } catch {
      found = new Intl.DateTimeFormat('en-US', options);
    }
    dateFormats.set(id, found);
  }
  return found;
}

/** JS Date (UTC) for an Excel serial. */
export function dateFromSerial(serial: number): Date {
  const { year, month, day } = partsFromSerial(serial);
  const { hours, minutes, seconds } = timeFromSerial(serial);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

function booleanText(value: boolean, locale: string): string {
  if (locale.toLowerCase().startsWith('pt')) return value ? 'VERDADEIRO' : 'FALSO';
  return value ? 'TRUE' : 'FALSE';
}

/** Formats a number with a named format and the locale (Intl). */
export function formatNumber(value: number, fmt: NamedFormat | undefined, options: DisplayOptions): string {
  const { locale, currency } = options;
  switch (fmt) {
    case 'integer':
      return numberFormat(locale, 'integer', { maximumFractionDigits: 0 }).format(value);
    case 'decimal2':
      return numberFormat(locale, 'decimal2', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        value,
      );
    case 'percent':
      return numberFormat(locale, 'percent', { style: 'percent', maximumFractionDigits: 2 }).format(value);
    case 'currency':
      return numberFormat(locale, `currency:${currency}`, { style: 'currency', currency }).format(value);
    case 'date':
    case 'datetime':
      if (value < 0 || value > 2_958_465) return '#'.repeat(8);
      return dateFormat(locale, fmt === 'datetime').format(dateFromSerial(value));
    case 'text':
      return numberToText(value);
    default:
      return numberFormat(locale, 'general', { maximumFractionDigits: 10, useGrouping: false }).format(value);
  }
}

/** Text shown for a cell value (renderer, HTML export, diff summaries). */
export function formatCellValue(
  value: CellValue | undefined,
  fmt: NamedFormat | undefined,
  options: DisplayOptions,
): string {
  if (value === undefined) return '';
  if (isErrorValue(value)) return value.error;
  if (typeof value === 'boolean') return booleanText(value, options.locale);
  if (typeof value === 'string') return value;
  return formatNumber(value, fmt, options);
}

/** Whether a value is shown right-aligned by default (numbers, dates), as spreadsheets do. */
export function isNumericDisplay(value: CellValue | undefined, fmt: NamedFormat | undefined): boolean {
  return typeof value === 'number' && fmt !== 'text';
}

/** xlsx number format code for a named format (invariant codes, currency symbol of the locale). */
export function xlsxNumberFormat(fmt: NamedFormat | undefined, options: DisplayOptions): string {
  switch (fmt) {
    case 'integer':
      return '#,##0';
    case 'decimal2':
      return '#,##0.00';
    case 'percent':
      return '0.00%';
    case 'currency':
      return currencyFormatCode(options);
    case 'date':
      return dateFormatCode(options.locale);
    case 'datetime':
      return `${dateFormatCode(options.locale)} hh:mm`;
    case 'text':
      return '@';
    default:
      return 'General';
  }
}

function currencyFormatCode({ locale, currency }: DisplayOptions): string {
  const parts = numberFormat(locale, `currency:${currency}`, { style: 'currency', currency }).formatToParts(
    1234.5,
  );
  const symbol = parts.find((part) => part.type === 'currency')?.value ?? currency;
  const symbolIndex = parts.findIndex((part) => part.type === 'currency');
  const integerIndex = parts.findIndex((part) => part.type === 'integer');
  const spaced = parts.some((part) => part.type === 'literal' && /\s/.test(part.value));
  const digits =
    (parts.find((part) => part.type === 'fraction')?.value.length ?? 0) > 0 ? '#,##0.00' : '#,##0';
  const quoted = `"${symbol.replace(/"/g, '')}"`;
  const positive =
    symbolIndex < integerIndex
      ? `${quoted}${spaced ? ' ' : ''}${digits}`
      : `${digits}${spaced ? ' ' : ''}${quoted}`;
  return `${positive};-${positive}`;
}

function dateFormatCode(locale: string): string {
  const parts = dateFormat(locale, false).formatToParts(new Date(Date.UTC(2026, 10, 4)));
  const order = parts
    .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => part.type);
  const separator = parts.find((part) => part.type === 'literal')?.value ?? '/';
  const code = { day: 'dd', month: 'mm', year: 'yyyy' } as Record<string, string>;
  return order.map((type) => code[type]).join(separator.trim() || '/');
}
