import { InsertColCommand, InsertRowCommand, RemoveColCommand, RemoveRowCommand } from '@univerjs/sheets';
import { formatAddress, indexToColumn } from '../a1.js';
import { orderedSheets, type SheetData, type WorkbookContent } from '../model.js';
import type { SheetOperation } from '../operations.js';

/**
 * Maps what the grid editor did to the operations of the sheet format (spec §11.4, §14.3). The Univer UI produces
 * commands; structural commands (rows and columns) carry positions and become operations directly, while cell, style
 * and sheet changes are read by comparing the grid with the base the operations are relative to.
 */

/** Univer commands of the structural mutations, taken from `@univerjs/sheets` so the ids cannot drift. */
export const STRUCTURAL_COMMANDS = {
  insertRow: InsertRowCommand.id,
  removeRow: RemoveRowCommand.id,
  insertCol: InsertColCommand.id,
  removeCol: RemoveColCommand.id,
} as const;

export interface GridRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

const FORMAT_BY_PATTERN: [RegExp, 'integer' | 'decimal' | 'percent' | 'currency' | 'date' | 'text'][] = [
  [/^@$/, 'text'],
  [/%/, 'percent'],
  [/"R\$"|"\$"/, 'currency'],
  [/^#,##0\.00$/, 'decimal'],
  [/^#,##0$/, 'integer'],
  [/^(dd\/mm\/yyyy|yyyy-mm-dd)$/, 'date'],
];

/** Named format of a Univer number pattern, or undefined when the pattern has no named equivalent. */
export function formatOfPattern(
  pattern: string | undefined,
): 'integer' | 'decimal' | 'percent' | 'currency' | 'date' | 'text' | undefined {
  if (!pattern) return undefined;
  return FORMAT_BY_PATTERN.find(([test]) => test.test(pattern))?.[1];
}

interface CellView {
  value: string | number | boolean | null;
  bold: boolean;
  italic: boolean;
  align?: 'left' | 'center' | 'right';
  wrap: boolean;
  pattern?: string;
}

function resolveStyle(workbook: WorkbookContent, cell: { s?: unknown } | undefined): Record<string, unknown> {
  if (!cell?.s) return {};
  const raw = typeof cell.s === 'string' ? workbook.styles[cell.s] : cell.s;
  return (raw as Record<string, unknown> | undefined) ?? {};
}

function viewOf(
  workbook: WorkbookContent,
  cell: { v?: unknown; f?: string; s?: unknown } | undefined,
): CellView {
  const style = resolveStyle(workbook, cell);
  const align = style.ht === 2 ? 'center' : style.ht === 3 ? 'right' : style.ht === 1 ? 'left' : undefined;
  const pattern = (style.n as { pattern?: string } | undefined)?.pattern;
  let value: string | number | boolean | null = null;
  if (cell?.f) value = `=${cell.f.replace(/^=/, '')}`;
  else if (cell?.v !== undefined && cell?.v !== null) value = cell.v as string | number | boolean;
  return {
    value,
    bold: style.bl === 1,
    italic: style.it === 1,
    ...(align ? { align } : {}),
    wrap: style.tb === 3,
    ...(pattern ? { pattern } : {}),
  };
}

function a1(row: number, column: number): string {
  return formatAddress(row, column);
}

/** Operation for a structural command, from its parameters (undefined for commands that are not structural). */
export function structuralOperation(
  commandId: string,
  params: { subUnitId?: string; range?: GridRange; direction?: number } | undefined,
  base: WorkbookContent,
): SheetOperation | undefined {
  const range = params?.range;
  const sheet = params?.subUnitId ? base.sheets[params.subUnitId] : undefined;
  if (!range || !sheet) return undefined;
  const name = sheet.name;
  const rows = range.endRow - range.startRow + 1;
  const columns = range.endColumn - range.startColumn + 1;
  switch (commandId) {
    case STRUCTURAL_COMMANDS.insertRow:
      return { op: 'insert_rows', sheet: name, at: range.startRow + 1, count: rows };
    case STRUCTURAL_COMMANDS.removeRow:
      return { op: 'delete_rows', sheet: name, from: range.startRow + 1, count: rows };
    case STRUCTURAL_COMMANDS.insertCol:
      return { op: 'insert_columns', sheet: name, at: indexToColumn(range.startColumn), count: columns };
    case STRUCTURAL_COMMANDS.removeCol:
      return { op: 'delete_columns', sheet: name, from: indexToColumn(range.startColumn), count: columns };
    default:
      return undefined;
  }
}

/** The base after a structural operation: cells move the way the sheet operation moves them. */
export function applyStructural(base: WorkbookContent, op: SheetOperation): WorkbookContent {
  const next = structuredClone(base);
  const sheet = orderedSheets(next).find(
    (candidate) => candidate.name === ('sheet' in op ? op.sheet : undefined),
  );
  if (!sheet) return next;
  const shift = (
    cells: SheetData['cellData'],
    mapRow: (row: number) => number | undefined,
    mapColumn: (column: number) => number | undefined,
  ) => {
    const moved: SheetData['cellData'] = {};
    for (const [row, line] of Object.entries(cells)) {
      for (const [column, cell] of Object.entries(line)) {
        const r = mapRow(Number(row));
        const c = mapColumn(Number(column));
        if (r === undefined || c === undefined) continue;
        moved[String(r)] ??= {};
        moved[String(r)]![String(c)] = cell;
      }
    }
    return moved;
  };
  if (op.op === 'insert_rows') {
    const at = op.at - 1;
    sheet.cellData = shift(
      sheet.cellData,
      (r) => (r >= at ? r + op.count : r),
      (c) => c,
    );
  } else if (op.op === 'delete_rows') {
    const from = op.from - 1;
    sheet.cellData = shift(
      sheet.cellData,
      (r) => (r < from ? r : r >= from + op.count ? r - op.count : undefined),
      (c) => c,
    );
  } else if (op.op === 'insert_columns' || op.op === 'delete_columns') {
    const at = op.op === 'insert_columns' ? columnIndex(op.at) : columnIndex(op.from);
    const count = op.count;
    sheet.cellData = shift(
      sheet.cellData,
      (r) => r,
      op.op === 'insert_columns'
        ? (c) => (c >= at ? c + count : c)
        : (c) => (c < at ? c : c >= at + count ? c - count : undefined),
    );
  }
  return next;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** Operations that turn `base` into `live`, for cells, styles and sheets. Structural changes are not inferred here. */
export function operationsBetween(base: WorkbookContent, live: WorkbookContent): SheetOperation[] {
  const before = new Map(orderedSheets(base).map((sheet) => [sheet.id, sheet]));
  const after = new Map(orderedSheets(live).map((sheet) => [sheet.id, sheet]));
  const removed: SheetOperation[] = [];
  const added: SheetOperation[] = [];
  const renamed: SheetOperation[] = [];
  for (const [id, sheet] of before) {
    if (!after.has(id)) removed.push({ op: 'remove_sheet', sheet: sheet.name });
  }
  for (const [id, sheet] of after) {
    if (!before.has(id)) added.push({ op: 'add_sheet', name: sheet.name });
    else if (before.get(id)!.name !== sheet.name)
      renamed.push({ op: 'rename_sheet', sheet: before.get(id)!.name, name: sheet.name });
  }
  const cells: SheetOperation[] = [];
  const styles: SheetOperation[] = [];
  for (const [id, sheet] of after) {
    const previous = before.get(id);
    const rows = new Set(
      [...Object.keys(sheet.cellData), ...Object.keys(previous?.cellData ?? {})].map(Number),
    );
    const changedValues = new Map<number, Map<number, string | number | boolean | null>>();
    for (const row of [...rows].sort((a, b) => a - b)) {
      const columns = new Set(
        [
          ...Object.keys(sheet.cellData[String(row)] ?? {}),
          ...Object.keys(previous?.cellData[String(row)] ?? {}),
        ].map(Number),
      );
      for (const column of [...columns].sort((a, b) => a - b)) {
        const now = viewOf(live, sheet.cellData[String(row)]?.[String(column)]);
        const was = previous ? viewOf(base, previous.cellData[String(row)]?.[String(column)]) : undefined;
        if (!was || now.value !== was.value) {
          if (!(was === undefined && now.value === null)) {
            changedValues.set(row, (changedValues.get(row) ?? new Map()).set(column, now.value));
          }
        }
        if (
          was &&
          (now.bold !== was.bold ||
            now.italic !== was.italic ||
            now.align !== was.align ||
            now.wrap !== was.wrap)
        ) {
          styles.push({
            op: 'set_style',
            sheet: sheet.name,
            range: a1(row, column),
            bold: now.bold,
            italic: now.italic,
            ...(now.align ? { align: now.align } : {}),
            wrap: now.wrap,
          });
        }
        if (now.pattern !== was?.pattern && formatOfPattern(now.pattern)) {
          styles.push({
            op: 'set_format',
            sheet: sheet.name,
            range: a1(row, column),
            format: formatOfPattern(now.pattern)!,
          });
        }
      }
    }
    // Contiguous runs of changed cells in one row become one set_values, keeping the batch small.
    for (const [row, line] of [...changedValues].sort((a, b) => a[0] - b[0])) {
      const columns = [...line.keys()].sort((a, b) => a - b);
      let start = columns[0]!;
      let run: (string | number | boolean | null)[] = [];
      let previousColumn = start - 1;
      const flush = () => {
        if (run.length > 0)
          cells.push({ op: 'set_values', sheet: sheet.name, at: a1(row, start), values: [run] });
        run = [];
      };
      for (const column of columns) {
        if (column !== previousColumn + 1) {
          flush();
          start = column;
        }
        run.push(line.get(column) ?? null);
        previousColumn = column;
      }
      flush();
    }
  }
  return [...removed, ...added, ...renamed, ...cells, ...styles];
}
