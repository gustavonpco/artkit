import { ArtifactError, applyOperations, createRegistry, defaultTheme, prepareContent } from '@artkit/core';
import { defineKindConformanceTests } from '@artkit/core/testing';
import { describe, expect, it } from 'vitest';
import { createSheetKind, type SheetContent, serialFromIso, sheetKind } from '../src/index.js';

const registry = createRegistry({ kinds: [sheetKind] });

const base = {
  sheets: [
    {
      id: 'resumo',
      name: 'Resumo',
      cells: {
        A1: { v: 'Perfil' },
        B1: { v: 'Horas' },
        C1: { v: 'Valor hora' },
        D1: { v: 'Total' },
        A2: { v: 'Tech Lead' },
        B2: { f: "SUMIF('Estimativa 2'!A:A,A2,'Estimativa 2'!B:B)" },
        C2: { v: 165, fmt: 'currency' },
        D2: { f: 'B2*C2', fmt: 'currency' },
        A3: { v: 'Dev' },
        B3: { f: "SUMIF('Estimativa 2'!A:A,A3,'Estimativa 2'!B:B)" },
        C3: { v: 120, fmt: 'currency' },
        D3: { f: 'B3*C3', fmt: 'currency' },
        A4: { v: 'Total' },
        D4: { f: 'SUM(D2:D3)', fmt: 'currency' },
      },
      merges: ['E1:F1'],
    },
    {
      id: 'est',
      name: 'Estimativa 2',
      cells: {
        A1: { v: 'Tech Lead' },
        B1: { v: 100 },
        A2: { v: 'Dev' },
        B2: { v: 300 },
        A3: { v: 'Tech Lead' },
        B3: { v: 20 },
      },
    },
  ],
} satisfies Record<string, unknown>;

function prepared(raw: unknown = base): SheetContent {
  return prepareContent(registry, 'sheet', raw).content as SheetContent;
}

function apply(content: SheetContent, operations: unknown[], locale = 'en') {
  return applyOperations(
    registry,
    { kind: 'sheet', content, title: 'T', themeId: 'default', locale },
    operations,
  );
}

function applied(content: SheetContent, operations: unknown[]): SheetContent {
  return apply(content, operations).content as SheetContent;
}

