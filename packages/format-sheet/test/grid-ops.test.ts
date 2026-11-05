// @vitest-environment node

import { applyOperations, createRegistry } from '@artkit-ai/core';
import { InsertRowCommand, RemoveRowCommand } from '@univerjs/sheets';
import { describe, expect, it } from 'vitest';
import { createSheetFormat, emptyWorkbook, type WorkbookContent } from '../src/index.js';
import {
  applyStructural,
  formatOfPattern,
  operationsBetween,
  STRUCTURAL_COMMANDS,
  structuralOperation,
} from '../src/react/operations-from-grid.js';
import { createUniverEngine } from '../src/server/engine.js';

const base: WorkbookContent = {
  ...emptyWorkbook('wb', 'Estimativa', 'pt-BR'),
  sheetOrder: ['est'],
  sheets: {
    est: {
      id: 'est',
      name: 'Estimativa',
      rowCount: 20,
      columnCount: 6,
      cellData: {
        '0': { '0': { v: 'Perfil' }, '1': { v: 'Horas' } },
        '1': { '0': { v: 'Tech Lead' }, '1': { v: 120 } },
        '2': { '0': { v: 'Dev' }, '1': { v: 80 } },
      },
    },
  },
  styles: {},
};

function clone(content: WorkbookContent): WorkbookContent {
  return structuredClone(content);
}

describe('grid changes to sheet operations', () => {
  it('turns an edited cell into one set_values', () => {
    const live = clone(base);
    live.sheets.est!.cellData['1']!['1'] = { v: 130 };
    expect(operationsBetween(base, live)).toEqual([
      { op: 'set_values', sheet: 'Estimativa', at: 'B2', values: [[130]] },
    ]);
  });

  it('groups contiguous changed cells of a row into one operation', () => {
    const live = clone(base);
    live.sheets.est!.cellData['2']!['2'] = { f: '=B3*165' };
    live.sheets.est!.cellData['2']!['3'] = { v: 'x' };
    expect(operationsBetween(base, live)).toEqual([
      { op: 'set_values', sheet: 'Estimativa', at: 'C3', values: [['=B3*165', 'x']] },
    ]);
  });

  it('reports added and renamed sheets, and removed ones last', () => {
    const live = clone(base);
    live.sheets.est!.name = 'Resumo';
    live.sheets.nova = { id: 'nova', name: 'Premissas', rowCount: 10, columnCount: 5, cellData: {} };
    live.sheetOrder.push('nova');
    const ops = operationsBetween(base, live);
    expect(ops).toEqual([
      { op: 'add_sheet', name: 'Premissas' },
      { op: 'rename_sheet', sheet: 'Estimativa', name: 'Resumo' },
    ]);
  });

  it('marks bold and alignment changes as set_style', () => {
    const live = clone(base);
    live.styles.bold = { bl: 1, ht: 2 };
    live.sheets.est!.cellData['0']!['0'] = { v: 'Perfil', s: 'bold' };
    expect(operationsBetween(base, live)).toEqual([
      {
        op: 'set_style',
        sheet: 'Estimativa',
        range: 'A1',
        bold: true,
        italic: false,
        align: 'center',
        wrap: false,
      },
    ]);
  });

  it('maps a currency pattern to set_format when it has a named equivalent', () => {
    expect(formatOfPattern('"R$" #,##0.00')).toBe('currency');
    expect(formatOfPattern('#,##0.00')).toBe('decimal');
    expect(formatOfPattern('[$-x] custom')).toBeUndefined();
    const live = clone(base);
    live.styles.money = { n: { pattern: '"R$" #,##0.00' } };
    live.sheets.est!.cellData['1']!['1'] = { v: 120, s: 'money' };
    expect(operationsBetween(base, live)).toEqual([
      { op: 'set_format', sheet: 'Estimativa', range: 'B2', format: 'currency' },
    ]);
  });

  it('uses the exact command ids of the Univer sheets package', () => {
    expect(STRUCTURAL_COMMANDS.insertRow).toBe(InsertRowCommand.id);
    expect(STRUCTURAL_COMMANDS.removeRow).toBe(RemoveRowCommand.id);
    expect(STRUCTURAL_COMMANDS.removeRow).toBe('sheet.command.remove-row');
  });

  it('builds structural operations from Univer command parameters', () => {
    const insert = structuralOperation(
      STRUCTURAL_COMMANDS.insertRow,
      { subUnitId: 'est', range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 5 } },
      base,
    );
    expect(insert).toEqual({ op: 'insert_rows', sheet: 'Estimativa', at: 2, count: 2 });
    expect(
      structuralOperation(
        'other',
        { subUnitId: 'est', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } },
        base,
      ),
    ).toBeUndefined();
  });

  it('keeps the base aligned after an inserted row, so only real edits remain', () => {
    const insert = { op: 'insert_rows' as const, sheet: 'Estimativa', at: 2, count: 1 };
    const shiftedBase = applyStructural(base, insert);
    // Univer shows the same cells one row lower and a blank row at 2.
    const live = clone(shiftedBase);
    expect(operationsBetween(shiftedBase, live)).toEqual([]);
    // The blank row is inserted before row 2 (index 1): Tech Lead moves down to index 2.
    expect(shiftedBase.sheets.est!.cellData['1']).toBeUndefined();
    expect(shiftedBase.sheets.est!.cellData['2']!['0']).toEqual({ v: 'Tech Lead' });
    expect(shiftedBase.sheets.est!.cellData['3']!['0']).toEqual({ v: 'Dev' });
  });

  it('the operations applied on the base reproduce the live grid', async () => {
    const live = clone(base);
    live.sheets.est!.cellData['1']!['1'] = { v: 150 };
    live.sheets.est!.cellData['3'] = { '0': { v: 'QA' }, '1': { f: '=B2*0.5' } };
    const ops = operationsBetween(base, live);
    const registry = createRegistry({ formats: [createSheetFormat(createUniverEngine())] });
    const result = await applyOperations(
      registry,
      { format: 'univer-sheet', content: base, title: 'T', themeId: 'default', locale: 'pt-BR' },
      ops,
    );
    expect(result.content.sheets.est!.cellData['1']!['1']?.v).toBe(150);
    expect(result.content.sheets.est!.cellData['3']!['0']?.v).toBe('QA');
    expect(result.content.sheets.est!.cellData['3']!['1']?.f).toBe('=B2*0.5');
  });
});
