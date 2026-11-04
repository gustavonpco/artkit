// @vitest-environment jsdom
import {
  applyOperations,
  createRegistry,
  defaultTheme,
  type EmitOptions,
  type LintIssue,
  type RenderContext,
} from '@artkit/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetEditor } from '../src/edit/index.js';
import { type SheetContent, type SheetOperation, sheetKind } from '../src/index.js';
import { book } from './helpers.js';

afterEach(cleanup);

const registry = createRegistry({ kinds: [sheetKind] });
const ctx: RenderContext = { theme: defaultTheme, locale: 'en-US', mode: 'screen' };

type Emitted = { operations: SheetOperation[]; options?: EmitOptions };

function Harness(props: { initial: SheetContent; log: Emitted[]; readOnly?: boolean; lint?: LintIssue[] }) {
  const [content, setContent] = useState(props.initial);
  return (
    <SheetEditor
      content={content}
      ctx={ctx}
      readOnly={props.readOnly ?? false}
      {...(props.lint ? { lint: props.lint } : {})}
      emit={(operations, options) => {
        props.log.push({ operations, ...(options ? { options } : {}) });
        // Optimistic apply through the kind, as the host does.
        setContent(
          (current) =>
            applyOperations(
              registry,
              { kind: 'sheet', content: current, title: 'T', themeId: 'default', locale: 'en' },
              operations,
            ).content as SheetContent,
        );
      }}
    />
  );
}

function setup(
  initial = book({ Data: { A1: 1, A2: 2, B1: 'x' } }),
  extra: { readOnly?: boolean; lint?: LintIssue[] } = {},
) {
  const log: Emitted[] = [];
  render(<Harness initial={initial} log={log} {...extra} />);
  const grid = screen.getByRole('grid');
  return { log, grid, ops: () => log.flatMap((entry) => entry.operations) };
}

const cell = (key: string) => document.querySelector(`[data-cell="${key}"]`) as HTMLElement;
const cellInput = () => screen.getByRole('textbox', { name: /^Cell editor/ }) as HTMLInputElement;

describe('SheetEditor typing', () => {
  it('typing a value and Enter emits one set_cells and moves down', () => {
    const { log, grid } = setup();
    fireEvent.keyDown(grid, { key: '4' });
    fireEvent.change(cellInput(), { target: { value: '42.5' } });
    fireEvent.keyDown(cellInput(), { key: 'Enter' });
    expect(log).toEqual([
      {
        operations: [{ op: 'set_cells', sheet: 's1', cells: { A1: { v: 42.5 } } }],
        options: { kind: 'typing' },
      },
    ]);
    expect(screen.getByLabelText('Cell').textContent).toBe('A2');
    expect(cell('A1').textContent).toBe('42.5');
  });

  it('formulas show a live preview and invalid ones keep the editor open', () => {
    const { log } = setup();
    fireEvent.doubleClick(cell('C1'));
    fireEvent.change(cellInput(), { target: { value: '=SUM(A1:A2)*2', selectionStart: 13 } });
    expect(screen.getByLabelText('Result').textContent).toBe('= 6');
    fireEvent.keyDown(cellInput(), { key: 'Tab' });
    expect(log[0]!.operations).toEqual([
      { op: 'set_cells', sheet: 's1', cells: { C1: { f: 'SUM(A1:A2)*2' } } },
    ]);
    expect(cell('C1').textContent).toBe('6');
    fireEvent.doubleClick(cell('C2'));
    fireEvent.change(cellInput(), { target: { value: '=WEBSERVICE("x")' } });
    fireEvent.keyDown(cellInput(), { key: 'Enter' });
    expect(log).toHaveLength(1);
    expect(document.querySelector('.ak-sheet-status')!.textContent).toMatch(/not allowed/);
    fireEvent.keyDown(cellInput(), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: /^Cell editor/ })).toBeNull();
  });

  it('autocompletes supported functions and inserts references by pointing', () => {
    setup();
    fireEvent.doubleClick(cell('C1'));
    fireEvent.change(cellInput(), { target: { value: '=su', selectionStart: 3 } });
    const options = within(screen.getByRole('listbox', { name: 'Functions' })).getAllByRole('option');
    expect(options.map((option) => option.textContent?.split(' ')[0])).toEqual([
      'SUM(number1,',
      'SUMIF(range,',
      'SUMIFS(sum_range,',
    ]);
    fireEvent.keyDown(cellInput(), { key: 'Tab' });
    expect(cellInput().value).toBe('=SUM(');
    expect(screen.getByText(/Adds numbers and ranges/)).toBeTruthy();
    fireEvent.mouseDown(cell('A1'));
    fireEvent.mouseEnter(cell('A2'));
    fireEvent.mouseUp(window);
    expect(cellInput().value).toBe('=SUM(A1:A2');
    expect(document.querySelectorAll('.ak-sheet-highlight')).toHaveLength(1);
  });

  it('readOnly emits nothing', () => {
    const { log, grid } = setup(undefined, { readOnly: true });
    fireEvent.keyDown(grid, { key: 'a' });
    fireEvent.keyDown(grid, { key: 'Delete' });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /^Cell editor/ })).toBeNull();
    expect(log).toEqual([]);
  });
});

