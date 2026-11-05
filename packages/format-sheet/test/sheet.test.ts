// @vitest-environment node

import { applyOperations, createRegistry, prepareContent } from '@artkit-ai/core';
import { defineFormatConformanceTests } from '@artkit-ai/core/testing';
import { describe, expect, it } from 'vitest';
import {
  createSheetFormat,
  emptyWorkbook,
  lintWorkbook,
  validateWorkbook,
  type WorkbookContent,
} from '../src/index.js';
import { createUniverEngine } from '../src/server/engine.js';

const sheetFormat = createSheetFormat(createUniverEngine());
const registry = createRegistry({ formats: [sheetFormat] });

const start: WorkbookContent = {
  ...emptyWorkbook('wb_test', 'Estimativa', 'pt-BR'),
  sheetOrder: ['resumo'],
  sheets: { resumo: { id: 'resumo', name: 'Resumo', rowCount: 100, columnCount: 26, cellData: {} } },
};

function run(content: WorkbookContent, operations: unknown[]) {
  return applyOperations(
    registry,
    { format: 'univer-sheet', content, title: 'Estimativa', themeId: 'default', locale: 'pt-BR' },
    operations,
  );
}

function cell(content: WorkbookContent, sheetId: string, row: number, column: number) {
  return content.sheets[sheetId]?.cellData[String(row)]?.[String(column)];
}

describe('sheet operations on Univer headless', () => {
  it('writes values and computes formulas', async () => {
    const result = await run(start, [
      { op: 'set_values', sheet: 'Resumo', at: 'A1', values: [['Perfil', 'Horas', 'Valor hora', 'Total']] },
      { op: 'set_values', sheet: 'Resumo', at: 'A2', values: [['Tech Lead', 120, 165, '=B2*C2']] },
    ]);
    expect(cell(result.content, 'resumo', 0, 0)?.v).toBe('Perfil');
    expect(cell(result.content, 'resumo', 1, 3)?.f).toBe('=B2*C2');
    expect(cell(result.content, 'resumo', 1, 3)?.v).toBe(19800);
  });

  it('applies number formats and styles', async () => {
    const result = await run(start, [
      { op: 'set_values', sheet: 'Resumo', at: 'A1', values: [[1234.5]] },
      { op: 'set_format', sheet: 'Resumo', range: 'A1', format: 'currency' },
      { op: 'set_style', sheet: 'Resumo', range: 'A1', bold: true, align: 'center', color: '#FF0000' },
    ]);
    expect(cell(result.content, 'resumo', 0, 0)?.s).toBeDefined();
  });

  it('adds, renames and moves sheets and resolves later operations against them', async () => {
    const result = await run(start, [
      { op: 'add_sheet', name: 'Premissas' },
      { op: 'rename_sheet', sheet: 'Premissas', name: 'Premissas 2026' },
      { op: 'set_values', sheet: 'Premissas 2026', at: 'A1', values: [['Taxa', 0.1]] },
      { op: 'move_sheet', sheet: 'Premissas 2026', index: 0 },
    ]);
    expect(result.createdRefs).toContain('Premissas');
    const names = result.content.sheetOrder.map((id) => result.content.sheets[id]?.name);
    expect(names).toEqual(['Premissas 2026', 'Resumo']);
  });

  it('rejects a sheet name already in use', async () => {
    await expect(run(start, [{ op: 'add_sheet', name: 'resumo' }])).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });

  it('refuses to remove the last sheet', async () => {
    await expect(run(start, [{ op: 'remove_sheet', sheet: 'Resumo' }])).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });

  it('inserts and deletes rows and columns', async () => {
    const seeded = await run(start, [
      { op: 'set_values', sheet: 'Resumo', at: 'A1', values: [['a'], ['b'], ['c']] },
    ]);
    const inserted = await run(seeded.content, [{ op: 'insert_rows', sheet: 'Resumo', at: 2, count: 1 }]);
    expect(cell(inserted.content, 'resumo', 1, 0)).toBeUndefined();
    expect(cell(inserted.content, 'resumo', 2, 0)?.v).toBe('b');
    const deleted = await run(inserted.content, [{ op: 'delete_rows', sheet: 'Resumo', from: 2, count: 1 }]);
    expect(cell(deleted.content, 'resumo', 1, 0)?.v).toBe('b');
  });

  it('merges cells, sets widths and heights and freezes the header row', async () => {
    const result = await run(start, [
      { op: 'merge', sheet: 'Resumo', range: 'A1:B1' },
      { op: 'set_column_width', sheet: 'Resumo', column: 'A', width: 200 },
      { op: 'set_row_height', sheet: 'Resumo', row: 1, height: 40 },
      { op: 'set_frozen', sheet: 'Resumo', rows: 1, columns: 0 },
    ]);
    expect(result.content.sheets.resumo?.mergeData?.length).toBe(1);
    expect(result.content.sheets.resumo?.freeze?.ySplit).toBe(1);
  });

  it('is deterministic for the same batch', async () => {
    const batch = [{ op: 'set_values', sheet: 'Resumo', at: 'A1', values: [[2, 3, '=A1*B1']] }];
    const a = await run(start, batch);
    const b = await run(start, batch);
    expect(a.content).toEqual(b.content);
  });

  it('reports the sheet that does not exist with a hint', async () => {
    const error = await run(start, [{ op: 'set_values', sheet: 'Nada', at: 'A1', values: [[1]] }]).catch(
      (e) => e,
    );
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues[0].hint).toContain('Resumo');
  });
});

