import type { ChangeSummary } from '@artkit-ai/core';
import { formatAddress } from './a1.js';
import { orderedSheets, type WorkbookContent } from './model.js';

const CELL_CHANGE_LIMIT = 50;

function valueAt(content: WorkbookContent, sheetId: string, row: string, column: string): string | undefined {
  const cell = content.sheets[sheetId]?.cellData[row]?.[column];
  if (!cell) return undefined;
  return cell.f
    ? `=${cell.f.replace(/^=/, '')}`
    : cell.v === undefined || cell.v === null
      ? undefined
      : String(cell.v);
}

/** Changes between two workbooks: sheets added, removed or renamed, and cell changes targeted as `cell:Sheet!A1`. */
export function diffWorkbook(before: WorkbookContent, after: WorkbookContent): ChangeSummary[] {
  const changes: ChangeSummary[] = [];
  const beforeSheets = new Map(orderedSheets(before).map((sheet) => [sheet.id, sheet]));
  const afterSheets = new Map(orderedSheets(after).map((sheet) => [sheet.id, sheet]));
  for (const [id, sheet] of afterSheets) {
    if (!beforeSheets.has(id))
      changes.push({ type: 'added', target: `sheet:${sheet.name}`, summary: `aba "${sheet.name}"` });
    else if (beforeSheets.get(id)!.name !== sheet.name) {
      changes.push({
        type: 'changed',
        target: `sheet:${sheet.name}`,
        summary: `"${beforeSheets.get(id)!.name}" → "${sheet.name}"`,
      });
    }
  }
  for (const [id, sheet] of beforeSheets) {
    if (!afterSheets.has(id))
      changes.push({ type: 'removed', target: `sheet:${sheet.name}`, summary: `aba "${sheet.name}"` });
  }
  let cellChanges = 0;
  for (const [id, sheet] of afterSheets) {
    const name = sheet.name;
    const rows = new Set([
      ...Object.keys(sheet.cellData),
      ...Object.keys(beforeSheets.get(id)?.cellData ?? {}),
    ]);
    for (const row of rows) {
      const columns = new Set([
        ...Object.keys(sheet.cellData[row] ?? {}),
        ...Object.keys(beforeSheets.get(id)?.cellData[row] ?? {}),
      ]);
      for (const column of columns) {
        const previous = valueAt(before, id, row, column);
        const current = valueAt(after, id, row, column);
        if (previous === current) continue;
        cellChanges += 1;
        if (cellChanges > CELL_CHANGE_LIMIT) continue;
        const address = `${name}!${formatAddress(Number(row), Number(column))}`;
        changes.push({
          type: previous === undefined ? 'added' : current === undefined ? 'removed' : 'changed',
          target: `cell:${address}`,
          summary: `${previous ?? '∅'} → ${current ?? '∅'}`,
        });
      }
    }
  }
  if (cellChanges > CELL_CHANGE_LIMIT) {
    changes.push({
      type: 'changed',
      target: 'cells',
      summary: `${cellChanges - CELL_CHANGE_LIMIT} células a mais alteradas`,
    });
  }
  return changes;
}
