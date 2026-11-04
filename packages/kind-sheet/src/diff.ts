import { type ChangeSummary, deepEqual } from '@artkit-ai/core';
import { formatRange, parseCellKey, type Rect } from './address.js';
import { formatCellValue, resolveCurrency } from './display.js';
import { DIFF_DETAIL_LIMIT } from './operations.js';
import { type Cell, isErrorValue, type Sheet, type SheetContent } from './schema.js';

/** Recalculated (cache-only) cells listed one by one before being summarized. */
const RECALC_DETAIL_LIMIT = 20;

const M = {
  en: {
    sheetAdded: (name: string) => `Sheet "${name}" added.`,
    sheetRemoved: (name: string) => `Sheet "${name}" removed.`,
    renamed: (a: string, b: string) => `Renamed from "${a}" to "${b}".`,
    hidden: (hidden: boolean): string => (hidden ? 'Sheet hidden.' : 'Sheet shown.'),
    moved: (a: number, b: number) => `From position ${a} to position ${b}.`,
    bulk: (count: number, range: string) => `${count} cells changed in ${range}.`,
    layout: (parts: string) => `Layout changed: ${parts}.`,
    recalc: (count: number) => `${count} more formula results recalculated.`,
    set: (value: string) => `Set to ${value}.`,
    cleared: (value: string) => `Cleared (was ${value}).`,
    change: (a: string, b: string) => `${a} to ${b}.`,
    formula: (a: string, b: string) => `Formula ${a} to ${b}.`,
    format: 'Format or style changed.',
    note: 'Note changed.',
    nameAdded: (name: string, ref: string) => `Name ${name} defined as ${ref}.`,
    nameRemoved: (name: string) => `Name ${name} removed.`,
    nameChanged: (name: string, a: string, b: string) => `Name ${name}: ${a} to ${b}.`,
    settings: (parts: string) => `Settings changed: ${parts}.`,
    empty: 'empty',
  },
  pt: {
    sheetAdded: (name: string) => `Aba "${name}" adicionada.`,
    sheetRemoved: (name: string) => `Aba "${name}" removida.`,
    renamed: (a: string, b: string) => `Renomeada de "${a}" para "${b}".`,
    hidden: (hidden: boolean) => (hidden ? 'Aba ocultada.' : 'Aba reexibida.'),
    moved: (a: number, b: number) => `Da posição ${a} para a posição ${b}.`,
    bulk: (count: number, range: string) => `${count} células alteradas em ${range}.`,
    layout: (parts: string) => `Layout alterado: ${parts}.`,
    recalc: (count: number) => `Mais ${count} resultados de fórmula recalculados.`,
    set: (value: string) => `Definido como ${value}.`,
    cleared: (value: string) => `Limpo (era ${value}).`,
    change: (a: string, b: string) => `${a} para ${b}.`,
    formula: (a: string, b: string) => `Fórmula ${a} para ${b}.`,
    format: 'Formato ou estilo alterado.',
    note: 'Nota alterada.',
    nameAdded: (name: string, ref: string) => `Nome ${name} definido como ${ref}.`,
    nameRemoved: (name: string) => `Nome ${name} removido.`,
    nameChanged: (name: string, a: string, b: string) => `Nome ${name}: ${a} para ${b}.`,
    settings: (parts: string) => `Configurações alteradas: ${parts}.`,
    empty: 'vazio',
  },
};

type Messages = (typeof M)['en'];

function show(cell: Cell | undefined, options: { locale: string; currency: string }, m: Messages): string {
  if (!cell || cell.v === undefined) return m.empty;
  if (isErrorValue(cell.v)) return cell.v.error;
  // Plain spaces instead of Intl's no-break spaces keep summaries easy to read and compare.
  const text = formatCellValue(cell.v, cell.fmt, options).replace(/[\u00A0\u202F]/g, ' ');
  return typeof cell.v === 'string' ? `"${text}"` : text;
}

function sameValue(a: Cell['v'], b: Cell['v']): boolean {
  if (a === b) return true;
  return isErrorValue(a) && isErrorValue(b) && a.error === b.error;
}

