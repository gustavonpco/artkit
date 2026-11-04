import type { CellPatch } from '../cells.js';
import { formatCellValue } from '../display.js';
import { isoFromSerial } from '../formula/dates.js';
import { numberToText } from '../formula/values.js';
import { inferValue, localeSeparators } from '../infer.js';
import { type Cell, isErrorValue } from '../schema.js';

/**
 * Patch for text typed into a cell: "=…" is a formula, numbers/percents/currency/dates/booleans are typed by
 * locale, empty text clears the value (keeping format and style).
 */
export function cellPatchFromText(text: string, locale: string, current?: Cell): CellPatch {
  if (text.trim() === '') return { v: null, f: null };
  if (current?.fmt === 'text' && !text.startsWith('=')) return { v: text };
  const inferred = inferValue(text, locale);
  if (!inferred) return { v: null, f: null };
  if (inferred.f !== undefined) return { f: inferred.f };
  const patch: CellPatch = { v: inferred.v ?? null };
  // Keep an existing format unless the text itself says otherwise ("15%", "R$ 10", a date).
  if (inferred.fmt && inferred.fmt !== current?.fmt) patch.fmt = inferred.fmt;
  return patch;
}

/** Text placed in the editor when editing an existing cell. */
export function cellEditText(cell: Cell | undefined, locale: string): string {
  if (!cell) return '';
  if (cell.f !== undefined) return `=${cell.f}`;
  const value = cell.v;
  if (value === undefined) return '';
  if (isErrorValue(value)) return value.error;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return formatCellValue(value, undefined, { locale, currency: 'USD' });
  const decimal = localeSeparators(locale).decimal;
  const plain = (n: number) => numberToText(n).replace('.', decimal);
  switch (cell.fmt) {
    case 'percent':
      return `${plain(Number((value * 100).toPrecision(15)))}%`;
    case 'date':
    case 'datetime': {
      const iso = isoFromSerial(value, cell.fmt === 'datetime');
      const [date, time] = iso.split('T');
      const [y, m, d] = date!.split('-');
      const localized = localeSeparators(locale).dayFirst ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
      return time ? `${localized} ${time}` : localized;
    }
    default:
      return plain(value);
  }
}
