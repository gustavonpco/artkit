import type { IdContext } from '@artkit-ai/core';
import { itemIdSchema } from '@artkit-ai/core';
import { coerceLiteral, isFormulaText, normalizeAddress } from './cells.js';
import { canonicalFormula } from './formula/rewrite.js';
import { sheetIdFor } from './operations.js';
import type { NamedFormat } from './schema.js';

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function normalizeCell(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const cell: Raw = { ...raw };
  if (cell.v === null) delete cell.v;
  for (const key of ['f', 'fmt', 's', 'note'] as const) if (cell[key] === null) delete cell[key];
  const fmt = typeof cell.fmt === 'string' ? (cell.fmt as NamedFormat) : undefined;
  if (cell.f === undefined && isFormulaText(cell.v, fmt)) {
    cell.f = cell.v;
    delete cell.v;
  }
  if (typeof cell.f === 'string') cell.f = canonicalFormula(cell.f);
  if (
    cell.f === undefined &&
    (typeof cell.v === 'string' || typeof cell.v === 'number' || typeof cell.v === 'boolean')
  ) {
    const coerced = coerceLiteral(cell.v, fmt);
    cell.v = coerced.v;
    if (coerced.fmt) cell.fmt = coerced.fmt;
  }
  return cell;
}

/**
 * Prepares raw content before validation (never throws): fills missing sheet ids deterministically from
 * the sheet name, normalizes cell keys (`b2` → `B2`), strips the leading "=" of formulas, turns "=…" text
 * values into formulas and ISO date strings into date serials.
 */
export function normalizeSheetContent(raw: unknown, ctx: IdContext): unknown {
  if (!isObject(raw) || !Array.isArray(raw.sheets)) return raw;
  const sheets = raw.sheets.map((sheet, index) => {
    if (!isObject(sheet)) return sheet;
    const next: Raw = { ...sheet };
    if (next.id === undefined || next.id === null || next.id === '') {
      const name = typeof next.name === 'string' ? next.name : `sheet${index + 1}`;
      next.id = sheetIdFor(name, ctx);
      ctx.reserveId(next.id as string);
    } else if (typeof next.id === 'string' && itemIdSchema.safeParse(next.id).success) {
      ctx.reserveId(next.id);
    }
    if (next.cells === undefined || next.cells === null) next.cells = {};
    if (isObject(next.cells)) {
      const cells: Raw = {};
      for (const [key, cell] of Object.entries(next.cells)) {
        if (cell === null) continue;
        cells[normalizeAddress(key) ?? key] = normalizeCell(cell);
      }
      next.cells = cells;
    }
    if (isObject(next.columns)) {
      next.columns = Object.fromEntries(
        Object.entries(next.columns).map(([key, value]) => [key.toUpperCase(), value]),
      );
    }
    if (Array.isArray(next.merges))
      next.merges = next.merges.map((merge) =>
        typeof merge === 'string' ? merge.replace(/\$/g, '').toUpperCase() : merge,
      );
    return next;
  });
  return { ...raw, sheets };
}
