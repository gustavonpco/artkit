import type { KindInstructions } from '@artkit/core';
import { FUNCTIONS } from './formula/functions.js';

const byCategory = (category: string) =>
  [...FUNCTIONS.values()]
    .filter((spec) => spec.category === category)
    .map((spec) => spec.name)
    .join(', ');

const estimate = {
  sheets: [
    {
      id: 'parametros',
      name: 'Parametros',
      cells: {
        A1: { v: 'Valor hora', s: { bold: true } },
        B1: { v: 150, fmt: 'currency' },
        A2: { v: 'Margem', s: { bold: true } },
        B2: { v: 0.2, fmt: 'percent' },
      },
    },
    {
      id: 'estimativa',
      name: 'Estimativa',
      frozen: { rows: 1, cols: 0 },
      columns: { A: { width: 24 } },
      cells: {
        A1: { v: 'Atividade', s: { bold: true } },
        B1: { v: 'Grupo', s: { bold: true } },
        C1: { v: 'Horas', s: { bold: true } },
        D1: { v: 'Subtotal', s: { bold: true } },
        A2: { v: 'Login' },
        B2: { v: 'Construção' },
        C2: { v: 10 },
        D2: { f: 'C2*valor_hora', fmt: 'currency' },
        A3: { v: 'Relatórios' },
        B3: { v: 'Construção' },
        C3: { v: 20.5 },
        D3: { f: 'C3*valor_hora', fmt: 'currency' },
        A4: { v: 'Total', s: { bold: true } },
        C4: { f: 'SUM(C2:C3)' },
        D4: { f: 'SUM(D2:D3)', fmt: 'currency', s: { bold: true } },
      },
    },
  ],
  names: [
    { name: 'valor_hora', ref: 'Parametros!$B$1' },
    { name: 'margem', ref: 'Parametros!$B$2' },
  ],
};

export const sheetInstructions: KindInstructions = {
  summary:
    'Spreadsheet workbook: sheets with cells keyed by A1 address, Excel-style formulas recalculated by the engine, named formats and styles, merges, frozen panes, named ranges and dropdown validations. Use it for estimates, budgets, simple schedules, trackers and calculated tables.',
  rules: [
    'Operations reference sheets by id ("sheet": "estimativa"); formulas reference sheets by name (Estimativa!C2, \'My sheet\'!A1:A9).',
    'A cell is {v, f, fmt, s, note}. Write formulas in "f" without "=" (a leading "=" is accepted); never write "v" for formula cells: the engine computes and caches it.',
    `Supported functions only: ${byCategory('math')}; ${byCategory('logical')}; ${byCategory('lookup')}; ${byCategory('text')}; ${byCategory('date')}. Anything else (SUMPRODUCT, INDIRECT, WEBSERVICE, macros) is rejected.`,
    'Operators: + - * / ^ & = <> < > <= >= and postfix %. Criteria strings like ">10", "<>x", "a*" work in SUMIF/SUMIFS/COUNTIF/COUNTIFS. Whole columns (C:C) and rows (2:2) are allowed.',
    'Formats (fmt): general, integer, decimal2, percent (0.2 shows 20%), currency (currency of the locale or settings.currency), date, datetime, text. Write dates as ISO strings ("2026-11-09"): they are stored as date serials with fmt date.',
    'Put parameters (rates, margins) in cells and give them names with set_name; use the name in formulas (C2*valor_hora).',
    'Write one model formula and copy it with fill_range {source: "D2", target: "D2:D40"}: relative references shift per row, $A$1 stays fixed. This is much shorter than one set_cells entry per row.',
    'Totals must be formulas (SUM, SUMIF for totals by group), never typed numbers. Lint warns on literal totals, numbers stored as text, references to empty cells and narrow columns.',
    'TODAY() returns settings.calculationDate (set it with set_settings); without it TODAY() is #N/A, because formulas never read the clock.',
    'insert_rows/delete_rows/insert_columns/delete_columns and rename_sheet rewrite every affected formula; references to deleted cells become #REF!.',
    'Like Excel, inserting rows inside a referenced range expands it (SUM(C2:C3) + insert at 3 → SUM(C2:C4)), but inserting right below its last row does not: insert above the last data row, or update the totals in the same batch.',
    'Read large workbooks with mode "outline" first, then "range" like "Estimativa!A1:F40". Circular references and unknown sheets or names are rejected with the cell path.',
  ],
  examples: [
    { title: 'Estimate with parameters, computed column and totals', content: estimate },
    {
      title: 'Add rows, fill a computed column and total by group',
      content: estimate,
      operations: [
        { op: 'insert_rows', sheet: 'estimativa', at: 3, count: 1 },
        {
          op: 'set_cells',
          sheet: 'estimativa',
          cells: { A3: { v: 'Treinamento' }, B3: { v: 'Implantação' }, C3: { v: 8 } },
        },
        { op: 'fill_range', sheet: 'estimativa', source: 'D2', target: 'D3' },
        {
          op: 'set_cells',
          sheet: 'estimativa',
          cells: {
            F1: { v: 'Grupo', s: { bold: true } },
            G1: { v: 'Subtotal', s: { bold: true } },
            F2: { v: 'Construção' },
            G2: { f: 'SUMIF(B:B,F2,D:D)', fmt: 'currency' },
            F3: { v: 'Implantação' },
            G3: { f: 'SUMIF(B:B,F3,D:D)', fmt: 'currency' },
            F4: { v: 'Total com margem' },
            G4: { f: 'D5*(1+margem)', fmt: 'currency' },
          },
        },
        { op: 'set_column_width', sheet: 'estimativa', column: 'F', width: 18 },
      ],
    },
    {
      title: 'Create a sheet with a dropdown and a dated schedule',
      operations: [
        {
          op: 'add_sheet',
          name: 'Cronograma',
          cells: {
            A1: { v: 'Tarefa', s: { bold: true } },
            B1: { v: 'Início', s: { bold: true } },
            C1: { v: 'Fim', s: { bold: true } },
            D1: { v: 'Dias úteis', s: { bold: true } },
            E1: { v: 'Status', s: { bold: true } },
            A2: { v: 'Descoberta' },
            B2: { v: '2026-11-02' },
            C2: { v: '2026-11-06' },
            D2: { f: 'NETWORKDAYS(B2,C2)' },
            E2: { v: 'Em andamento' },
          },
          frozen: { rows: 1, cols: 0 },
        },
        {
          op: 'set_validation',
          sheet: 'cronograma',
          range: 'E2:E50',
          values: ['A fazer', 'Em andamento', 'Concluído'],
        },
        { op: 'set_settings', calculationDate: '2026-11-04' },
      ],
    },
  ],
};
