import { ArtifactError, defaultTheme, type ExportContext, silentLogger } from '@artkit/core';
import ExcelModule from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  sheetCsvExporter,
  sheetExporters,
  sheetHtmlExporter,
  sheetXlsxExporter,
} from '../src/export/index.js';
import { serialFromIso } from '../src/index.js';
import { book } from './helpers.js';

const Excel = ((ExcelModule as unknown as { default?: typeof ExcelModule }).default ??
  ExcelModule) as typeof ExcelModule;

function context(
  options: Record<string, unknown> = {},
  locale = 'pt-BR',
): ExportContext & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    title: 'Estimativa',
    theme: defaultTheme,
    locale,
    assets: {
      resolve: async () => ({ mimeType: 'image/png', bytes: new Uint8Array() }),
    } as unknown as ExportContext['assets'],
    logger: silentLogger,
    warn: (message: string) => warnings.push(message),
    options,
    warnings,
  };
}

const content = book(
  {
    Resumo: {
      A1: {
        v: 'Perfil',
        s: { bold: true, background: 'surface', border: { bottom: 'thin', color: 'accent' } },
      },
      B1: { v: 'Horas', s: { bold: true } },
      C1: { v: 'Total', s: { bold: true, align: 'right' } },
      A2: 'Dev',
      B2: 10,
      C2: { f: 'B2*valor_hora', fmt: 'currency' },
      A3: 'QA',
      B3: 5,
      C3: { f: 'B3*valor_hora', fmt: 'currency' },
      A4: { v: 'Total', s: { italic: true, color: 'danger' } },
      C4: { f: 'SUM(C2:C3)', fmt: 'currency', note: 'Soma das linhas' },
      D2: { v: 0.15, fmt: 'percent' },
      D3: { v: serialFromIso('2026-11-09')!, fmt: 'date' },
      D4: { f: '1/0' },
      E1: { v: 'Status' },
      E2: 'Aberto',
      F1: { v: '=cmd|calc', fmt: 'text' },
      F2: '+1',
      F3: -5,
      F4: '<script>alert(1)</script>',
    },
    Parametros: { A1: 'Valor hora', B1: { v: 150, fmt: 'currency' } },
    Oculta: { A1: 1 },
  },
  { names: [{ name: 'valor_hora', ref: 'Parametros!$B$1' }] },
);
const resumo = content.sheets[0]!;
resumo.merges = ['A6:C6'];
resumo.frozen = { rows: 1, cols: 1 };
resumo.columns = { A: { width: 24 } };
resumo.rows = { '1': { height: 22 } };
resumo.validations = [{ range: 'E2:E10', values: ['Aberto', 'Fechado'] }];
resumo.cells.A6 = { v: 'Mesclada' };
content.sheets[2]!.hidden = true;