describe('SheetEditor selection and clipboard', () => {
  it('Delete clears the selected ranges', () => {
    const { ops, grid } = setup();
    fireEvent.mouseDown(cell('A1'));
    fireEvent.mouseEnter(cell('B2'));
    fireEvent.mouseUp(window);
    fireEvent.keyDown(grid, { key: 'Delete' });
    expect(ops()).toEqual([{ op: 'clear_range', sheet: 's1', range: 'A1:B2', what: 'contents' }]);
  });

  it('pastes TSV and HTML as set_cells', () => {
    const { ops, grid } = setup();
    fireEvent.mouseDown(cell('C3'));
    fireEvent.paste(grid, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? '1\t2\n3\t=C3+1' : '') },
    });
    expect(ops()[0]).toEqual({
      op: 'set_cells',
      sheet: 's1',
      cells: { C3: { v: 1 }, D3: { v: 2 }, C4: { v: 3 }, D4: { f: 'C3+1' } },
    });
    fireEvent.mouseDown(cell('A5'));
    fireEvent.paste(grid, {
      clipboardData: {
        getData: (type: string) => (type === 'text/html' ? '<table><tr><td>5%</td></tr></table>' : 'ignored'),
      },
    });
    expect(ops()[1]).toEqual({ op: 'set_cells', sheet: 's1', cells: { A5: { v: 0.05, fmt: 'percent' } } });
  });

  it('copies cells and pastes formulas with shifted references', () => {
    const { ops, grid } = setup(book({ Data: { A1: 1, B1: '=A1*2' } }));
    const store = new Map<string, string>();
    fireEvent.mouseDown(cell('B1'));
    fireEvent.copy(grid, {
      clipboardData: { setData: (type: string, value: string) => store.set(type, value), getData: () => '' },
    });
    expect(store.get('text/plain')).toBe('2');
    expect(store.get('text/html')).toContain('<td>2</td>');
    fireEvent.mouseDown(cell('B3'));
    fireEvent.paste(grid, { clipboardData: { getData: (type: string) => store.get(type) ?? '' } });
    expect(ops()[0]).toEqual({
      op: 'set_cells',
      sheet: 's1',
      cells: { B3: { f: 'A3*2', fmt: null, s: null, note: null } },
    });
  });

  it('fill handle drag emits one continuous fill_range', () => {
    const { log } = setup(book({ Data: { A1: 1, B1: '=A1*2' } }));
    fireEvent.mouseDown(cell('B1'));
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(screen.getByTestId('fill-handle'));
    fireEvent.mouseEnter(cell('B4'));
    expect(document.querySelector('.ak-sheet-fill-preview')).toBeTruthy();
    fireEvent.mouseUp(window);
    expect(log).toEqual([
      {
        operations: [{ op: 'fill_range', sheet: 's1', source: 'B1', target: 'B1:B4' }],
        options: { kind: 'continuous' },
      },
    ]);
  });

  it('column resize emits one continuous set_column_width', () => {
    const { log } = setup();
    const handle = document.querySelector('.ak-sheet-col-resize') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 170 });
    fireEvent.mouseUp(window);
    expect(log).toEqual([
      {
        operations: [{ op: 'set_column_width', sheet: 's1', column: 'A', count: 1, width: 20 }],
        options: { kind: 'continuous' },
      },
    ]);
  });
});

