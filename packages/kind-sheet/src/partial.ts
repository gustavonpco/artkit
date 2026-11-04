import { IdAllocator, itemIdSchema } from '@artkit-ai/core';
import { parseRange } from './address.js';
import type { FormulaEngine } from './formula/engine.js';
import { normalizeSheetContent } from './normalize.js';
import { recalculateContent } from './recalc.js';
import {
  cellSchema,
  type SheetContent,
  sheetContentSchema,
  sheetNameSchema,
  validationSchema,
} from './schema.js';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Streaming preview (spec §13.4): keeps every complete sheet and cell of a partially parsed object and drops
 * incomplete ones (a sheet without a name, a cell that does not match the schema). Formulas are
 * recalculated so the preview shows values. Returns undefined when nothing usable is there yet.
 */
export function parsePartialSheet(raw: unknown, engine: FormulaEngine): SheetContent | undefined {
  if (!isObject(raw) || !Array.isArray(raw.sheets)) return undefined;
  const complete = sheetContentSchema.safeParse(raw);
  let content: SheetContent;
  if (complete.success) content = structuredClone(complete.data);
  else {
    const explicit = raw.sheets.flatMap((sheet) =>
      isObject(sheet) && typeof sheet.id === 'string' ? [sheet.id] : [],
    );
    const allocator = new IdAllocator(explicit);
    const sheets = raw.sheets.flatMap((sheet) => {
      if (!isObject(sheet) || !sheetNameSchema.safeParse(sheet.name).success) return [];
      const cells: Record<string, unknown> = {};
      if (isObject(sheet.cells))
        for (const [key, cell] of Object.entries(sheet.cells))
          if (cellSchema.safeParse(cell).success) cells[key] = cell;
      const id =
        typeof sheet.id === 'string' && itemIdSchema.safeParse(sheet.id).success ? sheet.id : undefined;
      return [
        {
          ...(id ? { id } : {}),
          name: sheet.name,
          cells,
          ...(isObject(sheet.columns) ? { columns: sheet.columns } : {}),
          ...(isObject(sheet.rows) ? { rows: sheet.rows } : {}),
          ...(isObject(sheet.frozen) ? { frozen: sheet.frozen } : {}),
          ...(Array.isArray(sheet.merges)
            ? { merges: sheet.merges.filter((merge) => typeof merge === 'string' && parseRange(merge)) }
            : {}),
          ...(Array.isArray(sheet.validations)
            ? { validations: sheet.validations.filter((v) => validationSchema.safeParse(v).success) }
            : {}),
          ...(sheet.hidden === true ? { hidden: true } : {}),
        },
      ];
    });
    if (sheets.length === 0) return undefined;
    const normalized = normalizeSheetContent(
      {
        sheets,
        ...(Array.isArray(raw.names) ? { names: raw.names } : {}),
        ...(isObject(raw.settings) ? { settings: raw.settings } : {}),
      },
      {
        nextId: (prefix) => allocator.next(prefix),
        hasId: (id) => allocator.has(id),
        reserveId: (id) => allocator.reserve(id),
      },
    );
    let parsed = sheetContentSchema.safeParse(normalized);
    if (!parsed.success)
      parsed = sheetContentSchema.safeParse({ sheets: (normalized as { sheets: unknown[] }).sheets });
    if (!parsed.success) return undefined;
    content = parsed.data;
  }
  try {
    recalculateContent(content, engine);
  } catch {
    // A preview never fails: values stay as streamed.
  }
  return content;
}