describe('xlsx exporter', () => {
  it('writes formulas with cached results, formats, styles and workbook features', async () => {
    const ctx = context();
    const bytes = await sheetXlsxExporter.export(content, ctx);
    const wb = new Excel.Workbook();
    await wb.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const ws = wb.getWorksheet('Resumo')!;
    expect(ws.getCell('C2').value).toEqual({ formula: 'B2*valor_hora', result: 1500 });
    expect(ws.getCell('C4').value).toEqual({ formula: 'SUM(C2:C3)', result: 2250 });
    expect(ws.getCell('D4').value).toEqual({ formula: '1/0', result: { error: '#DIV/0!' } });
    expect(ws.getCell('C2').numFmt).toContain('R$');
    expect(ws.getCell('D2').numFmt).toBe('0.00%');
    expect(ws.getCell('D3').numFmt).toBe('dd/mm/yyyy');
    // exceljs reads date-formatted serials back as Date objects.
    expect(ws.getCell('D3').value).toEqual(new Date(Date.UTC(2026, 10, 9)));
    expect(ws.getCell('A1').font.bold).toBe(true);
    const argb = (c: string) => `FF${c.slice(1).toUpperCase()}`;
    expect(ws.getCell('A1').fill).toMatchObject({
      type: 'pattern',
      fgColor: { argb: argb(defaultTheme.colors.surface) },
    });
    expect(ws.getCell('A1').border.bottom).toMatchObject({
      style: 'thin',
      color: { argb: argb(defaultTheme.colors.accent) },
    });
    expect(ws.getCell('A4').font).toMatchObject({
      italic: true,
      color: { argb: argb(defaultTheme.colors.danger) },
    });
    expect(ws.getCell('C1').alignment.horizontal).toBe('right');
    expect(ws.getCell('C4').note).toBe('Soma das linhas');
    expect(ws.getCell('F1').value).toBe('=cmd|calc');
    expect(ws.getCell('A6').isMerged).toBe(true);
    expect(ws.getCell('C6').master.address).toBe('A6');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 1 });
    expect(ws.getColumn(1).width).toBe(24);
    expect(ws.getRow(1).height).toBe(22);
    expect(ws.getCell('E5').dataValidation).toMatchObject({ type: 'list', formulae: ['"Aberto,Fechado"'] });
    expect(wb.definedNames.model).toEqual([{ name: 'valor_hora', ranges: ['Parametros!$B$1'] }]);
    expect(wb.getWorksheet('Oculta')!.state).toBe('hidden');
    expect(ctx.warnings).toEqual([]);
  });

  it('warns about lossy validations and #REF! names', async () => {
    const lossy = structuredClone(content);
    lossy.sheets[0]!.validations = [{ range: 'E2:E3', values: ['a,b', 'c'] }];
    lossy.names = [{ name: 'gone', ref: '#REF!' }];
    const ctx = context();
    await sheetXlsxExporter.export(lossy, ctx);
    expect(ctx.warnings).toHaveLength(2);
  });

  it('keeps names that point to quoted sheet names', async () => {
    const quoted = book(
      { 'Estimativa 2': { A1: 3, B1: { f: 'taxa*2' } } },
      { names: [{ name: 'taxa', ref: "'Estimativa 2'!$A$1" }] },
    );
    const bytes = await sheetXlsxExporter.export(quoted, context());
    const wb = new Excel.Workbook();
    await wb.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    expect(wb.definedNames.model).toEqual([{ name: 'taxa', ranges: ["'Estimativa 2'!$A$1"] }]);
    expect(wb.getWorksheet('Estimativa 2')!.getCell('B1').value).toEqual({ formula: 'taxa*2', result: 6 });
  });
});

describe('csv exporter', () => {
  const csv = async (options: Record<string, unknown> = {}) =>
    new TextDecoder().decode(await sheetCsvExporter.export(content, context(options)));

  it('exports values, ISO dates and protects text from formula injection', async () => {
    const lines = (await csv()).split('\r\n');
    expect(lines[0]).toBe("Perfil,Horas,Total,,Status,'=cmd|calc");
    expect(lines[1]).toBe("Dev,10,1500,0.15,Aberto,'+1");
    expect(lines[2]).toBe('QA,5,750,2026-11-09,,-5');
    expect(lines[3]).toBe('Total,,2250,#DIV/0!,,<script>alert(1)</script>');
  });

  it('selects sheets by id or name, supports ";" and BOM, rejects unknown sheets', async () => {
    expect(await csv({ sheet: 's2' })).toBe('Valor hora,150\r\n');
    expect(await csv({ sheet: 'parametros', delimiter: ';' })).toBe('Valor hora;150\r\n');
    const bom = await sheetCsvExporter.export(content, context({ sheet: 's2', bom: true }));
    expect([...bom.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    await expect(csv({ sheet: 'nope' })).rejects.toBeInstanceOf(ArtifactError);
  });

  it('quotes fields with delimiters, quotes and line breaks', async () => {
    const quoted = book({ S: { A1: 'a,b', B1: 'say "hi"', C1: 'two\nlines' } });
    const text = new TextDecoder().decode(await sheetCsvExporter.export(quoted, context()));
    expect(text).toBe('"a,b","say ""hi""","two\nlines"\r\n');
  });
});

describe('html exporter', () => {
  it('renders escaped tables with merges and formatted values', async () => {
    const ctx = context();
    const html = new TextDecoder().decode(await sheetHtmlExporter.export(content, ctx));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('colspan="3"');
    expect(html).toMatch(/R\$\s1\.500,00/);
    expect(html).toContain('<caption>Resumo</caption>');
    expect(html).toContain('<th scope="col"');
    expect(html).not.toContain('<caption>Oculta</caption>');
    expect(ctx.warnings).toHaveLength(1);
  });

  it('registers xlsx, csv, zip, md and html', () => {
    expect(sheetExporters.map((exporter) => `${exporter.kind}:${exporter.format}`)).toEqual([
      'sheet:xlsx',
      'sheet:csv',
      'sheet:zip',
      'sheet:md',
      'sheet:html',
    ]);
  });
});