describe('SheetEditor toolbar and sheets', () => {
  it('formats, styles and structural actions emit operations', () => {
    const { ops } = setup();
    fireEvent.mouseDown(cell('A1'));
    fireEvent.mouseEnter(cell('A2'));
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Number format' }), {
      target: { value: 'currency' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Fill color/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Surface' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borders' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Outside borders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rows and columns' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row above' }));
    fireEvent.click(screen.getByRole('button', { name: 'Freeze panes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Freeze panes at the active cell' }));
    expect(ops()).toEqual([
      { op: 'set_range_style', sheet: 's1', range: 'A1:A2', style: { bold: true } },
      { op: 'set_range_format', sheet: 's1', range: 'A1:A2', fmt: 'currency' },
      { op: 'set_range_style', sheet: 's1', range: 'A1:A2', style: { background: 'surface' } },
      {
        op: 'set_cells',
        sheet: 's1',
        cells: {
          A1: { s: { border: { top: 'thin', left: 'thin', right: 'thin' } } },
          A2: { s: { border: { bottom: 'thin', left: 'thin', right: 'thin' } } },
        },
      },
      { op: 'insert_rows', sheet: 's1', at: 1, count: 2 },
      { op: 'set_frozen', sheet: 's1', rows: 0, cols: 0 },
    ]);
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('applies text styles, AutoSum, sort and notes from the toolbar', () => {
    const { ops } = setup();
    fireEvent.mouseDown(cell('A1'));
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Font size' }), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vertical alignment' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Middle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sort descending by the active column' }));
    expect(ops().slice(0, 3)).toEqual([
      { op: 'set_range_style', sheet: 's1', range: 'A1', style: { underline: true } },
      { op: 'set_range_style', sheet: 's1', range: 'A1', style: { fontSize: 14 } },
      { op: 'set_range_style', sheet: 's1', range: 'A1', style: { valign: 'middle' } },
    ]);
    expect(ops()[3]).toMatchObject({
      op: 'sort_range',
      sheet: 's1',
      by: [{ column: 'A', descending: true }],
    });
  });

  it('merges after clearing hidden content', () => {
    const { ops } = setup();
    fireEvent.mouseDown(cell('A1'));
    fireEvent.mouseEnter(cell('B1'));
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Merge cells' }));
    expect(ops()).toEqual([
      { op: 'set_cells', sheet: 's1', cells: { B1: { v: null, f: null } } },
      { op: 'merge_cells', sheet: 's1', range: 'A1:B1' },
    ]);
    expect(cell('A1').getAttribute('aria-colspan')).toBe('2');
  });

  it('adds, renames, reorders and deletes sheets (with confirmation)', () => {
    const { ops } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add sheet' }));
    expect(ops()[0]).toEqual({ op: 'add_sheet', name: 'Sheet2' });
    expect(screen.getByRole('tab', { name: 'Sheet2' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'Sheet2' }));
    const input = screen.getByRole('textbox', { name: 'Rename sheet' });
    fireEvent.change(input, { target: { value: 'Resumo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ops()[1]).toEqual({ op: 'rename_sheet', sheet: 'sheet2', name: 'Resumo' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Resumo' }), {
      key: 'ArrowLeft',
      altKey: true,
      shiftKey: true,
    });
    expect(ops()[2]).toEqual({ op: 'move_sheet', sheet: 'sheet2', position: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Delete sheet' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Resumo');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ops()[3]).toEqual({ op: 'remove_sheet', sheet: 'sheet2' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Data']);
  });

  it('drags tabs to reorder', () => {
    const { ops } = setup(book({ A: { A1: 1 }, B: { A1: 2 } }));
    fireEvent.dragStart(screen.getByRole('tab', { name: 'B' }));
    fireEvent.drop(screen.getByRole('tab', { name: 'A' }));
    expect(ops()).toEqual([{ op: 'move_sheet', sheet: 's2', position: 1 }]);
  });

  it('offers a dropdown for validated cells', () => {
    const content = book({ Data: { A1: 'Open' } });
    content.sheets[0]!.validations = [{ range: 'A1:A5', values: ['Open', 'Closed'] }];
    const { ops } = setup(content);
    const select = screen.getByRole('combobox', { name: 'Allowed values A1' });
    fireEvent.change(select, { target: { value: 'Closed' } });
    expect(ops()).toEqual([{ op: 'set_cells', sheet: 's1', cells: { A1: { v: 'Closed', f: null } } }]);
  });

  it('manages named ranges in a dialog', () => {
    const { ops } = setup();
    fireEvent.mouseDown(cell('A2'));
    fireEvent.click(screen.getByRole('button', { name: 'Named ranges' }));
    const dialog = screen.getByRole('dialog');
    expect((screen.getByRole('textbox', { name: 'Reference' }) as HTMLInputElement).value).toBe('Data!$A$2');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'rate' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(ops()).toEqual([{ op: 'set_name', name: 'rate', ref: 'Data!$A$2' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove rate' }));
    expect(ops()[1]).toEqual({ op: 'remove_name', name: 'rate' });
  });

  it('shows lint markers and error explanations', () => {
    const content = book({ Data: { A1: '=1/0', B1: '123' } });
    setup(content, {
      lint: [
        {
          code: 'number-as-text',
          severity: 'warning',
          target: 'cell:s1!B1',
          message: 'B1 stores a number as text.',
        },
      ],
    });
    expect(cell('B1').querySelector('.ak-sheet-lint-mark')).toBeTruthy();
    expect(document.querySelector('.ak-sheet-status')!.textContent).toBe('A1 #DIV/0!: division by zero');
    fireEvent.mouseDown(cell('B1'));
    expect(document.querySelector('.ak-sheet-status')!.textContent).toBe('B1: B1 stores a number as text.');
  });

  it('keyboard: arrows, Ctrl+arrows, Shift extend and F2', () => {
    const emit = vi.fn();
    render(
      <SheetEditor content={book({ S: { A1: 1, A2: 2, A3: 3 } })} ctx={ctx} readOnly={false} emit={emit} />,
    );
    const grid = screen.getByRole('grid');
    act(() => grid.focus());
    fireEvent.keyDown(grid, { key: 'ArrowDown', ctrlKey: true });
    expect(screen.getByLabelText('Cell').textContent).toBe('A3');
    fireEvent.keyDown(grid, { key: 'ArrowUp', shiftKey: true });
    expect(screen.getByLabelText('Cell').textContent).toBe('A2:A3');
    fireEvent.keyDown(grid, { key: 'F2' });
    expect(cellInput().value).toBe('3');
    expect(emit).not.toHaveBeenCalled();
  });
});