describe('sheet validation, reading, lint and diff', () => {
  it('rejects volatile and external functions', () => {
    const today = structuredClone(start);
    today.sheets.resumo!.cellData = { '0': { '0': { f: '=TODAY()' } } };
    expect(validateWorkbook(today).ok).toBe(false);
    const external = structuredClone(start);
    external.sheets.resumo!.cellData = { '0': { '0': { f: '=WEBSERVICE("x")' } } };
    expect(validateWorkbook(external).ok).toBe(false);
  });

  it('reads the outline and A1 ranges', () => {
    const content = prepareContent(registry, 'univer-sheet', start).content as WorkbookContent;
    const outline = sheetFormat.read(content, { mode: 'outline', locale: 'pt-BR' });
    expect(outline.text).toContain('Resumo');
    const range = sheetFormat.read(content, { mode: 'range', range: 'Resumo!A1:B2', locale: 'pt-BR' });
    expect(range.text).toContain('Resumo!A1:B2');
  });

  it('lint reports formula errors', () => {
    const content = structuredClone(start);
    content.sheets.resumo!.cellData = { '0': { '0': { f: '=1/0', v: '#DIV/0!' } } };
    expect(lintWorkbook(content).map((issue) => issue.code)).toContain('formula-error');
  });

  it('diff targets cells by address', async () => {
    const before = (await run(start, [{ op: 'set_values', sheet: 'Resumo', at: 'A1', values: [[1]] }]))
      .content;
    const after = (await run(before, [{ op: 'set_values', sheet: 'Resumo', at: 'A1', values: [[2]] }]))
      .content;
    expect(sheetFormat.diff(before, after)).toEqual([expect.objectContaining({ target: 'cell:Resumo!A1' })]);
  });
});

defineFormatConformanceTests(
  sheetFormat,
  [
    {
      title: 'planilha vazia com tabela',
      content: start,
      batches: [[{ op: 'set_values', sheet: 'Resumo', at: 'A1', values: [['x', 2, 3, '=B1*C1']] }]],
    },
  ],
  { describe, it },
);

describe('fill_range', () => {
  it('copies a formula down a range, shifting relative references and keeping absolute ones', async () => {
    const seeded = await run(start, [
      {
        op: 'set_values',
        sheet: 'Resumo',
        at: 'A1',
        values: [
          [2, 3, '=A1*B1'],
          [4, 5, '=A2*$B$1'],
        ],
      },
    ]);
    const filled = await run(seeded.content, [
      { op: 'fill_range', sheet: 'Resumo', from: 'C2', to: 'C2:C4' },
    ]);
    expect(cell(filled.content, 'resumo', 2, 2)?.f).toBe('=A3*$B$1');
    expect(cell(filled.content, 'resumo', 3, 2)?.f).toBe('=A4*$B$1');
  });

  it('shifts only A1 references, not function names', async () => {
    const { shiftFormula } = await import('../src/operations.js');
    expect(shiftFormula('=SUM(A1:A2)+LOG10(B2)', 1, 0)).toBe('=SUM(A2:A3)+LOG10(B3)');
  });
});
