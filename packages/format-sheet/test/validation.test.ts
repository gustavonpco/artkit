// @vitest-environment node

import { applyOperations, createRegistry } from '@artkit-ai/core';
import { describe, expect, it } from 'vitest';
import { createSheetFormat, emptyWorkbook, lintWorkbook, type WorkbookContent } from '../src/index.js';
import { createUniverEngine } from '../src/server/engine.js';
import { shiftRange } from '../src/validation.js';

const range = (startRow: number, endRow: number, startColumn = 0, endColumn = 0) => ({
  startRow,
  endRow,
  startColumn,
  endColumn,
});

describe('range shifts follow the row and column changes', () => {
  it('moves a range below an insertion and grows one that spans it', () => {
    expect(shiftRange(range(4, 6), { axis: 'row', kind: 'insert', at: 2, count: 2 })).toEqual(range(6, 8));
    expect(shiftRange(range(1, 6), { axis: 'row', kind: 'insert', at: 3, count: 2 })).toEqual(range(1, 8));
  });

  it('keeps a rule that loses some rows and drops one that loses all of them', () => {
    expect(shiftRange(range(2, 4), { axis: 'row', kind: 'delete', at: 0, count: 2 })).toEqual(range(0, 2));
    expect(shiftRange(range(2, 4), { axis: 'row', kind: 'delete', at: 2, count: 3 })).toBeUndefined();
    expect(shiftRange(range(1, 5), { axis: 'row', kind: 'delete', at: 3, count: 1 })).toEqual(range(1, 4));
  });

  it('handles columns the same way', () => {
    expect(shiftRange(range(0, 0, 2, 3), { axis: 'column', kind: 'insert', at: 1, count: 1 })).toEqual(
      range(0, 0, 3, 4),
    );
  });
});

const registry = createRegistry({ formats: [createSheetFormat(createUniverEngine())] });

const base: WorkbookContent = {
  ...emptyWorkbook('wb', 'Estimativa', 'pt-BR'),
  sheetOrder: ['est'],
  sheets: { est: { id: 'est', name: 'Estimativa', rowCount: 30, columnCount: 6, cellData: {} } },
  styles: {},
};

function run(content: WorkbookContent, operations: unknown[]) {
  return applyOperations(
    registry,
    { format: 'univer-sheet', content, title: 'T', themeId: 'default', locale: 'pt-BR' },
    operations,
  );
}

describe('set_validation and clear_range all', () => {
  it('stores a list rule and accepts values from the list', async () => {
    const result = await run(base, [
      { op: 'set_validation', sheet: 'Estimativa', range: 'C2:C5', list: ['Sim', 'Não'] },
      { op: 'set_values', sheet: 'Estimativa', at: 'C2', values: [['Sim']] },
    ]);
    expect(result.content.validations).toEqual([{ sheet: 'est', range: 'C2:C5', list: ['Sim', 'Não'] }]);
  });

  it('refuses a value outside the list, naming the allowed ones', async () => {
    const error = await run(base, [
      { op: 'set_validation', sheet: 'Estimativa', range: 'C2:C5', list: ['Sim', 'Não'] },
      { op: 'set_values', sheet: 'Estimativa', at: 'C3', values: [['Talvez']] },
    ]).catch((e) => e);
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues[0].hint).toContain('Sim');
  });

  it('keeps a rule with its cells when a row is inserted above it', async () => {
    const ruled = await run(base, [
      { op: 'set_validation', sheet: 'Estimativa', range: 'C2:C5', list: ['A', 'B'] },
    ]);
    const moved = await run(ruled.content, [{ op: 'insert_rows', sheet: 'Estimativa', at: 1, count: 2 }]);
    expect(moved.content.validations?.[0]?.range).toBe('C4:C7');
    await expect(
      run(moved.content, [{ op: 'set_values', sheet: 'Estimativa', at: 'C4', values: [['Z']] }]),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
  });

  it('clear_range all removes values and styles of the range', async () => {
    const styled = await run(base, [
      { op: 'set_values', sheet: 'Estimativa', at: 'A1', values: [['x', 'y']] },
      { op: 'set_style', sheet: 'Estimativa', range: 'A1:B1', bold: true },
    ]);
    const cleared = await run(styled.content, [
      { op: 'clear_range', sheet: 'Estimativa', range: 'A1:B1', what: 'all' },
    ]);
    expect(cleared.content.sheets.est!.cellData['0']?.['0']).toBeUndefined();
    expect(cleared.content.sheets.est!.cellData['0']?.['1']).toBeUndefined();
  });

  it('lint reports existing values that break a rule', () => {
    const broken = structuredClone(base);
    broken.sheets.est!.cellData = { '1': { '2': { v: 'Talvez' } } };
    broken.validations = [{ sheet: 'est', range: 'C2:C5', list: ['Sim'] }];
    expect(lintWorkbook(broken).map((issue) => issue.code)).toContain('validation-violated');
  });
});
