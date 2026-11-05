// @vitest-environment jsdom

import { defaultTheme } from '@artkit-ai/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkbook, type WorkbookContent } from '../src/index.js';
import { formatNumber, SheetEditor, SheetRenderer } from '../src/react/index.js';

afterEach(cleanup);

const workbook: WorkbookContent = {
  ...emptyWorkbook('wb', 'Estimativa', 'pt-BR'),
  sheetOrder: ['est'],
  sheets: {
    est: {
      id: 'est',
      name: 'Estimativa',
      rowCount: 10,
      columnCount: 5,
      cellData: {
        '0': { '0': { v: 'Perfil' }, '1': { v: 'Horas' }, '2': { v: 'Total' } },
        '1': { '0': { v: 'Tech Lead' }, '1': { v: 120 }, '2': { f: '=B2*165', v: 19800, s: 'money' } },
      },
    },
  },
  styles: { money: { n: { pattern: '"R$" #,##0.00' } } },
};

const ctx = { theme: defaultTheme, locale: 'pt-BR', mode: 'screen' as const };

describe('sheet react', () => {
  it('formats numbers with the locale and currency pattern', () => {
    expect(formatNumber(19800, '"R$" #,##0.00', 'pt-BR')).toBe('R$ 19.800,00');
    expect(formatNumber(0.25, '0.00%', 'pt-BR')).toContain('25');
  });

  it('renders each sheet as a grid with computed values and the formula as a title', () => {
    render(<SheetRenderer content={workbook} ctx={ctx} />);
    expect(screen.getByRole('heading', { name: 'Estimativa' })).toBeTruthy();
    const total = screen.getByText('R$ 19.800,00');
    expect(total.getAttribute('title')).toBe('=B2*165');
  });

  it('emits one set_values operation when a cell is committed with a new value', () => {
    const emit = vi.fn();
    render(<SheetEditor content={workbook} ctx={ctx} readOnly={false} lint={[]} emit={emit} />);
    const input = screen.getByLabelText('Estimativa!B2') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '130' } });
    fireEvent.blur(input);
    expect(emit).toHaveBeenCalledWith([{ op: 'set_values', sheet: 'est', at: 'B2', values: [[130]] }], {
      kind: 'discrete',
    });
  });

  it('does not emit when the cell keeps its value', () => {
    const emit = vi.fn();
    render(<SheetEditor content={workbook} ctx={ctx} readOnly={false} lint={[]} emit={emit} />);
    const input = screen.getByLabelText('Estimativa!B2');
    fireEvent.blur(input);
    expect(emit).not.toHaveBeenCalled();
  });
});