function rejection(content: SheetContent, operations: unknown[], locale = 'en'): ArtifactError {
  try {
    apply(content, operations, locale);
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

const sheetOf = (content: SheetContent, id: string) => content.sheets.find((sheet) => sheet.id === id)!;

defineKindConformanceTests(
  sheetKind,
  [
    {
      title: 'summary with cross-sheet SUMIF',
      content: base,
      batches: [
        [{ op: 'set_cells', sheet: 'est', cells: { B2: { v: 310 } } }],
        [
          { op: 'insert_rows', sheet: 'resumo', at: 3 },
          { op: 'rename_sheet', sheet: 'est', name: 'Estimativa' },
        ],
      ],
      rejects: [
        {
          operations: [{ op: 'set_cells', sheet: 'nope', cells: { A1: { v: 1 } } }],
          code: 'OPERATION_FAILED',
        },
        {
          operations: [{ op: 'set_cells', sheet: 'resumo', cells: { A1: { f: 'WEBSERVICE("x")' } } }],
          code: 'OPERATION_FAILED',
        },
        {
          operations: [
            { op: 'set_cells', sheet: 'resumo', cells: { A1: { f: 'D4' } } },
            { op: 'set_cells', sheet: 'resumo', cells: { D4: { f: 'A1' } } },
          ],
          code: 'INVALID_CONTENT',
        },
        { operations: [{ op: 'bogus' }], code: 'INVALID_OPERATION' },
      ],
    },
  ],
  { describe, it },
);

describe('content preparation', () => {
  it('recalculates formulas and caches values', () => {
    const content = prepared();
    const resumo = sheetOf(content, 'resumo');
    expect(resumo.cells.B2!.v).toBe(120);
    expect(resumo.cells.D2!.v).toBe(19800);
    expect(resumo.cells.D4!.v).toBe(19800 + 36000);
  });

  it('normalizes ids, cell keys, "=" formulas and ISO dates', () => {
    const content = prepared({
      sheets: [
        {
          name: 'Orçamento Geral',
          cells: {
            a1: { v: '=1+1' },
            b1: { f: '=sum(1,2)' },
            C1: { v: '2026-11-04' },
            D1: { v: '2026-11-04', fmt: 'text' },
          },
        },
      ],
    });
    const sheet = content.sheets[0]!;
    expect(sheet.id).toBe('orcamento-geral');
    expect(sheet.cells.A1).toEqual({ f: '1+1', v: 2 });
    expect(sheet.cells.B1).toEqual({ f: 'SUM(1,2)', v: 3 });
    expect(sheet.cells.C1).toEqual({ v: serialFromIso('2026-11-04'), fmt: 'date' });
    expect(sheet.cells.D1).toEqual({ v: '2026-11-04', fmt: 'text' });
  });

  it('rejects invalid integrity with content paths', () => {
    const bad = (raw: unknown) => {
      try {
        prepared(raw);
      } catch (error) {
        return (error as ArtifactError).issues.map((issue) => issue.path);
      }
      return [];
    };
    expect(bad({ sheets: [{ id: 'a', name: 'A', cells: { A1: { f: 'Nope!B1' } } }] })).toEqual([
      'content.sheets[0].cells.A1.f',
    ]);
    expect(bad({ sheets: [{ id: 'a', name: 'A', cells: { A1: { f: 'B1' }, B1: { f: 'A1' } } }] })[0]).toMatch(
      /cells\.A1\.f/,
    );
    expect(bad({ sheets: [{ id: 'a', name: 'A', cells: {}, merges: ['A1:B2', 'B2:C3'] }] })).toEqual([
      'content.sheets[0].merges[1]',
    ]);
    expect(
      bad({
        sheets: [
          { id: 'a', name: 'A', cells: {} },
          { id: 'b', name: 'a', cells: {} },
        ],
      }),
    ).toEqual(['content.sheets[1].name']);
    expect(
      bad({ sheets: [{ id: 'a', name: 'A', cells: {} }], names: [{ name: 'x', ref: 'Zz!A1' }] }),
    ).toEqual(['content.names[0].ref']);
    expect(bad({ sheets: [{ id: 'a', name: 'A', cells: { A1: { f: 'taxa*2' } } }] })).toEqual([
      'content.sheets[0].cells.A1.f',
    ]);
    expect(
      bad({
        sheets: [
          {
            id: 'a',
            name: 'A',
            cells: {},
            validations: [
              { range: 'A1:A5', values: ['x'] },
              { range: 'A5:B5', values: ['y'] },
            ],
          },
        ],
      }),
    ).toEqual(['content.sheets[0].validations[1].range']);
  });

  it('enforces limits', () => {
    const kind = createSheetKind();
    const small = createRegistry({ kinds: [kind], limits: { sheet: { cells: 3 } } });
    expect(() =>
      prepareContent(small, 'sheet', {
        sheets: [{ id: 'a', name: 'A', cells: { A1: { v: 1 }, A2: { v: 1 }, A3: { v: 1 }, A4: { v: 1 } } }],
      }),
    ).toThrow(/cells/);
    const tooFar = rejection(prepared(), [
      { op: 'set_cells', sheet: 'resumo', cells: { A100001: { v: 1 } } },
    ]);
    expect(tooFar.code).toBe('OPERATION_FAILED');
  });
});

describe('operations', () => {
  it('set_cells merges patches, removes with null and turns "=" text into formulas', () => {
    const content = applied(prepared(), [
      {
        op: 'set_cells',
        sheet: 'resumo',
        cells: { C2: { v: 200 }, C3: { fmt: null }, E5: { v: '=C2*2', s: { bold: true } }, A4: null },
      },
    ]);
    const resumo = sheetOf(content, 'resumo');
    expect(resumo.cells.C2).toEqual({ v: 200, fmt: 'currency' });
    expect(resumo.cells.C3).toEqual({ v: 120 });
    expect(resumo.cells.E5).toEqual({ f: 'C2*2', v: 400, s: { bold: true } });
    expect(resumo.cells.A4).toBeUndefined();
    expect(resumo.cells.D2!.v).toBe(24000);
  });

  it('set_cells rejects bad formulas at the operation path', () => {
    const error = rejection(prepared(), [
      { op: 'set_cells', sheet: 'resumo', cells: { A9: { f: 'SUMPRODUCT(A1:A2)' } } },
    ]);
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues[0]!.path).toBe('operations[0].cells.A9.f');
    expect(error.issues[0]!.hint).toMatch(/SUMIFS/);
    const pt = rejection(prepared(), [{ op: 'set_cells', sheet: 'x', cells: { A1: { v: 1 } } }], 'pt-BR');
    expect(pt.issues[0]!.message).toMatch(/não existe/);
  });

  it('set_range_style, set_range_format and clear_range', () => {
    let content = applied(prepared(), [
      { op: 'set_range_style', sheet: 'est', range: 'A1:B2', style: { bold: true, background: 'surface' } },
      { op: 'set_range_format', sheet: 'est', range: 'B1:B3', fmt: 'integer' },
    ]);
    expect(sheetOf(content, 'est').cells.A2).toEqual({ v: 'Dev', s: { bold: true, background: 'surface' } });
    expect(sheetOf(content, 'est').cells.B3!.fmt).toBe('integer');
    content = applied(content, [
      { op: 'set_range_style', sheet: 'est', range: 'A1:A2', style: { bold: null } },
      { op: 'clear_range', sheet: 'est', range: 'B1:B2' },
    ]);
    expect(sheetOf(content, 'est').cells.A1!.s).toEqual({ background: 'surface' });
    expect(sheetOf(content, 'est').cells.B1).toEqual({
      fmt: 'integer',
      s: { bold: true, background: 'surface' },
    });
    content = applied(content, [{ op: 'clear_range', sheet: 'est', range: 'A1:B3', what: 'all' }]);
    expect(Object.keys(sheetOf(content, 'est').cells)).toEqual([]);
    expect(
      rejection(prepared(), [
        { op: 'set_range_style', sheet: 'est', range: 'A1:ZZ99999', style: { bold: true } },
      ]).issues[0]!.path,
    ).toBe('operations[0].range');
  });

  it('insert_rows shifts cells, ranges, merges and references on other sheets', () => {
    const start = applied(prepared(), [
      { op: 'set_cells', sheet: 'est', cells: { D1: { f: 'SUM(B1:B3)' }, D2: { f: 'Resumo!D4' } } },
      { op: 'set_validation', sheet: 'est', range: 'A1:A3', values: ['Tech Lead', 'Dev'] },
      { op: 'set_row_height', sheet: 'est', row: 3, height: 30 },
    ]);
    const content = applied(start, [{ op: 'insert_rows', sheet: 'est', at: 2, count: 2 }]);
    const est = sheetOf(content, 'est');
    expect(est.cells.A4!.v).toBe('Dev');
    expect(est.cells.D1!.f).toBe('SUM(B1:B5)');
    expect(est.cells.D4!.f).toBe('Resumo!D4');
    expect(est.validations).toEqual([{ range: 'A1:A5', values: ['Tech Lead', 'Dev'] }]);
    expect(est.rows).toEqual({ '5': { height: 30 } });
    expect(sheetOf(content, 'resumo').cells.D4!.v).toBe(19800 + 36000);
  });

  it('delete_rows turns references to deleted cells into #REF!', () => {
    const start = applied(prepared(), [
      {
        op: 'set_cells',
        sheet: 'resumo',
        cells: { F2: { f: 'C3+1' }, F3: { f: 'SUM(C2:C3)' }, F4: { f: 'C2' } },
      },
    ]);
    const content = applied(start, [{ op: 'delete_rows', sheet: 'resumo', at: 3 }]);
    const resumo = sheetOf(content, 'resumo');
    expect(resumo.cells.F2!.f).toBe('#REF!+1');
    expect(resumo.cells.F2!.v).toEqual({ error: '#REF!' });
    expect(resumo.cells.F3).toEqual({ f: 'C2', v: 165 });
    expect(resumo.cells.F4).toBeUndefined();
    expect(resumo.cells.D3!.f).toBe('SUM(D2:D2)');
    expect(resumo.cells.D3!.v).toBe(19800);
  });

  it('insert_columns and delete_columns shift columns, widths and merges', () => {
    let content = applied(prepared(), [{ op: 'set_column_width', sheet: 'resumo', column: 'C', width: 20 }]);
    content = applied(content, [{ op: 'insert_columns', sheet: 'resumo', at: 'B' }]);
    const resumo = sheetOf(content, 'resumo');
    expect(resumo.cells.E2!.f).toBe('C2*D2');
    expect(resumo.columns).toEqual({ D: { width: 20 } });
    expect(resumo.merges).toEqual(['F1:G1']);
    content = applied(content, [{ op: 'delete_columns', sheet: 'resumo', at: 'F', count: 1 }]);
    expect(sheetOf(content, 'resumo').merges).toBeUndefined();
    expect(sheetOf(content, 'resumo').cells.E4!.f).toBe('SUM(E2:E3)');
  });

  it('manages sheets: add, rename (rewrites refs), move, hide, remove', () => {
    let content = applied(prepared(), [
      { op: 'add_sheet', name: 'Notas Finais', position: 1, cells: { A1: { v: "='Estimativa 2'!B2*2" } } },
      { op: 'rename_sheet', sheet: 'est', name: 'Base' },
    ]);
    expect(content.sheets.map((sheet) => sheet.id)).toEqual(['notas-finais', 'resumo', 'est']);
    expect(sheetOf(content, 'notas-finais').cells.A1).toEqual({ f: 'Base!B2*2', v: 600 });
    expect(sheetOf(content, 'resumo').cells.B2!.f).toBe('SUMIF(Base!A:A,A2,Base!B:B)');
    content = applied(content, [
      { op: 'move_sheet', sheet: 'notas-finais', position: 3 },
      { op: 'set_sheet_hidden', sheet: 'resumo', hidden: true },
    ]);
    expect(content.sheets.map((sheet) => sheet.id)).toEqual(['resumo', 'est', 'notas-finais']);
    expect(sheetOf(content, 'resumo').hidden).toBe(true);
    content = applied(content, [{ op: 'remove_sheet', sheet: 'est' }]);
    expect(sheetOf(content, 'notas-finais').cells.A1).toEqual({ f: '#REF!*2', v: { error: '#REF!' } });
    expect(rejection(content, [{ op: 'add_sheet', name: 'RESUMO' }]).issues[0]!.path).toBe(
      'operations[0].name',
    );
    expect(rejection(content, [{ op: 'add_sheet', id: 'resumo', name: 'Outra' }]).issues[0]!.path).toBe(
      'operations[0].id',
    );
    const single = prepared({ sheets: [{ id: 'a', name: 'A', cells: {} }] });
    expect(rejection(single, [{ op: 'remove_sheet', sheet: 'a' }]).code).toBe('OPERATION_FAILED');
    expect(rejection(single, [{ op: 'set_sheet_hidden', sheet: 'a', hidden: true }]).code).toBe(
      'OPERATION_FAILED',
    );
  });

  it('merges and unmerges', () => {
    let content = applied(prepared(), [{ op: 'merge_cells', sheet: 'est', range: 'C1:D2' }]);
    expect(sheetOf(content, 'est').merges).toEqual(['C1:D2']);
    expect(rejection(content, [{ op: 'merge_cells', sheet: 'est', range: 'D2:E3' }]).issues[0]!.hint).toMatch(
      /Unmerge C1:D2/,
    );
    expect(
      rejection(content, [{ op: 'merge_cells', sheet: 'est', range: 'A1:B1' }]).issues[0]!.message,
    ).toMatch(/B1 has content/);
    content = applied(content, [{ op: 'unmerge_cells', sheet: 'est', range: 'D2' }]);
    expect(sheetOf(content, 'est').merges).toBeUndefined();
    expect(rejection(content, [{ op: 'unmerge_cells', sheet: 'est', range: 'A1' }]).code).toBe(
      'OPERATION_FAILED',
    );
  });

  it('layout: widths, heights, frozen panes', () => {
    const content = applied(prepared(), [
      { op: 'set_column_width', sheet: 'est', column: 'A', count: 2, width: 30 },
      { op: 'set_row_height', sheet: 'est', row: 1, height: 24 },
      { op: 'set_frozen', sheet: 'est', rows: 1, cols: 1 },
    ]);
    const est = sheetOf(content, 'est');
    expect(est.columns).toEqual({ A: { width: 30 }, B: { width: 30 } });
    expect(est.rows).toEqual({ '1': { height: 24 } });
    expect(est.frozen).toEqual({ rows: 1, cols: 1 });
    const reset = sheetOf(
      applied(content, [
        { op: 'set_frozen', sheet: 'est', rows: 0, cols: 0 },
        { op: 'set_column_width', sheet: 'est', column: 'A', count: 2, width: null },
      ]),
      'est',
    );
    expect(reset.frozen).toBeUndefined();
    expect(reset.columns).toBeUndefined();
  });

  it('named ranges: set, use, protect from removal while used', () => {
    let content = applied(prepared(), [
      { op: 'set_name', name: 'taxa', ref: "'Estimativa 2'!B2" },
      { op: 'set_cells', sheet: 'resumo', cells: { F1: { f: 'taxa/2' } } },
    ]);
    expect(content.names).toEqual([{ name: 'taxa', ref: "'Estimativa 2'!$B$2" }]);
    expect(sheetOf(content, 'resumo').cells.F1!.v).toBe(150);
    expect(rejection(content, [{ op: 'remove_name', name: 'TAXA' }]).issues[0]!.message).toMatch(/Resumo!F1/);
    expect(rejection(content, [{ op: 'set_name', name: 'AB1', ref: 'Resumo!A1' }]).issues[0]!.path).toBe(
      'operations[0].name',
    );
    expect(rejection(content, [{ op: 'set_name', name: 'x', ref: 'A1' }]).issues[0]!.path).toBe(
      'operations[0].ref',
    );
    content = applied(content, [
      { op: 'set_cells', sheet: 'resumo', cells: { F1: null } },
      { op: 'remove_name', name: 'taxa' },
    ]);
    expect(content.names).toBeUndefined();
  });

  it('set_validation replaces overlapping portions', () => {
    let content = applied(prepared(), [
      { op: 'set_validation', sheet: 'est', range: 'A1:A10', values: ['Dev', 'Tech Lead'] },
    ]);
    content = applied(content, [
      { op: 'set_validation', sheet: 'est', range: 'A4:A5', values: ['QA'], allowBlank: false },
    ]);
    expect(sheetOf(content, 'est').validations).toEqual([
      { range: 'A1:A3', values: ['Dev', 'Tech Lead'] },
      { range: 'A6:A10', values: ['Dev', 'Tech Lead'] },
      { range: 'A4:A5', values: ['QA'], allowBlank: false },
    ]);
    content = applied(content, [{ op: 'set_validation', sheet: 'est', range: 'A1:A10', values: null }]);
    expect(sheetOf(content, 'est').validations).toBeUndefined();
  });

  it('fill_range copies the model cell adjusting relative references', () => {
    const content = applied(prepared(), [
      { op: 'set_cells', sheet: 'est', cells: { C1: { f: 'B1*$B$1', fmt: 'integer', note: 'model' } } },
      { op: 'fill_range', sheet: 'est', source: 'C1', target: 'C1:C3' },
      { op: 'set_cells', sheet: 'est', cells: { E1: { v: 1 }, E2: { v: 'x' } } },
      { op: 'fill_range', sheet: 'est', source: 'E1:E2', target: 'F1:G4' },
    ]);
    const est = sheetOf(content, 'est');
    expect(est.cells.C1).toEqual({ f: 'B1*$B$1', v: 10000, fmt: 'integer', note: 'model' });
    expect(est.cells.C3).toEqual({ f: 'B3*$B$1', v: 2000, fmt: 'integer' });
    expect(est.cells.G3!.v).toBe(1);
    expect(est.cells.G4!.v).toBe('x');
  });

  it('set_settings drives TODAY()', () => {
    let content = applied(prepared(), [
      { op: 'set_cells', sheet: 'est', cells: { C1: { f: 'TODAY()', fmt: 'date' } } },
    ]);
    expect(sheetOf(content, 'est').cells.C1!.v).toEqual({ error: '#N/A' });
    content = applied(content, [{ op: 'set_settings', calculationDate: '2026-11-04', currency: 'EUR' }]);
    expect(sheetOf(content, 'est').cells.C1!.v).toBe(46330);
    expect(content.settings).toEqual({ calculationDate: '2026-11-04', currency: 'EUR' });
    expect(rejection(content, [{ op: 'set_settings', calculationDate: '2026-02-30' }]).issues[0]!.path).toBe(
      'operations[0].calculationDate',
    );
  });

  it('targets use sheet ids and cell addresses', () => {
    expect(sheetKind.targets!({ op: 'set_cells', sheet: 'est', cells: { b2: { v: 1 } } })).toEqual([
      'sheet:est',
      'cell:est!B2',
    ]);
    expect(sheetKind.targets!({ op: 'insert_rows', sheet: 'est', at: 2, count: 1 })).toEqual(['sheet:est']);
    expect(sheetKind.targets!({ op: 'set_name', name: 'taxa', ref: 'A!A1' })).toEqual(['name:TAXA']);
  });
});

describe('projection', () => {
  const content = prepared({ ...base, names: [{ name: 'taxa', ref: 'Resumo!$C$2' }] });

  it('full: header per sheet and rows with formula → value [fmt]', () => {
    const { text } = sheetKind.project(content, { mode: 'full', locale: 'en' });
    expect(text).toContain('Sheet "Resumo" (id: resumo) A1:D4');
    expect(text).toContain(
      "A2 \"Tech Lead\" | B2 =SUMIF('Estimativa 2'!A:A,A2,'Estimativa 2'!B:B) → 120 | C2 165 [currency] | D2 =B2*C2 → 19800 [currency]",
    );
    expect(text).toContain('Names: taxa=Resumo!$C$2');
    expect(sheetKind.project(content, { mode: 'full', locale: 'pt-BR' }).text).toContain(
      'Aba "Resumo" (id: resumo)',
    );
  });

  it('outline, range and budget with cursor', () => {
    const outline = sheetKind.project(content, { mode: 'outline', locale: 'en' }).text;
    expect(outline).toContain('Sheet "Estimativa 2" (id: est) A1:B3 — 6 cell(s), 0 formula(s)');
    const range = sheetKind.project(content, {
      mode: 'range',
      range: "'Estimativa 2'!A2:B3",
      locale: 'en',
    }).text;
    expect(range).toContain('A2 "Dev" | B2 300');
    expect(range).not.toContain('A1 "Tech Lead"');
    expect(sheetKind.project(content, { mode: 'range', range: 'est', locale: 'en' }).text).toContain(
      'A1 "Tech Lead"',
    );
    expect(sheetKind.project(content, { mode: 'range', range: 'zz!A1', locale: 'en' }).text).toMatch(
      /not found/,
    );
    const first = sheetKind.project(content, { mode: 'full', locale: 'en', maxTokens: 40 });
    expect(first.truncated).toBe(true);
    expect(first.remainingOutline).toContain('Resumo!');
    const next = sheetKind.project(content, {
      mode: 'full',
      locale: 'en',
      maxTokens: 4000,
      cursor: first.cursor!,
    });
    expect(next.truncated).toBe(false);
  });

  it('shows dates as ISO and errors by code', () => {
    const dated = prepared({
      sheets: [{ id: 'a', name: 'A', cells: { A1: { v: '2026-11-09' }, A2: { f: '1/0' } } }],
    });
    const { text } = sheetKind.project(dated, { mode: 'full', locale: 'en' });
    expect(text).toContain('A1 2026-11-09 [date]');
    expect(text).toContain('A2 =1/0 → #DIV/0!');
  });
});

describe('lint', () => {
  const lint = (raw: unknown, locale = 'en') =>
    sheetKind.lint(prepared(raw), { locale, theme: defaultTheme });

  it('reports the spec rules with cell targets', () => {
    const issues = lint({
      sheets: [
        {
          id: 'a',
          name: 'A',
          cells: {
            A1: { v: 'Item' },
            B1: { v: 'Valor' },
            A2: { v: 'x' },
            B2: { v: '123' },
            C2: { f: 'Z9*2' },
            A3: { v: 'Total' },
            B3: { v: 500 },
            D1: { f: 'TODAY()' },
            E1: { v: 'A very long description that overflows' },
            F1: { v: 'next' },
            G1: { v: 123456789012, fmt: 'currency' },
            H1: { f: '1/0' },
            I1: { v: 'Maybe' },
          },
          validations: [{ range: 'I1:I5', values: ['Yes', 'No'] }],
        },
      ],
    });
    const codes = issues.map((issue) => `${issue.code}@${issue.target}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'number-as-text@cell:a!B2',
        'formula-empty-ref@cell:a!C2',
        'total-without-formula@cell:a!B3',
        'today-without-date@cell:a!D1',
        'column-too-narrow@cell:a!E1',
        'column-too-narrow@cell:a!G1',
        'formula-error@cell:a!H1',
        'validation-mismatch@cell:a!I1',
      ]),
    );
    expect(
      lint({ sheets: [{ id: 'a', name: 'A', cells: { B2: { v: '123' } } }] }, 'pt-BR')[0]!.message,
    ).toMatch(/como texto/);
  });

  it('is quiet for a clean sheet', () => {
    expect(
      lint({
        sheets: [{ id: 'a', name: 'A', cells: { A1: { v: 1 }, A2: { v: 2 }, A3: { f: 'SUM(A1:A2)' } } }],
      }),
    ).toEqual([]);
  });
});

describe('diff', () => {
  it('summarizes value changes formatted by locale', () => {
    const kind = createSheetKind({ locale: 'pt-BR' });
    const reg = createRegistry({ kinds: [kind] });
    const before = prepareContent(reg, 'sheet', base).content as SheetContent;
    const after = applyOperations(
      reg,
      { kind: 'sheet', content: before, title: 'T', themeId: 'default', locale: 'pt-BR' },
      [{ op: 'set_cells', sheet: 'est', cells: { B2: { v: 310 } } }],
    ).content as SheetContent;
    const diff = kind.diff(before, after);
    expect(diff).toContainEqual({ type: 'changed', target: 'cell:est!B2', summary: '300 para 310.' });
    expect(diff).toContainEqual({
      type: 'changed',
      target: 'cell:resumo!D3',
      summary: 'R$ 36.000,00 para R$ 37.200,00.',
    });
  });

  it('reports sheets, layout, names, settings and bulk changes', () => {
    const before = prepared();
    const after = applied(before, [
      { op: 'rename_sheet', sheet: 'est', name: 'Base' },
      { op: 'set_frozen', sheet: 'resumo', rows: 1, cols: 0 },
      { op: 'set_name', name: 'x', ref: 'Resumo!A1' },
      { op: 'set_settings', currency: 'USD' },
      { op: 'add_sheet', id: 'big', name: 'Big' },
    ]);
    const targets = sheetKind.diff(before, after).map((change) => `${change.type} ${change.target}`);
    expect(targets).toEqual(
      expect.arrayContaining([
        'changed sheet:est',
        'changed layout:resumo',
        'added name:X',
        'changed settings',
        'added sheet:big',
      ]),
    );
    const cells = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`A${i + 1}`, { v: i }]));
    const bulk = sheetKind.diff(after, applied(after, [{ op: 'set_cells', sheet: 'big', cells }]));
    expect(bulk).toEqual([{ type: 'changed', target: 'sheet:big', summary: '60 cells changed in A1:A60.' }]);
  });
});

describe('inputs', () => {
  it('table infers types per locale and column formats', () => {
    const content = sheetKind.inputs!.table!.toContent(
      {
        header: ['Atividade', 'Início', 'Horas', 'Taxa', 'Valor', 'Ativo'],
        rows: [
          ['Login', '09/11/2026', '10', '15%', 'R$ 1.500,00', 'VERDADEIRO'],
          ['Relatórios', '16/11/2026', '20,5', '12,5%', 'R$ 3.075,00', 'falso'],
          ['Total', null, '=SUM(C2:C3)', null, null, null],
        ],
      },
      { locale: 'pt-BR' },
    );
    const sheet = content.sheets[0]!;
    expect(sheet.name).toBe('Planilha1');
    expect(sheet.frozen).toEqual({ rows: 1, cols: 0 });
    expect(sheet.cells.A1).toEqual({ v: 'Atividade', s: { bold: true, background: 'surface' } });
    expect(sheet.cells.B2).toEqual({ v: serialFromIso('2026-11-09'), fmt: 'date' });
    expect(sheet.cells.C3).toEqual({ v: 20.5 });
    expect(sheet.cells.D3).toEqual({ v: 0.125, fmt: 'percent' });
    expect(sheet.cells.E2).toEqual({ v: 1500, fmt: 'currency' });
    expect(sheet.cells.F3).toEqual({ v: false });
    expect(sheet.cells.C4).toEqual({ f: 'SUM(C2:C3)' });
    expect(prepared(content).sheets[0]!.cells.C4!.v).toBe(30.5);
  });

  it('csv detects the delimiter and handles quotes', () => {
    const content = sheetKind.inputs!.csv!.toContent('name;amount\n"Smith; John";"1,5"\r\n"Say ""hi""";2\n', {
      locale: 'pt-BR',
    });
    const cells = content.sheets[0]!.cells;
    expect(cells.A2!.v).toBe('Smith; John');
    expect(cells.B2!.v).toBe(1.5);
    expect(cells.A3!.v).toBe('Say "hi"');
    const noHeader = sheetKind.inputs!.csv!.toContent(
      { text: 'a,1\nb,2', header: false, name: 'Dados' },
      { locale: 'en' },
    );
    expect(noHeader.sheets[0]!.cells.A1).toEqual({ v: 'a' });
    expect(noHeader.sheets[0]!.cells.B2).toEqual({ v: 2 });
    expect(() => sheetKind.inputs!.csv!.toContent({ text: '' }, { locale: 'en' })).toThrow(ArtifactError);
  });
});

describe('parsePartial', () => {
  it('drops incomplete sheets and cells and computes values', () => {
    const partial = sheetKind.parsePartial({
      sheets: [
        { id: 'a', name: 'A', cells: { A1: { v: 2 }, A2: { f: 'A1*3' }, A3: { v: { nope: true } } } },
        { id: 'b', cells: { A1: { v: 1 } } },
      ],
    });
    expect(partial?.sheets).toHaveLength(1);
    expect(partial!.sheets[0]!.cells.A2!.v).toBe(6);
    expect(partial!.sheets[0]!.cells.A3).toBeUndefined();
    expect(sheetKind.parsePartial({ sheets: [] })).toBeUndefined();
    expect(sheetKind.parsePartial('x')).toBeUndefined();
  });
});
