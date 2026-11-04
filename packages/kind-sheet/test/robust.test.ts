import { ArtifactError, applyOperations, createRegistry, defaultTheme, silentLogger } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { autoSumOps, sortOps } from '../src/edit/ops.js';
import { sheetMarkdownExporter, sheetToMarkdown, sheetZipExporter } from '../src/export/index.js';
import { type SheetContent, sheetKind } from '../src/index.js';
import { book } from './helpers.js';

const registry = createRegistry({ kinds: [sheetKind] });
const apply = (content: SheetContent, operations: unknown[]) =>
  applyOperations(
    registry,
    { kind: 'sheet', content, title: 'T', themeId: 'default', locale: 'en' },
    operations,
  ).content as SheetContent;

const data = () =>
  book({
    Dados: {
      A1: 'Nome',
      B1: 'Horas',
      C1: 'Total',
      A2: 'Carla',
      B2: 8,
      C2: '=B2*10',
      A3: 'Ana',
      B3: 20,
      C3: '=B3*10',
      A4: 'Bruno',
      B4: 5,
      C4: '=B4*10',
    },
  });

describe('sort_range', () => {
  it('sorts rows with a header, keeping formulas pointed at their own row', () => {
    const sorted = apply(data(), [
      { op: 'sort_range', sheet: 's1', range: 'A1:C4', by: [{ column: 'A' }], header: true },
    ]);
    const cells = sorted.sheets[0]!.cells;
    expect([cells.A2?.v, cells.A3?.v, cells.A4?.v]).toEqual(['Ana', 'Bruno', 'Carla']);
    expect(cells.C2).toMatchObject({ f: 'B2*10', v: 200 });
    expect(cells.C4).toMatchObject({ f: 'B4*10', v: 80 });
    expect(cells.A1?.v).toBe('Nome');
  });

  it('sorts numbers descending and keeps blanks last', () => {
    const content = book({ S: { A1: 3, A2: 10, A4: 7 } });
    const sorted = apply(content, [
      { op: 'sort_range', sheet: 's1', range: 'A1:A4', by: [{ column: 'A', descending: true }] },
    ]);
    const cells = sorted.sheets[0]!.cells;
    expect([cells.A1?.v, cells.A2?.v, cells.A3?.v, cells.A4]).toEqual([10, 7, 3, undefined]);
  });

  it('is stable and supports secondary keys', () => {
    const content = book({ S: { A1: 'x', B1: 2, A2: 'y', B2: 1, A3: 'x', B3: 1 } });
    const sorted = apply(content, [
      { op: 'sort_range', sheet: 's1', range: 'A1:B3', by: [{ column: 'A' }, { column: 'B' }] },
    ]);
    const cells = sorted.sheets[0]!.cells;
    expect([cells.A1?.v, cells.B1?.v, cells.A2?.v, cells.B2?.v, cells.A3?.v]).toEqual(['x', 1, 'x', 2, 'y']);
  });

  it('rejects keys outside the range with a path', () => {
    try {
      apply(data(), [{ op: 'sort_range', sheet: 's1', range: 'A1:B4', by: [{ column: 'C' }] }]);
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactError);
      expect((error as ArtifactError).issues[0]?.path).toBe('operations[0].by[0].column');
    }
  });

  it('is offered by the editor for the active column with header detection', () => {
    const content = data();
    expect(sortOps(content.sheets[0]!, { top: 2, bottom: 2, left: 1, right: 1 }, 1, false)).toEqual([
      {
        op: 'sort_range',
        sheet: 's1',
        range: 'A1:C4',
        by: [{ column: 'B', descending: false }],
        header: true,
      },
    ]);
  });
});

describe('AutoSum', () => {
  it('sums the numbers above a single cell and keeps the format', () => {
    const content = book({
      S: { A1: 'Horas', A2: { v: 1, fmt: 'decimal2' }, A3: { v: 2, fmt: 'decimal2' } },
    });
    const ops = autoSumOps(content.sheets[0]!, { top: 3, bottom: 3, left: 0, right: 0 });
    expect(ops).toEqual([
      { op: 'set_cells', sheet: 's1', cells: { A4: { f: 'SUM(A2:A3)', fmt: 'decimal2' } } },
    ]);
    expect(apply(content, ops).sheets[0]!.cells.A4?.v).toBe(3);
  });

  it('writes one SUM under each selected column', () => {
    const content = book({ S: { A1: 1, B1: 2, A2: 3, B2: 4 } });
    const ops = autoSumOps(content.sheets[0]!, { top: 0, bottom: 1, left: 0, right: 1 });
    expect(apply(content, ops).sheets[0]!.cells).toMatchObject({ A3: { v: 4 }, B3: { v: 6 } });
  });
});

describe('new exporters', () => {
  const ctx = {
    title: 'Equipe',
    theme: defaultTheme,
    locale: 'pt-BR',
    logger: silentLogger,
    assets: { resolve: () => Promise.reject(new Error('none')) },
    warn: () => {},
  };

  it('writes Markdown tables with locale-formatted values', async () => {
    const content = book({ Dados: { A1: 'Nome', B1: 'Valor', A2: 'Ana', B2: { v: 1500, fmt: 'currency' } } });
    expect(sheetToMarkdown(content, 'pt-BR')).toContain('| Ana | R$ 1.500,00 |');
    expect(sheetToMarkdown(content, 'pt-BR')).toContain('| --- | ---: |');
    const md = new TextDecoder().decode(await sheetMarkdownExporter.export(content, ctx));
    expect(md.startsWith('# Equipe')).toBe(true);
  });

  it('bundles every sheet as CSV in a valid ZIP', async () => {
    const content = book({ Resumo: { A1: 'a' }, 'Dados/2026': { A1: 1 } });
    const zip = Buffer.from(await sheetZipExporter.export(content, ctx));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const names: string[] = [];
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const size = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
      names.push(name);
      const data = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
      expect(data.length).toBeGreaterThan(0);
      offset += 30 + nameLength + size;
    }
    expect(names).toEqual(['Resumo.csv', 'Dados_2026.csv']);
  });
});
