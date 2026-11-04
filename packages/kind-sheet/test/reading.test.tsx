// @vitest-environment jsdom
import { defaultTheme, type RenderContext } from '@artkit/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SheetRenderer } from '../src/react/index.js';
import { findCells, selectionStats } from '../src/react/reading.js';
import { book } from './helpers.js';

afterEach(cleanup);

const ctx: RenderContext = { theme: defaultTheme, locale: 'en', mode: 'screen' };
const content = book({
  Plan: {
    A1: 'Name',
    B1: 'Hours',
    A2: 'Ana Souza',
    B2: 10,
    A3: 'Bruno',
    B3: 20,
    A4: 'Total',
    B4: '=SUM(B2:B3)',
  },
});

describe('sheet reading helpers', () => {
  it('computes selection statistics over numbers only', () => {
    expect(selectionStats(content.sheets[0]!, { top: 0, bottom: 3, left: 1, right: 1 })).toEqual({
      count: 4,
      numbers: 3,
      sum: 60,
      average: 20,
      min: 10,
      max: 30,
    });
  });

  it('finds text, values and formulas ignoring case and accents', () => {
    const sheet = content.sheets[0]!;
    const display = { locale: 'en', currency: 'USD' };
    expect(findCells(sheet, 'SOUZA', display)).toEqual([{ row: 1, col: 0 }]);
    expect(findCells(sheet, 'sum(', display)).toEqual([{ row: 3, col: 1 }]);
    expect(findCells(sheet, '   ', display)).toEqual([]);
  });
});

describe('SheetRenderer reading features', () => {
  it('searches with a match counter and moves the active cell', () => {
    render(<SheetRenderer content={content} ctx={ctx} />);
    const search = screen.getByRole('searchbox', { name: 'Find in sheet' });
    fireEvent.change(search, { target: { value: 'bruno' } });
    expect(screen.getByText('0/1')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('1/1')).toBeTruthy();
    expect(screen.getByLabelText('Cell').textContent).toBe('A3');
  });

  it('toggles formulas and shows statistics for a Shift-extended range', () => {
    render(<SheetRenderer content={content} ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show formulas' }));
    expect(screen.getByText('=SUM(B2:B3)')).toBeTruthy();
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByLabelText('Cell').textContent).toBe('B2:B3');
    expect(screen.getByText('Sum: 30')).toBeTruthy();
    expect(screen.getByText('Count: 2')).toBeTruthy();
  });
});
