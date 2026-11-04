import { type RenderContext, resolveColor } from '@artkit-ai/core';
import {
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type CellPos, cellKey, columnLetter, formatRange, type Rect, rectContains } from '../address.js';
import { formatCellValue, isNumericDisplay, resolveCurrency } from '../display.js';
import { explainError } from '../lint.js';
import { type Cell, isErrorValue, type Sheet, type SheetContent } from '../schema.js';
import { HEADER_HEIGHT, ROW_HEADER_WIDTH, SheetLayout } from './layout.js';

export interface GridSelection {
  ranges: Rect[];
  active: CellPos;
}

export interface GridHighlight {
  rect: Rect;
  color: string;
}

export interface SheetGridProps {
  content: SheetContent;
  sheet: Sheet;
  ctx: RenderContext;
  /** Accessible name of the grid. */
  label: string;
  selection?: GridSelection;
  highlights?: GridHighlight[];
  /** Lint messages by cell key, shown as corner markers. */
  marks?: ReadonlyMap<string, string>;
  /** Element rendered over the active cell (in-cell editor). */
  editor?: { pos: CellPos; node: ReactNode };
  /** Shows the fill handle at the bottom-right corner of the selection. */
  fillHandle?: boolean;
  /** Dashed preview of a fill target while dragging the handle. */
  fillPreview?: Rect;
  height?: number;
  /** Show formulas instead of their values (reading aid, like Ctrl+` in spreadsheets). */
  showFormulas?: boolean;
  gridRef?: Ref<HTMLTableElement>;
  onCellMouseDown?(pos: CellPos, event: MouseEvent): void;
  onCellMouseEnter?(pos: CellPos, event: MouseEvent): void;
  onCellDoubleClick?(pos: CellPos): void;
  onHeaderMouseDown?(axis: 'row' | 'col', index: number, event: MouseEvent): void;
  onResizeMouseDown?(axis: 'row' | 'col', index: number, event: MouseEvent): void;
  onFillMouseDown?(event: MouseEvent): void;
  onKeyDown?(event: KeyboardEvent<HTMLTableElement>): void;
  onCopy?(event: ClipboardEvent<HTMLTableElement>): void;
  onCut?(event: ClipboardEvent<HTMLTableElement>): void;
  onPaste?(event: ClipboardEvent<HTMLTableElement>): void;
}

const DEFAULT_VIEW = { width: 960, height: 480 };
const BORDER_WIDTH: Record<string, string> = {
  thin: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
  dashed: '1px dashed',
  dotted: '1px dotted',
  double: '3px double',
};

/** Inline style of a cell from its stored style (colors through the theme). */
export function cellCss(cell: Cell | undefined, ctx: RenderContext): CSSProperties {
  const style: CSSProperties = {};
  const s = cell?.s;
  if (isNumericDisplay(cell?.v, cell?.fmt)) style.justifyContent = 'flex-end';
  if (!s) return style;
  if (s.bold) style.fontWeight = 700;
  if (s.italic) style.fontStyle = 'italic';
  const decoration = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  if (decoration) style.textDecoration = decoration;
  if (s.fontSize) style.fontSize = `${s.fontSize}pt`;
  if (s.color) style.color = resolveColor(ctx.theme, s.color);
  if (s.background) style.background = resolveColor(ctx.theme, s.background);
  if (s.align)
    style.justifyContent = s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center';
  if (s.align) style.textAlign = s.align;
  if (s.valign)
    style.alignItems = s.valign === 'top' ? 'flex-start' : s.valign === 'middle' ? 'center' : 'flex-end';
  if (s.wrap) {
    style.whiteSpace = 'pre-wrap';
    style.overflowWrap = 'anywhere';
  }
  if (s.border) {
    const color = s.border.color ? resolveColor(ctx.theme, s.border.color) : resolveColor(ctx.theme, 'text');
    if (s.border.top) style.borderTop = `${BORDER_WIDTH[s.border.top]} ${color}`;
    if (s.border.right) style.borderRight = `${BORDER_WIDTH[s.border.right]} ${color}`;
    if (s.border.bottom) style.borderBottom = `${BORDER_WIDTH[s.border.bottom]} ${color}`;
    if (s.border.left) style.borderLeft = `${BORDER_WIDTH[s.border.left]} ${color}`;
  }
  return style;
}

