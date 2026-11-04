import { type RenderContext, resolveColor } from '@artkit/core';
import { Toolbar, ToolbarButton, ToolbarGroup } from '@artkit/react';
import { ChevronDown, ChevronUp, FunctionSquare, Search } from 'lucide-react';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { type CellPos, cellKey, formatRange, parseCellKey, parseRange } from '../address.js';
import { formatCellValue, formatNumber, isNumericDisplay, resolveCurrency } from '../display.js';
import type { Sheet, SheetContent } from '../schema.js';
import { cellCss, SheetGrid } from './grid.js';
import { highlightsFor } from './highlight.js';
import { findCells, rectOf, selectionStats } from './reading.js';

export interface SheetRendererProps {
  content: SheetContent;
  ctx: RenderContext;
  className?: string;
  /** Grid height in px for screen mode (default: fills the container, 480px when unsized). */
  height?: number;
}

export function sheetLabels(locale: string) {
  const pt = locale.toLowerCase().startsWith('pt');
  return {
    sheets: pt ? 'Abas' : 'Sheets',
    grid: (name: string) => (pt ? `Planilha ${name}` : `Sheet ${name}`),
    formulaBar: pt ? 'Barra de fórmulas' : 'Formula bar',
    cell: pt ? 'Célula' : 'Cell',
    provisional: pt ? 'Prévia provisória' : 'Provisional preview',
    reading: pt ? 'Leitura da planilha' : 'Sheet reading',
    find: pt ? 'Localizar na planilha' : 'Find in sheet',
    noMatches: pt ? 'Nenhum resultado' : 'No matches',
    previous: pt ? 'Resultado anterior' : 'Previous match',
    next: pt ? 'Próximo resultado' : 'Next match',
    view: pt ? 'Exibição' : 'View',
    showFormulas: pt ? 'Mostrar fórmulas' : 'Show formulas',
    sum: pt ? 'Soma' : 'Sum',
    average: pt ? 'Média' : 'Average',
    min: pt ? 'Mín.' : 'Min',
    max: pt ? 'Máx.' : 'Max',
    count: pt ? 'Contagem' : 'Count',
    hint: pt
      ? 'Shift+clique ou Shift+setas para selecionar um intervalo'
      : 'Shift+click or Shift+arrows to select a range',
  };
}

/** Moves a cell position with arrow/Home/End keys (read-only navigation). */
export function navigate(pos: CellPos, key: string, ctrl: boolean): CellPos | undefined {
  switch (key) {
    case 'ArrowUp':
      return { row: ctrl ? 0 : Math.max(0, pos.row - 1), col: pos.col };
    case 'ArrowDown':
      return { row: pos.row + 1, col: pos.col };
    case 'ArrowLeft':
      return { row: pos.row, col: ctrl ? 0 : Math.max(0, pos.col - 1) };
    case 'ArrowRight':
    case 'Tab':
      return { row: pos.row, col: pos.col + 1 };
    case 'Home':
      return { row: ctrl ? 0 : pos.row, col: 0 };
    default:
      return undefined;
  }
}

