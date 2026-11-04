// @vitest-environment jsdom
import { defaultTheme, type RenderContext } from '@artkit-ai/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { serialFromIso } from '../src/index.js';
import { formulaReferences, indexAt, SheetLayout, SheetRenderer, sheetCss } from '../src/react/index.js';
import { book } from './helpers.js';

afterEach(cleanup);

const ctx = (locale = 'pt-BR', mode: RenderContext['mode'] = 'screen'): RenderContext => ({
  theme: defaultTheme,
  locale,
  mode,
});

const content = book(
  {
    Resumo: {
      A1: { v: 'Perfil', s: { bold: true } },
      B1: { v: 'Total', s: { bold: true } },
      A2: 'Dev',
      B2: { v: 1500, fmt: 'currency' },
      A3: 'QA',
      B3: { v: 750.5, fmt: 'currency' },
      A4: 'Total',
      B4: { f: 'SUM(B2:B3)', fmt: 'currency' },
      C2: { v: 0.15, fmt: 'percent' },
      C3: { v: serialFromIso('2026-11-09')!, fmt: 'date' },
      C4: { f: '1/0' },
      A6: 'Mesclada',
    },
    Dados: { A1: 'Outra aba' },
    Oculta: { A1: 'x' },
  },
  {},
);
content.sheets[0]!.merges = ['A6:C6'];
content.sheets[0]!.frozen = { rows: 1, cols: 1 };
content.sheets[2]!.hidden = true;

const cell = (key: string) => document.querySelector(`[data-cell="${key}"]`) as HTMLElement;

describe('layout', () => {
  it('computes offsets, windows and merges', () => {
    const layout = new SheetLayout({
      id: 's',
      name: 'S',
      cells: { B3: { v: 1 } },
      columns: { A: { width: 20 } },
      rows: { '2': { height: 30 } },
      merges: ['C1:D2'],
    });
    expect(layout.colWidth(0)).toBe(145);
    expect(layout.rowHeight(1)).toBe(40);
    expect(indexAt(layout.colOffsets, 146)).toBe(1);
    expect(layout.merges.covered.get('D2')).toBe('C1');
    const window = layout.window(0, 0, 300, 100, 0);
    expect(window.rows[0]).toBe(0);
    expect(window.cols).toContain(1);
    expect(layout.rowCount).toBeGreaterThanOrEqual(100);
  });

  it('colors formula references consistently', () => {
    const refs = formulaReferences('=SUM(A1:A3)+A1+Dados!B2', 'Resumo');
    expect(refs.map((ref) => [ref.sheet, ref.start])).toEqual([
      ['Resumo', 5],
      ['Resumo', 12],
      ['Dados', 15],
    ]);
    expect(refs[0]!.color).not.toBe(refs[1]!.color);
    expect(formulaReferences('=A1+(', 'S')).toHaveLength(1);
  });
});

describe('SheetRenderer', () => {
  it('renders an accessible grid with locale formats', () => {
    render(<SheetRenderer content={content} ctx={ctx()} />);
    const grid = screen.getByRole('grid', { name: 'Planilha Resumo' });
    expect(grid.getAttribute('aria-rowcount')).toBe('101');
    expect(within(grid).getAllByRole('columnheader')[0]!.textContent).toBe('A');
    expect(cell('B2').textContent).toMatch(/R\$\s1\.500,00/);
    expect(cell('C2').textContent).toBe('15%');
    expect(cell('C3').textContent).toBe('09/11/2026');
    expect(cell('C4').textContent).toBe('#DIV/0!');
    expect(cell('C4').title).toMatch(/divisão por zero/);
    expect(cell('A1').style.fontWeight).toBe('700');
    expect(cell('B2').style.justifyContent).toBe('flex-end');
  });

  it('renders merges as one cell and keeps frozen rows marked', () => {
    render(<SheetRenderer content={content} ctx={ctx('en-US')} />);
    expect(cell('A6').getAttribute('aria-colspan')).toBe('3');
    expect(cell('B6')).toBeNull();
    expect(cell('A1').parentElement!.className).toContain('ak-sheet-row-frozen');
    expect(cell('B2').textContent).toBe('$1,500.00');
  });

  it('shows the formula and highlights its references when a cell is selected', () => {
    render(<SheetRenderer content={content} ctx={ctx()} />);
    fireEvent.mouseDown(cell('B4'));
    expect(screen.getByRole('group', { name: 'Barra de fórmulas' }).textContent).toContain('=SUM(B2:B3)');
    expect(document.querySelectorAll('.ak-sheet-highlight')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowUp' });
    expect(screen.getByRole('group', { name: 'Barra de fórmulas' }).textContent).toContain('B3');
  });

  it('switches visible sheets with tabs', () => {
    render(<SheetRenderer content={content} ctx={ctx()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Resumo', 'Dados']);
    fireEvent.click(tabs[1]!);
    expect(screen.getByRole('grid', { name: 'Planilha Dados' })).toBeTruthy();
    expect(cell('A1').textContent).toBe('Outra aba');
  });

  it('print mode renders semantic tables with headers', () => {
    const { container } = render(<SheetRenderer content={content} ctx={ctx('pt-BR', 'print')} />);
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    expect(tables[0]!.querySelector('caption')!.textContent).toBe('Resumo');
    expect(tables[0]!.querySelectorAll('th[scope="col"]')).toHaveLength(3);
    expect(tables[0]!.querySelector('td[colspan="3"]')!.textContent).toBe('Mesclada');
    expect(container.querySelector('[role="grid"]')).toBeNull();
  });

  it('exports CSS with the ak-sheet prefix', () => {
    expect(sheetCss).toContain('.ak-sheet-cell');
    expect(sheetCss).toContain('var(--ak-color-accent');
  });
});
