import { applyOperations, createRegistry, defaultTheme, prepareContent } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import {
  columnLetter,
  createSheetKind,
  type NamedFormat,
  type SheetContent,
  serialFromIso,
} from '../src/index.js';
import fixture from './fixtures/planilha.json' with { type: 'json' };

/**
 * Workia's `planilha` (parameters, typed columns, computed columns, declarative and formula totals) mapped
 * onto the sheet model: parameters become named cells, computed columns a model formula copied with
 * fill_range, grouped totals SUMIF and formula totals plain formulas.
 */

interface Planilha {
  parametros: { id: string; rotulo: string; tipo: string; valor: number }[];
  colunas: { id: string; rotulo: string; tipo: string; formula?: string }[];
  linhas: { id: string; grupo?: string; celulas: Record<string, string | number> }[];
  totais: {
    id: string;
    rotulo: string;
    op: string;
    coluna?: string;
    agruparPor?: string;
    formula?: string;
  }[];
}

const FORMATS: Record<string, NamedFormat> = {
  moeda: 'currency',
  percentual: 'percent',
  data: 'date',
  inteiro: 'integer',
  numero: 'general',
};

function convert(source: Planilha) {
  const params = {
    id: 'parametros',
    name: 'Parametros',
    cells: Object.fromEntries(
      source.parametros.flatMap((param, i) => [
        [`A${i + 1}`, { v: param.rotulo }],
        [`B${i + 1}`, { v: param.valor, fmt: FORMATS[param.tipo] ?? 'general' }],
      ]),
    ),
  };
  // Column A holds the row group; data columns start at B.
  const columns = [{ id: 'grupo', rotulo: 'Grupo', tipo: 'texto' }, ...source.colunas];
  const letter = new Map(columns.map((column, i) => [column.id, columnLetter(i)]));
  const last = source.linhas.length + 1;
  const cells: Record<string, unknown> = {};
  columns.forEach((column, i) => {
    cells[`${columnLetter(i)}1`] = { v: column.rotulo, s: { bold: true } };
  });
  source.linhas.forEach((row, r) => {
    cells[`A${r + 2}`] = { v: row.grupo ?? '' };
    for (const column of source.colunas) {
      const value = row.celulas[column.id];
      if (value !== undefined && !column.formula) {
        cells[`${letter.get(column.id)}${r + 2}`] = {
          v: value,
          ...(FORMATS[column.tipo] ? { fmt: FORMATS[column.tipo] } : {}),
        };
      }
    }
  });
  const rowFormula = (formula: string, row: number) =>
    formula
      .replace(/param\((\w+)\)/g, '$1')
      .replace(/\b([a-z_]\w*)\b/g, (word) => (letter.has(word) ? `${letter.get(word)}${row}` : word));
  const totalFormula = (formula: string) =>
    formula
      .replace(/param\((\w+)\)/g, '$1')
      .replace(/soma\((\w+)\)/g, (_, id: string) => `SUM(${letter.get(id)}2:${letter.get(id)}${last})`);

  const operations: unknown[] = [];
  for (const column of source.colunas.filter((c) => c.formula)) {
    const col = letter.get(column.id)!;
    operations.push({
      op: 'set_cells',
      sheet: 'estimativa',
      cells: { [`${col}2`]: { f: rowFormula(column.formula!, 2), fmt: FORMATS[column.tipo] } },
    });
    operations.push({
      op: 'fill_range',
      sheet: 'estimativa',
      source: `${col}2`,
      target: `${col}2:${col}${last}`,
    });
  }
  const totals: Record<string, unknown> = {};
  let row = last + 2;
  for (const total of source.totais) {
    const format = total.coluna
      ? FORMATS[source.colunas.find((c) => c.id === total.coluna)?.tipo ?? '']
      : 'currency';
    if (total.agruparPor) {
      const groups = [...new Set(source.linhas.map((line) => line.grupo ?? '(sem grupo)'))];
      for (const group of groups) {
        totals[`A${row}`] = { v: `${total.rotulo}: ${group}` };
        totals[`B${row}`] = { v: group };
        // Bounded ranges: a whole-column E:E would include the total itself (circular reference).
        const col = letter.get(total.coluna!)!;
        totals[`E${row}`] = { f: `SUMIF($A$2:$A$${last},B${row},$${col}$2:$${col}$${last})`, fmt: format };
        row++;
      }
      continue;
    }
    const col = letter.get(total.coluna ?? '') ?? 'E';
    const formula = total.op === 'formula' ? totalFormula(total.formula!) : `SUM(${col}2:${col}${last})`;
    totals[`A${row}`] = { v: total.rotulo, s: { bold: true } };
    totals[`${col}${row}`] = { f: formula, ...(format && format !== 'general' ? { fmt: format } : {}) };
    row++;
  }
  operations.push({ op: 'set_cells', sheet: 'estimativa', cells: totals });
  return {
    content: {
      sheets: [params, { id: 'estimativa', name: 'Estimativa', frozen: { rows: 1, cols: 0 }, cells }],
      names: source.parametros.map((param, i) => ({ name: param.id, ref: `Parametros!$B$${i + 1}` })),
      settings: { currency: 'BRL' },
    },
    operations,
  };
}