/** Static tables for print/headless export: every used cell, merges as spans, one table per sheet. */
function PrintSheet({ sheet, content, ctx }: { sheet: Sheet; content: SheetContent; ctx: RenderContext }) {
  const display = { locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) };
  let bottom = -1;
  let right = -1;
  for (const key of Object.keys(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    bottom = Math.max(bottom, pos.row);
    right = Math.max(right, pos.col);
  }
  const anchors = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const merge of sheet.merges ?? []) {
    const rect = parseRange(merge);
    if (!rect) continue;
    bottom = Math.max(bottom, rect.bottom);
    right = Math.max(right, rect.right);
    anchors.set(cellKey(rect.top, rect.left), {
      rows: rect.bottom - rect.top + 1,
      cols: rect.right - rect.left + 1,
    });
    for (let row = rect.top; row <= rect.bottom; row++) {
      for (let col = rect.left; col <= rect.right; col++)
        if (row !== rect.top || col !== rect.left) covered.add(cellKey(row, col));
    }
  }
  const header = Math.max(1, sheet.frozen?.rows ?? 1);
  const rows = Array.from({ length: bottom + 1 }, (_, row) => row);
  const cols = Array.from({ length: right + 1 }, (_, col) => col);
  const renderRow = (row: number) => (
    <tr key={row}>
      {cols.map((col) => {
        const key = cellKey(row, col);
        if (covered.has(key)) return null;
        const cell = sheet.cells[key];
        const span = anchors.get(key);
        const style = cellCss(cell, ctx);
        const textAlign = cell?.s?.align ?? (isNumericDisplay(cell?.v, cell?.fmt) ? 'right' : undefined);
        const props = {
          rowSpan: span && span.rows > 1 ? span.rows : undefined,
          colSpan: span && span.cols > 1 ? span.cols : undefined,
          style: {
            ...style,
            display: undefined,
            justifyContent: undefined,
            alignItems: undefined,
            textAlign,
          },
        };
        const text = formatCellValue(cell?.v, cell?.fmt, display);
        return row < header ? (
          <th key={key} scope="col" {...props}>
            {text}
          </th>
        ) : (
          <td key={key} {...props}>
            {text}
          </td>
        );
      })}
    </tr>
  );
  return (
    <section className="ak-sheet-print-sheet">
      <table className="ak-sheet-table">
        <caption>{sheet.name}</caption>
        {bottom >= 0 ? (
          <>
            <thead>{rows.slice(0, header).map(renderRow)}</thead>
            <tbody>{rows.slice(header).map(renderRow)}</tbody>
          </>
        ) : null}
      </table>
    </section>
  );
}

/**
 * Read-only spreadsheet view (spec §11.2): virtualized grid with tabs, merges, frozen panes, locale
 * formats and formula highlighting on selection. `ctx.mode === 'print'` renders static tables.
 */
