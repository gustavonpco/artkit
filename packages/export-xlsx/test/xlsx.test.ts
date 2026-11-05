// @vitest-environment node

import { emptyWorkbook, type WorkbookContent } from '@artkit-ai/format-sheet';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { sheetXlsxExporter } from '../src/index.js';

const content: WorkbookContent = {
  ...emptyWorkbook('wb', 'Estimativa', 'pt-BR'),
  sheetOrder: ['resumo'],
  sheets: {
    resumo: {
      id: 'resumo',
      name: 'Resumo',
      rowCount: 10,
      columnCount: 5,
      cellData: {
        '0': { '0': { v: 'Perfil' }, '1': { v: 'Horas' }, '2': { v: 'Valor' }, '3': { v: 'Total' } },
        '1': { '0': { v: 'Tech Lead' }, '1': { v: 120 }, '2': { v: 165 }, '3': { f: '=B2*C2', v: 19800 } },
      },
      mergeData: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 1 }],
      freeze: { startRow: 1, startColumn: 0, ySplit: 1, xSplit: 0 },
    },
  },
};

describe('xlsx export', () => {
  it('writes values, formulas with cached results and the tab name', async () => {
    const bytes = await sheetXlsxExporter.export(content, {
      title: 'Estimativa',
      theme: { id: 'default' } as never,
      locale: 'pt-BR',
      assets: { resolve: async () => ({ bytes: new Uint8Array(), mimeType: 'x' }) } as never,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      warn: () => {},
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.getWorksheet('Resumo');
    expect(sheet?.getCell('A2').value).toBe('Tech Lead');
    expect(sheet?.getCell('D2').value).toEqual({ formula: 'B2*C2', result: 19800 });
  });
});
