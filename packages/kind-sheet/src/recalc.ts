import type { CellRef, FormulaEngine } from './formula/engine.js';
import type { SheetContent } from './schema.js';

/** Writes the engine's results into the cells (the derived step of the pipeline, spec §8.2 step 7). */
export function recalculateContent(content: SheetContent, engine: FormulaEngine, changed?: CellRef[]): void {
  const refs: CellRef[] =
    changed ??
    content.sheets.flatMap((sheet) =>
      Object.entries(sheet.cells)
        .filter(([, cell]) => cell.f !== undefined)
        .map(([address]) => ({ sheetId: sheet.id, address })),
    );
  if (refs.length === 0) return;
  for (const update of engine.recalculate(content, refs)) {
    const cell = content.sheets.find((sheet) => sheet.id === update.sheetId)?.cells[update.address];
    if (cell && cell.f !== undefined) cell.v = update.value;
  }
}