export function SheetRenderer({ content, ctx, className, height }: SheetRendererProps) {
  const labels = sheetLabels(ctx.locale);
  const visible = useMemo(() => content.sheets.filter((sheet) => !sheet.hidden), [content.sheets]);
  const [sheetId, setSheetId] = useState(visible[0]?.id ?? content.sheets[0]?.id);
  const [active, setActive] = useState<CellPos>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<CellPos | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [showFormulas, setShowFormulas] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sheet = visible.find((candidate) => candidate.id === sheetId) ?? visible[0] ?? content.sheets[0]!;
  const classes = ['ak-sheet', ctx.provisional ? 'ak-sheet-provisional' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  if (ctx.mode === 'print') {
    return (
      <div className={`${classes} ak-sheet-print`}>
        {visible.map((item) => (
          <PrintSheet key={item.id} sheet={item} content={content} ctx={ctx} />
        ))}
      </div>
    );
  }

  const activeKey = cellKey(active.row, active.col);
  const activeCell = sheet.cells[activeKey];
  const formula = activeCell?.f;
  const display = { locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) };
  const highlights = formula ? highlightsFor(formula, sheet.name, sheet.name) : [];
  const hits = query ? findCells(sheet, query, display) : [];
  const hitIndex = hits.findIndex((hit) => hit.row === active.row && hit.col === active.col);
  const goToHit = (step: number) => {
    if (hits.length === 0) return;
    const next = hits[(Math.max(hitIndex, step > 0 ? -1 : 0) + step + hits.length) % hits.length]!;
    setActive(next);
    setAnchor(next);
  };
  const selected = rectOf(anchor ?? active, active);
  const stats = selectionStats(sheet, selected);
  const accent = resolveColor(ctx.theme, 'warning');
  const searchHighlights = hits.slice(0, 500).map((hit) => ({
    rect: { top: hit.row, bottom: hit.row, left: hit.col, right: hit.col },
    color: accent,
  }));
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    const next = navigate(
      active,
      event.key === 'Tab' && event.shiftKey ? 'ArrowLeft' : event.key,
      event.ctrlKey || event.metaKey,
    );
    if (!next) return;
    event.preventDefault();
    if (event.shiftKey && event.key !== 'Tab') setAnchor(anchor ?? active);
    else setAnchor(undefined);
    setActive(next);
  };
  const panelId = `ak-sheet-panel-${sheet.id}`;
  const number = (value: number) =>
    formatNumber(value, activeCell?.fmt === 'currency' ? 'currency' : undefined, display);

  return (
    <div className={classes} aria-busy={ctx.provisional || undefined}>
      <Toolbar label={labels.reading} className="ak-sheet-reading" sticky={false}>
        <ToolbarGroup label={labels.find}>
          <label className="ak-sheet-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={labels.find}
              aria-label={labels.find}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToHit(event.shiftKey ? -1 : 1);
                }
              }}
            />
            {query ? (
              <span className="ak-sheet-search-count" aria-live="polite">
                {hits.length === 0 ? labels.noMatches : `${hitIndex >= 0 ? hitIndex + 1 : 0}/${hits.length}`}
              </span>
            ) : null}
          </label>
          <ToolbarButton
            icon={ChevronUp}
            label={labels.previous}
            disabled={hits.length === 0}
            onClick={() => goToHit(-1)}
            keepFocus={false}
          />
          <ToolbarButton
            icon={ChevronDown}
            label={labels.next}
            disabled={hits.length === 0}
            onClick={() => goToHit(1)}
            keepFocus={false}
          />
        </ToolbarGroup>
        <ToolbarGroup label={labels.view}>
          <ToolbarButton
            icon={FunctionSquare}
            label={labels.showFormulas}
            shortcut="Ctrl+`"
            pressed={showFormulas}
            onClick={() => setShowFormulas(!showFormulas)}
            keepFocus={false}
          />
        </ToolbarGroup>
      </Toolbar>
      <fieldset className="ak-sheet-formula-bar">
        <legend className="ak-sheet-sr-only">{labels.formulaBar}</legend>
        <output className="ak-sheet-address" aria-label={labels.cell}>
          {anchor ? formatRange(selected) : activeKey}
        </output>
        <output className="ak-sheet-formula-text" aria-live="polite">
          {formula !== undefined ? `=${formula}` : formatCellValue(activeCell?.v, activeCell?.fmt, display)}
        </output>
      </fieldset>
      <div id={panelId} role="tabpanel" className="ak-sheet-panel">
        <SheetGrid
          content={content}
          sheet={sheet}
          ctx={ctx}
          label={labels.grid(sheet.name)}
          selection={{ ranges: [selected], active }}
          highlights={[...searchHighlights, ...highlights]}
          showFormulas={showFormulas}
          {...(height ? { height } : {})}
          onCellMouseDown={(pos, event) => {
            if (event.shiftKey) setAnchor(anchor ?? active);
            else setAnchor(undefined);
            setActive(pos);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === '`') {
              event.preventDefault();
              setShowFormulas(!showFormulas);
              return;
            }
            onKeyDown(event);
          }}
        />
      </div>
      <output className="ak-sheet-statusbar" aria-live="polite">
        {stats.numbers > 1 || (anchor && stats.count > 0) ? (
          <>
            {stats.numbers > 0 ? (
              <>
                <span>{`${labels.sum}: ${number(stats.sum)}`}</span>
                <span>{`${labels.average}: ${number(stats.average ?? 0)}`}</span>
                <span>{`${labels.min}: ${number(stats.min ?? 0)}`}</span>
                <span>{`${labels.max}: ${number(stats.max ?? 0)}`}</span>
              </>
            ) : null}
            <span>{`${labels.count}: ${stats.count}`}</span>
          </>
        ) : (
          <span>{labels.hint}</span>
        )}
      </output>
      {visible.length > 1 ? (
        <div className="ak-sheet-tabs" role="tablist" aria-label={labels.sheets}>
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === sheet.id}
              aria-controls={panelId}
              className="ak-sheet-tab"
              onClick={() => {
                setSheetId(item.id);
                setActive({ row: 0, col: 0 });
                setAnchor(undefined);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      {ctx.provisional ? <span className="ak-sheet-provisional-label">{labels.provisional}</span> : null}
    </div>
  );
}