function useViewport(element: HTMLDivElement | null): { width: number; height: number } {
  const [size, setSize] = useState(DEFAULT_VIEW);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth || DEFAULT_VIEW.width;
      const height = element.clientHeight || DEFAULT_VIEW.height;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * Virtualized DOM grid shared by the renderer and the editor: only the visible window (plus frozen rows and
 * columns) is rendered, cells are absolutely positioned from prefix sums, merges render as one cell.
 */
export function SheetGrid(props: SheetGridProps) {
  const { content, sheet, ctx, selection } = props;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const view = useViewport(scroller);
  const layout = useMemo(
    () =>
      new SheetLayout(sheet, {
        rows: (selection?.active.row ?? 0) + 20,
        cols: (selection?.active.col ?? 0) + 5,
      }),
    [sheet, selection?.active.row, selection?.active.col],
  );
  const display = useMemo(
    () => ({ locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) }),
    [content, ctx.locale],
  );
  const window = layout.window(
    scroll.top,
    scroll.left,
    view.width - ROW_HEADER_WIDTH,
    view.height - HEADER_HEIGHT,
  );
  const lastActive = useRef<string | undefined>(undefined);

  // Keep the active cell visible when it moves (keyboard navigation).
  useEffect(() => {
    if (!scroller || !selection) return;
    const key = `${sheet.id}!${selection.active.row}:${selection.active.col}`;
    if (lastActive.current === key) return;
    lastActive.current = key;
    const { row, col } = selection.active;
    const viewW = (scroller.clientWidth || DEFAULT_VIEW.width) - ROW_HEADER_WIDTH;
    const viewH = (scroller.clientHeight || DEFAULT_VIEW.height) - HEADER_HEIGHT;
    let { scrollTop, scrollLeft } = scroller;
    if (row >= layout.frozenRows) {
      const top = layout.rowTop(row) - layout.frozenHeight;
      const bottom = layout.rowTop(row) + layout.rowHeight(row) - viewH;
      if (top < scrollTop) scrollTop = top;
      else if (bottom > scrollTop) scrollTop = bottom;
    }
    if (col >= layout.frozenCols) {
      const left = layout.colLeft(col) - layout.frozenWidth;
      const right = layout.colLeft(col) + layout.colWidth(col) - viewW;
      if (left < scrollLeft) scrollLeft = left;
      else if (right > scrollLeft) scrollLeft = right;
    }
    if (scrollTop !== scroller.scrollTop || scrollLeft !== scroller.scrollLeft) {
      scroller.scrollTop = Math.max(0, scrollTop);
      scroller.scrollLeft = Math.max(0, scrollLeft);
      setScroll({ top: scroller.scrollTop, left: scroller.scrollLeft });
    }
  }, [scroller, selection, layout, sheet.id]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    setScroll({ top: target.scrollTop, left: target.scrollLeft });
  };

  const y = (row: number) => HEADER_HEIGHT + layout.rowTop(row) + (row < layout.frozenRows ? scroll.top : 0);
  const x = (col: number) =>
    ROW_HEADER_WIDTH + layout.colLeft(col) + (col < layout.frozenCols ? scroll.left : 0);
  const boxStyle = (rect: Rect): CSSProperties => {
    const box = layout.box(rect);
    return {
      top: box.top + HEADER_HEIGHT + (rect.top < layout.frozenRows ? scroll.top : 0),
      left: box.left + ROW_HEADER_WIDTH + (rect.left < layout.frozenCols ? scroll.left : 0),
      width: box.width,
      height: box.height,
    };
  };

  // Cells to render, grouped by row; covered merge cells render their anchor instead.
  const rows = new Map<number, Set<number>>();
  for (const row of window.rows) {
    for (const col of window.cols) {
      const key = cellKey(row, col);
      const anchor = layout.merges.covered.get(key);
      const target = anchor ? layout.merges.anchors.get(anchor)! : undefined;
      const r = target ? target.top : row;
      const c = target ? target.left : col;
      let set = rows.get(r);
      if (!set) {
        set = new Set();
        rows.set(r, set);
      }
      set.add(c);
    }
  }
  const selected = (row: number, col: number) =>
    selection?.ranges.some((rect) => rectContains(rect, row, col)) ?? false;
  const active = selection?.active;

  const renderCell = (row: number, col: number) => {
    const key = cellKey(row, col);
    const cell = sheet.cells[key];
    const merge = layout.merges.anchors.get(key);
    const rect = merge ?? { top: row, left: col, bottom: row, right: col };
    const box = layout.box(rect);
    const error = isErrorValue(cell?.v) ? cell.v.error : undefined;
    const text =
      props.showFormulas && cell?.f !== undefined
        ? `=${cell.f}`
        : formatCellValue(cell?.v, cell?.fmt, display);
    const mark = props.marks?.get(key);
    const isActive = active?.row === row && active.col === col;
    const frozenCol = col < layout.frozenCols;
    const style: CSSProperties = {
      ...cellCss(cell, ctx),
      left: x(col),
      top: 0,
      width: box.width,
      height: box.height,
      zIndex: frozenCol ? 2 : undefined,
    };
    const classes = ['ak-sheet-cell'];
    if (error) classes.push('ak-sheet-cell-error');
    if (selected(row, col)) classes.push('ak-sheet-cell-selected');
    if (isActive) classes.push('ak-sheet-cell-active');
    if (cell?.f !== undefined) classes.push('ak-sheet-cell-formula');
    const title = [error ? `${error}: ${explainError(error, ctx.locale)}` : undefined, cell?.note, mark]
      .filter(Boolean)
      .join('\n');
    return (
      <td
        key={key}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: cells of an interactive ARIA grid (selection via aria-selected).
        role="gridcell"
        tabIndex={-1}
        aria-colindex={col + 2}
        aria-selected={selection ? selected(row, col) : undefined}
        {...(merge
          ? { 'aria-colspan': merge.right - merge.left + 1, 'aria-rowspan': merge.bottom - merge.top + 1 }
          : {})}
        id={isActive ? `ak-sheet-active-${sheet.id}` : undefined}
        data-cell={key}
        className={classes.join(' ')}
        style={style}
        title={title || undefined}
        onMouseDown={
          props.onCellMouseDown ? (event) => props.onCellMouseDown!({ row, col }, event) : undefined
        }
        onMouseEnter={
          props.onCellMouseEnter ? (event) => props.onCellMouseEnter!({ row, col }, event) : undefined
        }
        onDoubleClick={props.onCellDoubleClick ? () => props.onCellDoubleClick!({ row, col }) : undefined}
      >
        <span className="ak-sheet-cell-text">{text}</span>
        {cell?.note ? <span className="ak-sheet-note-mark" aria-hidden="true" /> : null}
        {mark ? <span className="ak-sheet-lint-mark" aria-hidden="true" /> : null}
      </td>
    );
  };

  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  const selectionRects = selection?.ranges ?? [];
  const lastRange = selectionRects[selectionRects.length - 1];

  return (
    <div
      ref={setScroller}
      className="ak-sheet-scroller"
      style={props.height ? { height: props.height } : undefined}
      onScroll={onScroll}
    >
      <div
        className="ak-sheet-canvas"
        style={{ width: layout.width + ROW_HEADER_WIDTH, height: layout.height + HEADER_HEIGHT }}
      >
        <table
          ref={props.gridRef}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA grid pattern on a table keeps native row/cell semantics and adds keyboard interaction.
          role="grid"
          aria-label={props.label}
          aria-rowcount={layout.rowCount + 1}
          aria-colcount={layout.colCount + 1}
          aria-multiselectable={selection ? true : undefined}
          aria-activedescendant={active ? `ak-sheet-active-${sheet.id}` : undefined}
          tabIndex={0}
          className="ak-sheet-grid"
          onKeyDown={props.onKeyDown}
          onCopy={props.onCopy}
          onCut={props.onCut}
          onPaste={props.onPaste}
        >
          <thead>
            <tr
              aria-rowindex={1}
              className="ak-sheet-header-row"
              style={{ top: scroll.top, width: layout.width + ROW_HEADER_WIDTH }}
            >
              <td className="ak-sheet-corner" style={{ left: scroll.left }} aria-hidden="true" />
              {window.cols.map((col) => (
                <th
                  key={col}
                  scope="col"
                  aria-colindex={col + 2}
                  className={`ak-sheet-col-header${selectionRects.some((rect) => col >= rect.left && col <= rect.right) ? ' ak-sheet-header-selected' : ''}`}
                  style={{
                    left: x(col),
                    width: layout.colWidth(col),
                    zIndex: col < layout.frozenCols ? 2 : undefined,
                  }}
                  onMouseDown={
                    props.onHeaderMouseDown
                      ? (event) => props.onHeaderMouseDown!('col', col, event)
                      : undefined
                  }
                >
                  {columnLetter(col)}
                  {props.onResizeMouseDown ? (
                    <span
                      className="ak-sheet-col-resize"
                      aria-hidden="true"
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        props.onResizeMouseDown!('col', col, event);
                      }}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const frozenRow = row < layout.frozenRows;
              return (
                <tr
                  key={row}
                  aria-rowindex={row + 2}
                  className={`ak-sheet-row${frozenRow ? ' ak-sheet-row-frozen' : ''}`}
                  style={{
                    top: y(row),
                    height: layout.rowHeight(row),
                    width: layout.width + ROW_HEADER_WIDTH,
                  }}
                >
                  <th
                    scope="row"
                    aria-colindex={1}
                    className={`ak-sheet-row-header${selectionRects.some((rect) => row >= rect.top && row <= rect.bottom) ? ' ak-sheet-header-selected' : ''}`}
                    style={{ left: scroll.left, height: layout.rowHeight(row) }}
                    onMouseDown={
                      props.onHeaderMouseDown
                        ? (event) => props.onHeaderMouseDown!('row', row, event)
                        : undefined
                    }
                  >
                    {row + 1}
                    {props.onResizeMouseDown ? (
                      <span
                        className="ak-sheet-row-resize"
                        aria-hidden="true"
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          props.onResizeMouseDown!('row', row, event);
                        }}
                      />
                    ) : null}
                  </th>
                  {[...rows.get(row)!].sort((a, b) => a - b).map((col) => renderCell(row, col))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {selectionRects.map((rect) => (
          <div
            key={`sel-${formatRange(rect)}`}
            className="ak-sheet-selection"
            style={boxStyle(rect)}
            aria-hidden="true"
          />
        ))}
        {(props.highlights ?? []).map((highlight) => (
          <div
            key={`hl-${formatRange(highlight.rect)}-${highlight.color}`}
            className="ak-sheet-highlight"
            style={{
              ...boxStyle(highlight.rect),
              borderColor: highlight.color,
              background: `${highlight.color}1A`,
            }}
            aria-hidden="true"
          />
        ))}
        {props.fillPreview ? (
          <div className="ak-sheet-fill-preview" style={boxStyle(props.fillPreview)} aria-hidden="true" />
        ) : null}
        {props.fillHandle && lastRange ? (
          <div
            className="ak-sheet-fill-handle"
            data-testid="fill-handle"
            style={{
              top: (boxStyle(lastRange).top as number) + (boxStyle(lastRange).height as number) - 4,
              left: (boxStyle(lastRange).left as number) + (boxStyle(lastRange).width as number) - 4,
            }}
            aria-hidden="true"
            onMouseDown={props.onFillMouseDown}
          />
        ) : null}
        {props.editor ? (
          <div
            className="ak-sheet-editor-overlay"
            style={boxStyle(
              layout.merges.anchors.get(cellKey(props.editor.pos.row, props.editor.pos.col)) ?? {
                top: props.editor.pos.row,
                left: props.editor.pos.col,
                bottom: props.editor.pos.row,
                right: props.editor.pos.col,
              },
            )}
          >
            {props.editor.node}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { SheetLayout };