describe('Workia planilha compatibility', () => {
  const kind = createSheetKind({ locale: 'pt-BR' });
  const registry = createRegistry({ kinds: [kind] });
  const { content: raw, operations } = convert(fixture as Planilha);
  const prepared = prepareContent(registry, 'sheet', raw, { locale: 'pt-BR' }).content as SheetContent;
  const result = applyOperations(
    registry,
    { kind: 'sheet', content: prepared, title: fixture.titulo, themeId: 'default', locale: 'pt-BR' },
    operations,
  );
  const sheet = (result.content as SheetContent).sheets[1]!;

  it('computes the computed column with the named parameter', () => {
    expect(sheet.cells.E2).toEqual({ f: 'D2 * valor_hora', v: 1500, fmt: 'currency' });
    expect(sheet.cells.E3!.v).toBe(3075);
    expect(sheet.cells.E4).toEqual({ f: 'D4 * valor_hora', v: 1200, fmt: 'currency' });
    expect(sheet.cells.C2).toEqual({ v: serialFromIso('2026-11-09'), fmt: 'date' });
  });

  it('recalculates totals, group totals and the formula total', () => {
    expect(sheet.cells.D6).toEqual({ f: 'SUM(D2:D4)', v: 38.5 });
    expect(sheet.cells.E7).toEqual({ f: 'SUM(E2:E4)', v: 5775, fmt: 'currency' });
    expect(sheet.cells.B8!.v).toBe('Construção');
    expect(sheet.cells.E8!.v).toBe(4575);
    expect(sheet.cells.E9!.v).toBe(1200);
    expect(sheet.cells.E10).toEqual({ f: 'SUM(E2:E4) * (1 + margem)', v: 6930, fmt: 'currency' });
  });

  it('follows parameter edits and reports them as formatted diffs', () => {
    const edited = applyOperations(
      registry,
      { kind: 'sheet', content: result.content, title: 'T', themeId: 'default', locale: 'pt-BR' },
      [{ op: 'set_cells', sheet: 'parametros', cells: { B1: { v: 160 } } }],
    );
    const after = (edited.content as SheetContent).sheets[1]!;
    expect(after.cells.E7!.v).toBe(6160);
    expect(edited.diff).toContainEqual({
      type: 'changed',
      target: 'cell:estimativa!E7',
      summary: 'R$ 5.775,00 para R$ 6.160,00.',
    });
  });

  it('has no lint warnings and projects names and settings', () => {
    expect(
      kind
        .lint(result.content as SheetContent, { locale: 'pt-BR', theme: defaultTheme })
        .filter((issue) => issue.severity === 'warning'),
    ).toEqual([]);
    const text = kind.project(result.content as SheetContent, { mode: 'full', locale: 'pt-BR' }).text;
    expect(text).toContain('Nomes: valor_hora=Parametros!$B$1, margem=Parametros!$B$2');
    expect(text).toContain('E10 =SUM(E2:E4) * (1 + margem) → 6930 [currency]');
  });
});
