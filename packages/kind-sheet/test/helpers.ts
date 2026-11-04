import { recalculateAll } from '../src/formula/index.js';
import type { Cell, SheetContent } from '../src/schema.js';

type Input = Record<string, string | number | boolean | Cell>;

/** Builds a workbook from compact cell maps; strings starting with "=" become formulas. Recalculates. */
export function book(sheets: Record<string, Input>, extra: Partial<SheetContent> = {}): SheetContent {
  const content: SheetContent = {
    sheets: Object.entries(sheets).map(([name, cells], index) => ({
      id: `s${index + 1}`,
      name,
      cells: Object.fromEntries(
        Object.entries(cells).map(([key, value]) => {
          if (typeof value === 'object') return [key, value];
          if (typeof value === 'string' && value.startsWith('=')) return [key, { f: value.slice(1) }];
          return [key, { v: value }];
        }),
      ),
    })),
    ...extra,
  };
  for (const update of recalculateAll(content)) {
    const sheet = content.sheets.find((s) => s.id === update.sheetId)!;
    sheet.cells[update.address]!.v = update.value;
  }
  return content;
}

/** Evaluates one formula against the given cells of a single sheet. */
export function calc(formula: string, cells: Input = {}, extra: Partial<SheetContent> = {}): unknown {
  const content = book({ Sheet1: { ...cells, ZZ1000: `=${formula}` } }, extra);
  return content.sheets[0]!.cells.ZZ1000!.v;
}
