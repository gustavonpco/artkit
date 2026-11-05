/* biome-ignore-all lint/suspicious/noArrayIndexKey: grid positions are fixed and never reordered. */
import type { EditorBindings, RenderContext } from '@artkit-ai/core';
import { useState } from 'react';
import { formatAddress } from '../a1.js';
import { findSheet, orderedSheets, type SheetData, type WorkbookContent } from '../model.js';
import type { SheetOperation } from '../operations.js';
import { displayCell } from '../read.js';

export interface SheetRendererProps {
  content: WorkbookContent;
  ctx: RenderContext;
  className?: string;
}

interface Bounds {
  rows: number;
  columns: number;
}

/** Used area of a sheet, with at least one row and column so an empty sheet still shows a grid. */
export function boundsOf(sheet: SheetData): Bounds {
  let rows = 1;
  let columns = 1;
  for (const [row, cells] of Object.entries(sheet.cellData)) {
    for (const [column, cell] of Object.entries(cells)) {
      if (cell.v === undefined && cell.f === undefined) continue;
      rows = Math.max(rows, Number(row) + 1);
      columns = Math.max(columns, Number(column) + 1);
    }
  }
  return { rows, columns };
}

function columnLabel(index: number): string {
  return formatAddress(0, index).replace(/1$/, '');
}

/** Shows a number with the thousands and decimals of its format (currency, percent, integer, decimal). */
export function formatNumber(value: unknown, pattern: string | undefined, locale: string): string {
  if (typeof value !== 'number' || !pattern)
    return value === undefined || value === null ? '' : String(value);
  const currency = /"R\$"|"\$"/.test(pattern);
  if (pattern.includes('%'))
    return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2 }).format(value);
  const fraction = pattern.includes('.00')
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 };
  const text = new Intl.NumberFormat(locale, fraction).format(value);
  if (!currency) return text;
  return `${locale.toLowerCase().startsWith('pt') ? 'R$' : '$'} ${text}`;
}

function numberPattern(cell: { s?: unknown }, workbook: WorkbookContent): string | undefined {
  const style =
    typeof cell.s === 'string'
      ? (workbook.styles[cell.s] as Record<string, unknown> | undefined)
      : (cell.s as Record<string, unknown> | undefined);
  return (style?.n as { pattern?: string } | undefined)?.pattern;
}

/** Read-only grid of every sheet with computed values; formulas are shown in the title of their cell. */
export function SheetRenderer({ content, ctx, className }: SheetRendererProps) {
  return (
    <div className={`ak-sheet${className ? ` ${className}` : ''}`}>
      {orderedSheets(content).map((sheet) => {
        const { rows, columns } = boundsOf(sheet);
        return (
          <section key={sheet.id} className="ak-sheet-tab" aria-label={sheet.name}>
            <h3>{sheet.name}</h3>
            <div className="ak-sheet-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col" aria-label="linha" />
                    {Array.from({ length: columns }, (_, c) => (
                      <th key={c} scope="col">
                        {columnLabel(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: rows }, (_, r) => (
                    <tr key={r}>
                      <th scope="row">{r + 1}</th>
                      {Array.from({ length: columns }, (_, c) => {
                        const cell = sheet.cellData[String(r)]?.[String(c)];
                        const text =
                          cell?.v !== undefined && cell?.v !== null && typeof cell.v === 'number'
                            ? formatNumber(cell.v, cell && numberPattern(cell, content), ctx.locale)
                            : (displayCell(cell) ?? '');
                        return (
                          <td key={c} title={cell?.f ? `=${cell.f.replace(/^=/, '')}` : undefined}>
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export type SheetEditOperation = SheetOperation | { op: 'replace_content'; content: WorkbookContent };

export interface SheetEditorProps extends EditorBindings<WorkbookContent, SheetEditOperation> {
  className?: string;
}

/**
 * Cell editor: each committed cell becomes one `set_values` operation on the sheet it belongs to. Formulas are typed
 * with a leading `=`. A full spreadsheet UI on Univer is not wired yet (see the v0.3 migration report).
 */
export function SheetEditor({ content, emit, readOnly, className }: SheetEditorProps) {
  const [sheetId, setSheetId] = useState(content.sheetOrder[0] ?? '');
  const sheet = findSheet(content, sheetId) ?? orderedSheets(content)[0];
  if (!sheet) return null;
  const { rows, columns } = boundsOf(sheet);
  const commit = (row: number, column: number, raw: string) => {
    const current = sheet.cellData[String(row)]?.[String(column)];
    const currentText = current?.f
      ? `=${current.f.replace(/^=/, '')}`
      : current?.v == null
        ? ''
        : String(current.v);
    if (raw === currentText) return;
    const value: string | number =
      raw.startsWith('=') || Number.isNaN(Number(raw)) || raw.trim() === '' ? raw : Number(raw);
    emit([{ op: 'set_values', sheet: sheet.id, at: formatAddress(row, column), values: [[value]] }], {
      kind: 'discrete',
    });
  };
  return (
    <div className={`ak-sheet ak-sheet-editor${className ? ` ${className}` : ''}`}>
      <div role="tablist" aria-label="Abas">
        {orderedSheets(content).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === sheet.id}
            onClick={() => setSheetId(tab.id)}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div className="ak-sheet-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-label="linha" />
              {Array.from({ length: columns + 1 }, (_, c) => (
                <th key={c} scope="col">
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows + 1 }, (_, r) => (
              <tr key={r}>
                <th scope="row">{r + 1}</th>
                {Array.from({ length: columns + 1 }, (_, c) => {
                  const cell = sheet.cellData[String(r)]?.[String(c)];
                  const shown = cell?.f
                    ? `=${cell.f.replace(/^=/, '')}`
                    : cell?.v == null
                      ? ''
                      : String(cell.v);
                  const label = `${sheet.name}!${formatAddress(r, c)}`;
                  return (
                    <td key={c}>
                      <input
                        aria-label={label}
                        defaultValue={shown}
                        readOnly={readOnly}
                        key={`${r}:${c}:${shown}`}
                        onBlur={(event) => commit(r, c, event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
