import { partsFromSerial, timeFromSerial } from './dates.js';
import { ERR, type FormulaError, numberToText } from './values.js';

/**
 * Excel number-format codes for TEXT(). Codes use the invariant convention stored in xlsx files
 * (`.` decimal, `,` thousands) and English month/day names, so results do not depend on the runtime.
 */

type Part =
  | { kind: 'literal'; text: string }
  | { kind: 'digit'; char: '0' | '#' | '?' }
  | { kind: 'point' }
  | { kind: 'comma' }
  | { kind: 'percent' }
  | { kind: 'exp'; sign: '+' | '-' }
  | { kind: 'text' }
  | { kind: 'date'; token: string }
  | { kind: 'general' };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && !quoted) {
      current += ch + (code[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === ';' && !quoted) {
      sections.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  sections.push(current);
  return sections;
}

function lex(section: string): Part[] {
  const parts: Part[] = [];
  let i = 0;
  const lower = section.toLowerCase();
  while (i < section.length) {
    const ch = section[i]!;
    const lc = lower[i]!;
    if (ch === '"') {
      const close = section.indexOf('"', i + 1);
      const end = close < 0 ? section.length : close;
      parts.push({ kind: 'literal', text: section.slice(i + 1, end) });
      i = end + 1;
    } else if (ch === '\\') {
      parts.push({ kind: 'literal', text: section[i + 1] ?? '' });
      i += 2;
    } else if (ch === '[') {
      // Colors and conditions do not change the produced text.
      const close = section.indexOf(']', i);
      i = close < 0 ? section.length : close + 1;
    } else if (ch === '_') {
      parts.push({ kind: 'literal', text: ' ' });
      i += 2;
    } else if (ch === '*') {
      i += 2;
    } else if (lower.startsWith('general', i)) {
      parts.push({ kind: 'general' });
      i += 7;
    } else if (ch === '0' || ch === '#' || ch === '?') {
      parts.push({ kind: 'digit', char: ch });
      i++;
    } else if (ch === '.') {
      parts.push({ kind: 'point' });
      i++;
    } else if (ch === ',') {
      parts.push({ kind: 'comma' });
      i++;
    } else if (ch === '%') {
      parts.push({ kind: 'percent' });
      i++;
    } else if (lc === 'e' && (section[i + 1] === '+' || section[i + 1] === '-')) {
      parts.push({ kind: 'exp', sign: section[i + 1] as '+' | '-' });
      i += 2;
    } else if (ch === '@') {
      parts.push({ kind: 'text' });
      i++;
    } else if (lower.startsWith('am/pm', i) || lower.startsWith('a/p', i)) {
      const length = lower.startsWith('am/pm', i) ? 5 : 3;
      parts.push({ kind: 'date', token: lower.slice(i, i + length) });
      i += length;
    } else if ('ymdhs'.includes(lc)) {
      let j = i;
      while (j < section.length && lower[j] === lc) j++;
      parts.push({ kind: 'date', token: lower.slice(i, j) });
      i = j;
    } else {
      parts.push({ kind: 'literal', text: ch });
      i++;
    }
  }
  return parts;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

function formatDate(serial: number, parts: Part[]): string {
  if (serial < 0) return '#'.repeat(10);
  const { year, month, day } = partsFromSerial(serial);
  const hasAmPm = parts.some((p) => p.kind === 'date' && (p.token === 'am/pm' || p.token === 'a/p'));
  let { hours, minutes, seconds } = timeFromSerial(serial);
  if (hasAmPm) hours = hours % 12 === 0 ? 12 : hours % 12;
  const pm = timeFromSerial(serial).hours >= 12;
  const dateParts = parts.map((p, index) => ({ p, index }));
  let out = '';
  for (const { p, index } of dateParts) {
    if (p.kind !== 'date') {
      if (p.kind === 'literal') out += p.text;
      else if (p.kind === 'point') out += '.';
      else if (p.kind === 'comma') out += ',';
      else if (p.kind === 'digit' && p.char === '0') out += '0';
      continue;
    }
    const t = p.token;
    if (t === 'am/pm') out += pm ? 'PM' : 'AM';
    else if (t === 'a/p') out += pm ? 'P' : 'A';
    else if (t[0] === 'y') out += t.length <= 2 ? pad(year % 100) : pad(year, 4);
    else if (t[0] === 'd')
      out +=
        t.length === 1
          ? String(day)
          : t.length === 2
            ? pad(day)
            : t.length === 3
              ? DAYS[dayIndex(serial)]!.slice(0, 3)
              : DAYS[dayIndex(serial)]!;
    else if (t[0] === 'h') out += t.length === 1 ? String(hours) : pad(hours);
    else if (t[0] === 's') out += t.length === 1 ? String(seconds) : pad(seconds);
    else if (t[0] === 'm') {
      if (
        isMinute(
          dateParts.map((d) => d.p),
          index,
        )
      )
        out += t.length === 1 ? String(minutes) : pad(minutes);
      else if (t.length === 1) out += String(month);
      else if (t.length === 2) out += pad(month);
      else if (t.length === 3) out += MONTHS[month - 1]!.slice(0, 3);
      else if (t.length === 5) out += MONTHS[month - 1]![0];
      else out += MONTHS[month - 1]!;
    }
  }
  return out;
}

function dayIndex(serial: number): number {
  return (((Math.floor(serial) + 6) % 7) + 7) % 7;
}

/** `m` means minutes right after an hour token or right before a seconds token. */
function isMinute(parts: Part[], index: number): boolean {
  const token = (parts[index] as { token: string }).token;
  if (token.length > 2) return false;
  for (let i = index - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.kind === 'date') {
      if (p.token[0] === 'h') return true;
      break;
    }
  }
  for (let i = index + 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.kind === 'date') return p.token[0] === 's';
  }
  return false;
}

function roundHalfAway(value: number, digits: number): number {
  const sign = value < 0 ? -1 : 1;
  const shifted = Number(`${Math.abs(value)}e${digits}`);
  return sign * Number(`${Math.round(shifted)}e${-digits}`);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumber(value: number, parts: Part[], negativeSign: boolean): string {
  if (parts.some((p) => p.kind === 'general')) {
    return parts
      .map((p) => (p.kind === 'general' ? numberToText(Math.abs(value)) : p.kind === 'literal' ? p.text : ''))
      .join('');
  }
  const firstDigit = parts.findIndex((p) => p.kind === 'digit');
  const pointIndex = parts.findIndex((p) => p.kind === 'point');
  const expIndex = parts.findIndex((p) => p.kind === 'exp');
  let scaled = Math.abs(value);
  for (const p of parts) if (p.kind === 'percent') scaled *= 100;
  // Commas right after the last integer placeholder scale by 1000.
  const integerEnd = pointIndex >= 0 ? pointIndex : expIndex >= 0 ? expIndex : parts.length;
  let lastInt = -1;
  for (let i = 0; i < integerEnd; i++) if (parts[i]!.kind === 'digit') lastInt = i;
  let scaleCommas = 0;
  for (let i = lastInt + 1; i < parts.length && parts[i]!.kind === 'comma'; i++) scaleCommas++;
  scaled /= 1000 ** scaleCommas;
  const grouping = parts.some((p, i) => p.kind === 'comma' && i > firstDigit && i < lastInt);

  const intPlaceholders: number[] = [];
  const fracPlaceholders: number[] = [];
  const expPlaceholders: number[] = [];
  parts.forEach((p, i) => {
    if (p.kind !== 'digit') return;
    if (expIndex >= 0 && i > expIndex) expPlaceholders.push(i);
    else if (pointIndex >= 0 && i > pointIndex) fracPlaceholders.push(i);
    else intPlaceholders.push(i);
  });

  let exponent = 0;
  if (expIndex >= 0 && scaled !== 0) {
    const intDigits = Math.max(1, intPlaceholders.length);
    exponent = Math.floor(Math.log10(scaled)) - (intDigits - 1);
    scaled /= 10 ** exponent;
  }
  const rounded = roundHalfAway(scaled, fracPlaceholders.length);
  const [intText, fracRaw = ''] = rounded.toFixed(fracPlaceholders.length).split('.');
  let intDigits = intText === '0' ? '' : intText!;

  const out = parts.map((p) => (p.kind === 'literal' ? p.text : p.kind === 'percent' ? '%' : ''));
  // Integer placeholders, filled right to left; extra digits go to the first placeholder.
  const minInt = intPlaceholders.filter((i) => (parts[i] as { char: string }).char === '0').length;
  if (intDigits.length < minInt) intDigits = intDigits.padStart(minInt, '0');
  if (grouping) {
    if (intPlaceholders.length > 0) out[intPlaceholders[0]!] = groupThousands(intDigits);
  } else {
    let remaining = intDigits;
    for (let k = intPlaceholders.length - 1; k >= 0; k--) {
      const index = intPlaceholders[k]!;
      const char = (parts[index] as { char: string }).char;
      if (k === 0) out[index] = remaining || (char === '?' ? ' ' : '');
      else if (remaining.length > 0) {
        out[index] = remaining.slice(-1);
        remaining = remaining.slice(0, -1);
      } else out[index] = char === '?' ? ' ' : '';
    }
  }
  if (pointIndex >= 0) out[pointIndex] = '.';
  // Fraction placeholders: trailing optional digits drop zeros.
  let fraction = fracRaw;
  for (let k = fracPlaceholders.length - 1; k >= 0; k--) {
    const char = (parts[fracPlaceholders[k]!] as { char: string }).char;
    if (char === '0' || !fraction.endsWith('0')) break;
    fraction = fraction.slice(0, -1);
  }
  fracPlaceholders.forEach((index, k) => {
    const char = (parts[index] as { char: string }).char;
    out[index] = fraction[k] ?? (char === '?' ? ' ' : '');
  });
  if (expIndex >= 0) {
    const sign = exponent < 0 ? '-' : (parts[expIndex] as { sign: string }).sign === '+' ? '+' : '';
    out[expIndex] = `E${sign}`;
    const expText = String(Math.abs(exponent)).padStart(expPlaceholders.length, '0');
    expPlaceholders.forEach((index, k) => {
      out[index] =
        k === 0
          ? expText.slice(0, expText.length - expPlaceholders.length + 1)
          : expText[expText.length - expPlaceholders.length + k]!;
    });
  }
  const text = out.join('');
  return negativeSign && value < 0 && rounded !== 0 ? `-${text}` : text;
}

function isDateSection(parts: Part[]): boolean {
  return parts.some((p) => p.kind === 'date') && !parts.some((p) => p.kind === 'digit' && p.char !== '0');
}

/** TEXT(value, format_text) for numbers, text and logicals. */
export function formatWithCode(value: number | string | boolean, code: string): string | FormulaError {
  const sections = splitSections(code);
  if (sections.length > 4) return ERR.VALUE;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') {
    const textSection =
      sections[3] ?? (sections.length === 1 && sections[0]!.includes('@') ? sections[0] : undefined);
    if (textSection === undefined) return value;
    return lex(textSection)
      .map((p) => (p.kind === 'text' ? value : p.kind === 'literal' ? p.text : ''))
      .join('');
  }
  let section = sections[0]!;
  let negativeSign = true;
  if (value < 0 && sections[1] !== undefined) {
    section = sections[1];
    negativeSign = false;
  } else if (value === 0 && sections[2] !== undefined) {
    section = sections[2];
  }
  if (section.trim() === '') return '';
  const parts = lex(section);
  if (isDateSection(parts)) return formatDate(value, parts);
  return formatNumber(value, parts, negativeSign);
}
