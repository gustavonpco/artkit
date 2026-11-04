/**
 * Excel 1900 date system. Serial 1 is 1900-01-01 and serial 60 is the fictitious 1900-02-29 kept by Excel
 * for Lotus compatibility, so serials match Excel from 1900-03-01 (61) on.
 */

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

export interface Ymd {
  year: number;
  month: number;
  day: number;
}

/** Serial of the first day of a month (month 1–12), honoring the 1900 leap-year quirk. */
function firstOfMonth(year: number, month: number): number {
  if (year === 1900 && month <= 2) return month === 1 ? 1 : 32;
  return Math.round((Date.UTC(year, month - 1, 1) - EPOCH) / DAY_MS);
}

/**
 * Serial for a year/month/day with Excel DATE overflow rules: months and days outside their range roll
 * over (`DATE(2026,14,1)` is 2027-02-01, `DATE(1900,3,0)` is the fictitious 1900-02-29).
 */
export function serialFromParts(year: number, month: number, day: number): number {
  const totalMonths = year * 12 + (month - 1);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths - y * 12 + 1;
  return firstOfMonth(y, m) + day - 1;
}

export function partsFromSerial(serial: number): Ymd {
  const n = Math.floor(serial);
  if (n === 60) return { year: 1900, month: 2, day: 29 };
  if (n === 0) return { year: 1900, month: 1, day: 0 };
  const offset = n < 60 ? n + 1 : n;
  const date = new Date(EPOCH + offset * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Time of day of a serial as hours, minutes, seconds (rounded to the second). */
export function timeFromSerial(serial: number): { hours: number; minutes: number; seconds: number } {
  const fraction = serial - Math.floor(serial);
  let total = Math.round(fraction * 86_400);
  if (total >= 86_400) total = 86_399;
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

export function daysInMonth(year: number, month: number): number {
  if (year === 1900 && month === 2) return 29;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, by serial (Excel considers 1900-01-01 a Sunday). */
export function dayOfWeek(serial: number): number {
  return (((Math.floor(serial) + 6) % 7) + 7) % 7;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Parses `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS]` into a serial; undefined for invalid dates. */
export function serialFromIso(text: string): number | undefined {
  const match = ISO_DATE.exec(text.trim());
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  const base = serialFromParts(year, month, day);
  if (match[4] === undefined) return base;
  const [h, mi, s] = [Number(match[4]), Number(match[5]), Number(match[6] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return undefined;
  return base + (h * 3600 + mi * 60 + s) / 86_400;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** `YYYY-MM-DD` (plus `THH:MM` when the serial has a time part and `withTime` is set). */
export function isoFromSerial(serial: number, withTime = false): string {
  const { year, month, day } = partsFromSerial(serial);
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  if (!withTime) return date;
  const { hours, minutes, seconds } = timeFromSerial(serial);
  return `${date}T${pad(hours)}:${pad(minutes)}${seconds ? `:${pad(seconds)}` : ''}`;
}

/** Largest serial accepted (9999-12-31), as in Excel. */
export const MAX_SERIAL = 2_958_465;
