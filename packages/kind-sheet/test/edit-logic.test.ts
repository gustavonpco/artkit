import { describe, expect, it } from 'vitest';
import {
  acceptsReference,
  addRange,
  advance,
  applySuggestion,
  borderOps,
  cellEditText,
  cellPatchFromText,
  copyBlock,
  deleteRowsOp,
  editingKey,
  enclosingFunction,
  fillTarget,
  functionPrefixAt,
  insertColumnsOp,
  insertReference,
  jumpBy,
  moveBy,
  navigationKey,
  nextSheetName,
  operationRanges,
  parseHtmlTable,
  parseTsv,
  pastePatches,
  referenceText,
  selectColumns,
  selectRows,
  selectTo,
  singleSelection,
  suggestFunctions,
  toTsv,
} from '../src/edit/index.js';
import { serialFromIso } from '../src/index.js';
import type { Sheet } from '../src/schema.js';

const key = (
  k: string,
  extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe('selection model', () => {
  it('moves, extends and adds ranges', () => {
    let sel = singleSelection({ row: 2, col: 2 });
    sel = moveBy(sel, 1, 0, false);
    expect(sel.active).toEqual({ row: 3, col: 2 });
    sel = moveBy(sel, 1, 1, true);
    expect(sel.ranges).toEqual([{ top: 3, left: 2, bottom: 4, right: 3 }]);
    expect(sel.active).toEqual({ row: 3, col: 2 });
    sel = moveBy(singleSelection({ row: 0, col: 0 }), -1, -1, false);
    expect(sel.active).toEqual({ row: 0, col: 0 });
    sel = addRange(selectTo(singleSelection({ row: 0, col: 0 }), { row: 1, col: 1 }, true), {
      row: 5,
      col: 5,
    });
    expect(sel.ranges).toHaveLength(2);
    expect(sel.active).toEqual({ row: 5, col: 5 });
  });

  it('jumps to data edges with Ctrl+arrows', () => {
    const data = new Set(['0:0', '1:0', '2:0', '6:0']);
    const filled = (row: number, col: number) => data.has(`${row}:${col}`);
    const bounds = { maxRow: 9, maxCol: 9 };
    let sel = jumpBy(singleSelection({ row: 0, col: 0 }), 1, 0, false, filled, bounds);
    expect(sel.active.row).toBe(2);
    sel = jumpBy(sel, 1, 0, false, filled, bounds);
    expect(sel.active.row).toBe(6);
    sel = jumpBy(sel, 1, 0, false, filled, bounds);
    expect(sel.active.row).toBe(9);
    expect(jumpBy(singleSelection({ row: 0, col: 0 }), 1, 0, true, filled, bounds).ranges[0]).toEqual({
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
    });
  });

  it('selects whole rows and columns and advances inside ranges', () => {
    expect(selectRows(singleSelection({ row: 0, col: 0 }), 3, false).ranges[0]).toMatchObject({
      top: 3,
      bottom: 3,
      left: 0,
    });
    expect(
      selectColumns(selectColumns(singleSelection({ row: 0, col: 0 }), 1, false), 3, true).ranges[0],
    ).toMatchObject({ left: 1, right: 3, top: 0 });
    let sel = selectTo(singleSelection({ row: 0, col: 0 }), { row: 1, col: 1 }, true);
    sel = advance(sel, 'down');
    expect(sel.active).toEqual({ row: 1, col: 0 });
    sel = advance(sel, 'down');
    expect(sel.active).toEqual({ row: 0, col: 1 });
    expect(advance(singleSelection({ row: 0, col: 0 }), 'right').active).toEqual({ row: 0, col: 1 });
  });
});

describe('keys', () => {
  it('maps navigation keys', () => {
    expect(navigationKey(key('ArrowDown', { shiftKey: true }))).toEqual({
      type: 'move',
      dRow: 1,
      dCol: 0,
      extend: true,
    });
    expect(navigationKey(key('ArrowRight', { ctrlKey: true }))).toEqual({
      type: 'jump',
      dRow: 0,
      dCol: 1,
      extend: false,
    });
    expect(navigationKey(key('Enter'))).toEqual({ type: 'advance', direction: 'down' });
    expect(navigationKey(key('Tab', { shiftKey: true }))).toEqual({ type: 'advance', direction: 'left' });
    expect(navigationKey(key('F2'))).toEqual({ type: 'edit' });
    expect(navigationKey(key('Delete'))).toEqual({ type: 'clear' });
    expect(navigationKey(key('b', { metaKey: true }))).toEqual({ type: 'toggle', style: 'bold' });
    expect(navigationKey(key('='))).toEqual({ type: 'type', text: '=' });
    expect(navigationKey(key('ArrowDown', { altKey: true }))).toEqual({ type: 'dropdown' });
    expect(navigationKey(key('c', { ctrlKey: true }))).toBeUndefined();
  });

  it('maps editing keys', () => {
    expect(editingKey(key('Enter'))).toEqual({ type: 'commit', direction: 'down' });
    expect(editingKey(key('Tab'))).toEqual({ type: 'commit', direction: 'right' });
    expect(editingKey(key('Escape'))).toEqual({ type: 'cancel' });
    expect(editingKey(key('a'))).toBeUndefined();
  });
});

describe('clipboard', () => {
  it('parses and writes TSV with quoted fields', () => {
    expect(parseTsv('a\tb\n"x\ty"\t"line1\nline2"\n')).toEqual([
      ['a', 'b'],
      ['x\ty', 'line1\nline2'],
    ]);
    expect(toTsv([['a\tb', 'c']])).toBe('"a\tb"\tc');
  });

  it('parses HTML tables without a DOM', () => {
    const html =
      '<html><body><table><tr><th>Name</th><th colspan="2">Value &amp; more</th></tr><tr><td>A<br>B</td><td> 1,5 </td><td>&#x41;</td></tr></table></body></html>';
    expect(parseHtmlTable(html)).toEqual([
      ['Name', 'Value & more', ''],
      ['A\nB', '1,5', 'A'],
    ]);
    expect(parseHtmlTable('<p>no table</p>')).toBeUndefined();
  });

  it('pastes text typed by locale and internal cells with shifted formulas', () => {
    expect(
      pastePatches(
        [
          ['1.234,5', '15%'],
          ['=A1*2', ''],
        ],
        { row: 2, col: 1 },
        'pt-BR',
      ),
    ).toEqual({
      B3: { v: 1234.5 },
      C3: { v: 0.15, fmt: 'percent' },
      B4: { f: 'A1*2' },
      C4: { v: null, f: null },
    });
    const sheet: Sheet = {
      id: 's',
      name: 'S',
      cells: { A1: { v: 2 }, B1: { f: 'A1*$A$1', fmt: 'integer', v: 4 } },
    };
    const block = copyBlock(
      sheet,
      { top: 0, left: 0, bottom: 0, right: 1 },
      { locale: 'en', currency: 'USD' },
    );
    expect(block.text).toBe('2\t4');
    expect(pastePatches(block.payload, { row: 4, col: 2 }, 'en')).toEqual({
      C5: { fmt: null, s: null, note: null, v: 2 },
      D5: { fmt: 'integer', s: null, note: null, f: 'C5*$A$1' },
    });
    expect(
      Object.keys(pastePatches([['x']], { row: 0, col: 0 }, 'en', { top: 0, left: 0, bottom: 1, right: 1 })),
    ).toEqual(['A1', 'B1', 'A2', 'B2']);
  });
});

describe('input', () => {
  it('turns typed text into patches', () => {
    expect(cellPatchFromText('=sum(A1:A2)', 'en')).toEqual({ f: 'sum(A1:A2)' });
    expect(cellPatchFromText('1,234.5', 'en-US')).toEqual({ v: 1234.5 });
    expect(cellPatchFromText('09/11/2026', 'pt-BR')).toEqual({ v: serialFromIso('2026-11-09'), fmt: 'date' });
    expect(cellPatchFromText('11/09/2026', 'en-US')).toEqual({ v: serialFromIso('2026-11-09'), fmt: 'date' });
    expect(cellPatchFromText('R$ 10,50', 'pt-BR')).toEqual({ v: 10.5, fmt: 'currency' });
    expect(cellPatchFromText('VERDADEIRO', 'pt-BR')).toEqual({ v: true });
    expect(cellPatchFromText('00123', 'en')).toEqual({ v: '00123' });
    expect(cellPatchFromText('', 'en')).toEqual({ v: null, f: null });
    expect(cellPatchFromText('15%', 'en', { v: 0.1, fmt: 'percent' })).toEqual({ v: 0.15 });
    expect(cellPatchFromText('123', 'en', { fmt: 'text' })).toEqual({ v: '123' });
  });

  it('shows cells for editing in the locale', () => {
    expect(cellEditText({ f: 'A1+1', v: 2 }, 'en')).toBe('=A1+1');
    expect(cellEditText({ v: 1234.5 }, 'pt-BR')).toBe('1234,5');
    expect(cellEditText({ v: 0.155, fmt: 'percent' }, 'en')).toBe('15.5%');
    expect(cellEditText({ v: serialFromIso('2026-11-09')!, fmt: 'date' }, 'pt-BR')).toBe('09/11/2026');
    expect(cellEditText({ v: true }, 'pt-BR')).toBe('VERDADEIRO');
  });
});

describe('formula editing', () => {
  it('suggests supported functions with signatures', () => {
    expect(functionPrefixAt('=SU', 3)).toEqual({ start: 1, prefix: 'SU' });
    expect(functionPrefixAt('=A1', 3)).toBeUndefined();
    expect(functionPrefixAt('="su', 4)).toBeUndefined();
    expect(suggestFunctions('sum').map((spec) => spec.name)).toEqual(['SUM', 'SUMIF', 'SUMIFS']);
    expect(suggestFunctions('WEBS')).toEqual([]);
    expect(applySuggestion('=1+su', 5, 'SUMIF')).toEqual({ text: '=1+SUMIF(', caret: 9 });
    expect(enclosingFunction('=SUMIF(A1:A3,', 13)?.signature).toBe('SUMIF(range, criteria, [sum_range])');
    expect(enclosingFunction('=SUM(1)+', 8)).toBeUndefined();
  });

  it('inserts references in point mode', () => {
    expect(acceptsReference('=SUM(', 5)).toBe(true);
    expect(acceptsReference('=A1', 3)).toBe(false);
    expect(acceptsReference('hello', 5)).toBe(false);
    const first = insertReference('=SUM(', 5, 'A1');
    expect(first).toEqual({ text: '=SUM(A1', caret: 7, span: { start: 5, end: 7 } });
    expect(insertReference(first.text, first.caret, 'A1:B3', first.span).text).toBe('=SUM(A1:B3');
    expect(referenceText({ top: 0, left: 0, bottom: 2, right: 1 }, 'Estimativa 2', 'Resumo')).toBe(
      "'Estimativa 2'!A1:B3",
    );
  });
});

describe('operation builders', () => {
  const sheet: Sheet = {
    id: 's',
    name: 'S',
    cells: { A1: { v: 1 }, C5: { v: 2, s: { border: { top: 'thin' } } } },
  };

  it('limits whole-column ranges to the used area', () => {
    expect(operationRanges(sheet, [{ top: 0, left: 1, bottom: 99_999, right: 1 }])).toEqual(['B1:B5']);
  });

  it('builds borders, structural ops and fill targets', () => {
    expect(borderOps(sheet, [{ top: 3, left: 1, bottom: 4, right: 2 }], 'outer')).toEqual([
      {
        op: 'set_cells',
        sheet: 's',
        cells: {
          B4: { s: { border: { top: 'thin', left: 'thin' } } },
          C4: { s: { border: { top: 'thin', right: 'thin' } } },
          B5: { s: { border: { bottom: 'thin', left: 'thin' } } },
          C5: { s: { border: { top: 'thin', bottom: 'thin', right: 'thin' } } },
        },
      },
    ]);
    expect(borderOps(sheet, [{ top: 0, left: 0, bottom: 0, right: 0 }], 'none')).toEqual([
      { op: 'set_range_style', sheet: 's', range: 'A1', style: { border: null } },
    ]);
    expect(deleteRowsOp(sheet, { top: 2, left: 0, bottom: 99_999, right: 3 })).toEqual({
      op: 'delete_rows',
      sheet: 's',
      at: 3,
      count: 3,
    });
    expect(insertColumnsOp(sheet, { top: 0, left: 2, bottom: 0, right: 3 }, 'left')).toEqual({
      op: 'insert_columns',
      sheet: 's',
      at: 'C',
      count: 2,
    });
    expect(fillTarget({ top: 1, left: 1, bottom: 1, right: 1 }, 6, 2)).toEqual({
      top: 1,
      left: 1,
      bottom: 6,
      right: 1,
    });
    expect(fillTarget({ top: 1, left: 1, bottom: 1, right: 1 }, 2, 6)).toEqual({
      top: 1,
      left: 1,
      bottom: 1,
      right: 6,
    });
    expect(nextSheetName(['Sheet1', 'Sheet2'], 'Sheet')).toBe('Sheet3');
  });
});