/** Field-wise cell equality (faster than structural JSON comparison on large sheets). */
function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.f === b.f &&
    a.fmt === b.fmt &&
    a.note === b.note &&
    sameValue(a.v, b.v) &&
    (a.s === b.s || deepEqual(a.s, b.s))
  );
}

/** True when what a person or model wrote changed (not just the cached result of an unchanged formula). */
function inputChanged(a: Cell | undefined, b: Cell | undefined): boolean {
  if (!a || !b) return true;
  if (a.f !== b.f || a.fmt !== b.fmt || a.note !== b.note || !deepEqual(a.s, b.s)) return true;
  return a.f === undefined && !sameValue(a.v, b.v);
}

function describeCell(
  a: Cell | undefined,
  b: Cell | undefined,
  options: { locale: string; currency: string },
  m: Messages,
): string {
  if (!a) return m.set(b?.f !== undefined ? `=${b.f} → ${show(b, options, m)}` : show(b, options, m));
  if (!b) return m.cleared(a.f !== undefined ? `=${a.f}` : show(a, options, m));
  if (a.f !== b.f) {
    return m.formula(
      a.f === undefined ? show(a, options, m) : `=${a.f}`,
      b.f === undefined ? show(b, options, m) : `=${b.f} → ${show(b, options, m)}`,
    );
  }
  if (!sameValue(a.v, b.v)) return m.change(show(a, options, m), show(b, options, m));
  if (a.note !== b.note) return m.note;
  return m.format;
}

function boundingRange(keys: string[]): string {
  const rect: Rect = { top: Infinity, left: Infinity, bottom: -1, right: -1 };
  for (const key of keys) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    rect.top = Math.min(rect.top, pos.row);
    rect.left = Math.min(rect.left, pos.col);
    rect.bottom = Math.max(rect.bottom, pos.row);
    rect.right = Math.max(rect.right, pos.col);
  }
  return rect.bottom < 0 ? '' : formatRange(rect);
}

function sortKeys(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => {
    const pa = parseCellKey(a);
    const pb = parseCellKey(b);
    if (!pa || !pb) return a.localeCompare(b);
    return pa.row - pb.row || pa.col - pb.col;
  });
}

function diffCells(
  before: Sheet,
  after: Sheet,
  options: { locale: string; currency: string },
  m: Messages,
): ChangeSummary[] {
  const keys = sortKeys(new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]));
  const inputs: string[] = [];
  const cached: string[] = [];
  for (const key of keys) {
    const a = before.cells[key];
    const b = after.cells[key];
    if (sameCell(a, b)) continue;
    if (inputChanged(a, b)) inputs.push(key);
    else cached.push(key);
  }
  const changes: ChangeSummary[] = [];
  if (inputs.length > DIFF_DETAIL_LIMIT) {
    // Structural edits (inserted/deleted rows) and bulk fills are reported once for the sheet.
    changes.push({
      type: 'changed',
      target: `sheet:${after.id}`,
      summary: m.bulk(inputs.length, boundingRange(inputs)),
    });
  } else {
    for (const key of inputs) {
      const a = before.cells[key];
      const b = after.cells[key];
      changes.push({
        type: !a ? 'added' : !b ? 'removed' : 'changed',
        target: `cell:${after.id}!${key}`,
        summary: describeCell(a, b, options, m),
      });
    }
  }
  for (const key of cached.slice(0, RECALC_DETAIL_LIMIT)) {
    changes.push({
      type: 'changed',
      target: `cell:${after.id}!${key}`,
      summary: describeCell(before.cells[key], after.cells[key], options, m),
    });
  }
  if (cached.length > RECALC_DETAIL_LIMIT) {
    changes.push({
      type: 'changed',
      target: `recalc:${after.id}`,
      summary: m.recalc(cached.length - RECALC_DETAIL_LIMIT),
    });
  }
  return changes;
}

function layoutChanges(before: Sheet, after: Sheet): string[] {
  const parts: string[] = [];
  if (!deepEqual(before.columns, after.columns)) parts.push('columns');
  if (!deepEqual(before.rows, after.rows)) parts.push('rows');
  if (!deepEqual(before.frozen, after.frozen)) parts.push('frozen');
  if (!deepEqual(before.merges, after.merges)) parts.push('merges');
  if (!deepEqual(before.validations, after.validations)) parts.push('validations');
  return parts;
}

