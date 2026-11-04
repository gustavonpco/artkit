import { MAX_COLS, MAX_ROWS, parseCellKey, type Rect } from '../address.js';
import type { Cell, DefinedName, SheetContent } from '../schema.js';
import { isErrorValue } from '../schema.js';
import { serialFromIso } from './dates.js';
import type { RefToken } from './tokenizer.js';
import { FormulaError, type Scalar } from './values.js';

export const cellIndex = (row: number, col: number) => row * MAX_COLS + col;

export interface SheetIndex {
  id: string;
  name: string;
  position: number;
  /** Cells keyed by `cellIndex(row, col)`. */
  cells: Map<number, Cell>;
  /** Last used row and column (zero-based), -1 when the sheet is empty. */
  maxRow: number;
  maxCol: number;
}

/** Read-only index of a workbook used by evaluation, validation and the dependency graph. */
export class WorkbookIndex {
  readonly sheets: SheetIndex[];
  readonly #byName = new Map<string, SheetIndex>();
  readonly #byId = new Map<string, SheetIndex>();
  readonly #names = new Map<string, DefinedName>();
  /** Serial of `settings.calculationDate`, used by TODAY(). */
  readonly calculationDate: number | undefined;

  constructor(readonly content: SheetContent) {
    this.sheets = content.sheets.map((sheet, position) => {
      const cells = new Map<number, Cell>();
      let maxRow = -1;
      let maxCol = -1;
      for (const [key, cell] of Object.entries(sheet.cells ?? {})) {
        const pos = parseCellKey(key);
        if (!pos) continue;
        cells.set(cellIndex(pos.row, pos.col), cell);
        if (pos.row > maxRow) maxRow = pos.row;
        if (pos.col > maxCol) maxCol = pos.col;
      }
      return { id: sheet.id, name: sheet.name, position, cells, maxRow, maxCol };
    });
    for (const sheet of this.sheets) {
      this.#byName.set(sheet.name.toUpperCase(), sheet);
      this.#byId.set(sheet.id, sheet);
    }
    for (const name of content.names ?? []) this.#names.set(name.name.toUpperCase(), name);
    const date = content.settings?.calculationDate;
    this.calculationDate = date ? serialFromIso(date) : undefined;
  }

  sheetByName(name: string): SheetIndex | undefined {
    return this.#byName.get(name.toUpperCase());
  }

  sheetById(id: string): SheetIndex | undefined {
    return this.#byId.get(id);
  }

  definedName(name: string): DefinedName | undefined {
    return this.#names.get(name.toUpperCase());
  }
}

/** Converts a stored cell value into an evaluation scalar. */
export function cellScalar(cell: Cell | undefined): Scalar {
  const value = cell?.v;
  if (value === undefined) return null;
  if (isErrorValue(value)) return FormulaError.of(value.error);
  return value;
}

/** Rectangle covered by a reference token; whole columns/rows span the addressable grid. */
export function refRect(ref: RefToken): Rect {
  const top = ref.kind === 'cols' ? 0 : Math.min(ref.a.row!, ref.b.row!);
  const bottom = ref.kind === 'cols' ? MAX_ROWS - 1 : Math.max(ref.a.row!, ref.b.row!);
  const left = ref.kind === 'rows' ? 0 : Math.min(ref.a.col!, ref.b.col!);
  const right = ref.kind === 'rows' ? MAX_COLS - 1 : Math.max(ref.a.col!, ref.b.col!);
  return { top, left, bottom, right };
}