/**
 * Structural diff (spec §8.6). Targets: `sheet:<id>`, `layout:<id>`, `cell:<sheetId>!A1`, `name:<NAME>`,
 * `settings`. Values are formatted with the locale, e.g. "R$ 159.810,00 para R$ 162.910,00.".
 */
export function diffSheetContent(before: SheetContent, after: SheetContent, locale: string): ChangeSummary[] {
  const m = locale.toLowerCase().startsWith('pt') ? M.pt : M.en;
  const options = { locale, currency: resolveCurrency(after, locale) };
  const changes: ChangeSummary[] = [];
  const beforeById = new Map(before.sheets.map((sheet, index) => [sheet.id, { sheet, index }]));
  const afterIds = new Set(after.sheets.map((sheet) => sheet.id));
  for (const sheet of before.sheets) {
    if (!afterIds.has(sheet.id))
      changes.push({ type: 'removed', target: `sheet:${sheet.id}`, summary: m.sheetRemoved(sheet.name) });
  }
  const commonBefore = before.sheets.filter((sheet) => afterIds.has(sheet.id)).map((sheet) => sheet.id);
  const commonAfter = after.sheets.filter((sheet) => beforeById.has(sheet.id)).map((sheet) => sheet.id);
  after.sheets.forEach((sheet, index) => {
    const previous = beforeById.get(sheet.id);
    if (!previous) {
      changes.push({ type: 'added', target: `sheet:${sheet.id}`, summary: m.sheetAdded(sheet.name) });
      return;
    }
    const old = previous.sheet;
    if (old.name !== sheet.name)
      changes.push({
        type: 'changed',
        target: `sheet:${sheet.id}`,
        summary: m.renamed(old.name, sheet.name),
      });
    if (Boolean(old.hidden) !== Boolean(sheet.hidden))
      changes.push({
        type: 'changed',
        target: `sheet:${sheet.id}`,
        summary: m.hidden(Boolean(sheet.hidden)),
      });
    if (commonBefore.indexOf(sheet.id) !== commonAfter.indexOf(sheet.id) && previous.index !== index) {
      changes.push({
        type: 'moved',
        target: `sheet:${sheet.id}`,
        summary: m.moved(previous.index + 1, index + 1),
      });
    }
    const layout = layoutChanges(old, sheet);
    if (layout.length > 0)
      changes.push({ type: 'changed', target: `layout:${sheet.id}`, summary: m.layout(layout.join(', ')) });
    changes.push(...diffCells(old, sheet, options, m));
  });

  const names = (content: SheetContent) =>
    new Map((content.names ?? []).map((name) => [name.name.toUpperCase(), name]));
  const beforeNames = names(before);
  const afterNames = names(after);
  for (const [key, name] of beforeNames) {
    if (!afterNames.has(key))
      changes.push({ type: 'removed', target: `name:${key}`, summary: m.nameRemoved(name.name) });
  }
  for (const [key, name] of afterNames) {
    const old = beforeNames.get(key);
    if (!old)
      changes.push({ type: 'added', target: `name:${key}`, summary: m.nameAdded(name.name, name.ref) });
    else if (old.ref !== name.ref || old.name !== name.name)
      changes.push({
        type: 'changed',
        target: `name:${key}`,
        summary: m.nameChanged(name.name, old.ref, name.ref),
      });
  }
  if (!deepEqual(before.settings, after.settings)) {
    const keys = new Set([...Object.keys(before.settings ?? {}), ...Object.keys(after.settings ?? {})]);
    const parts = [...keys]
      .filter((key) => !deepEqual(before.settings?.[key as 'currency'], after.settings?.[key as 'currency']))
      .map(
        (key) =>
          `${key} ${before.settings?.[key as 'currency'] ?? m.empty} → ${after.settings?.[key as 'currency'] ?? m.empty}`,
      );
    changes.push({ type: 'changed', target: 'settings', summary: m.settings(parts.join(', ')) });
  }
  return changes;
}
