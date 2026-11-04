import type { EditorBindings, EmitOptions } from '@artkit/core';
import {
  Button,
  IconButton,
  Toolbar,
  ToolbarButton,
  ToolbarColor,
  ToolbarGroup,
  ToolbarMenu,
  ToolbarSelect,
  themeSwatches,
} from '@artkit/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowDownZA,
  Baseline,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  DollarSign,
  Eraser,
  EyeOff,
  Grid2x2,
  Hash,
  Italic,
  Merge,
  MessageSquareText,
  PaintBucket,
  PanelBottom,
  PencilLine,
  Percent,
  Plus,
  Rows3,
  Sigma,
  Snowflake,
  Split,
  Square,
  SquareDashed,
  Strikethrough,
  TableColumnsSplit,
  TableRowsSplit,
  Tag,
  Trash2,
  Underline,
  WrapText,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type CellPos,
  cellKey,
  columnLetter,
  formatRange,
  MAX_COLS,
  MAX_ROWS,
  parseRange,
  quoteSheetName,
  type Rect,
  rectContains,
  rectsIntersect,
} from '../address.js';
import { checkFormula } from '../cells.js';
import { formatCellValue, resolveCurrency } from '../display.js';
import { previewFormula } from '../formula/engine.js';
import { DEFAULT_COLUMN_WIDTH, explainError } from '../lint.js';
import type { SheetOperation } from '../operations.js';
import { SheetGrid } from '../react/grid.js';
import { formulaReferences } from '../react/highlight.js';
import { columnPx, rowPx } from '../react/layout.js';
import { isErrorValue, NAMED_FORMATS, type NamedFormat, type Sheet, type SheetContent } from '../schema.js';
import {
  type ClipboardPayload,
  copyBlock,
  parseHtmlTable,
  parseTsv,
  pastePatches,
  SHEET_CLIPBOARD_MIME,
} from './clipboard.js';
import {
  acceptsReference,
  applySuggestion,
  enclosingFunction,
  functionPrefixAt,
  insertReference,
  referenceText,
  suggestFunctions,
} from './formula-edit.js';
import { cellEditText, cellPatchFromText } from './input.js';
import { editingKey, navigationKey } from './keys.js';
import { editorLabels } from './labels.js';
import {
  autoSumOps,
  borderOps,
  clearOps,
  deleteColumnsOp,
  deleteRowsOp,
  fillOp,
  fillTarget,
  formatOps,
  insertColumnsOp,
  insertRowsOp,
  nextSheetName,
  sortOps,
  styleOps,
  usedSize,
} from './ops.js';
import {
  addRange,
  advance,
  currentRange,
  jumpBy,
  moveBy,
  rectOf,
  type Selection,
  selectAll,
  selectColumns,
  selectRows,
  selectTo,
  singleSelection,
} from './selection.js';

interface Editing {
  pos: CellPos;
  text: string;
  caret: number;
  origin: 'cell' | 'bar';
  /** Text when editing started, to skip emitting unchanged values. */
  initial: string;
  /** Reference inserted by pointing at the grid, replaced while dragging. */
  pointed?: { start: number; end: number };
}

type Drag =
  | { type: 'select' }
  | { type: 'point'; anchor: CellPos }
  | { type: 'fill'; source: Rect; target: Rect }
  | { type: 'resize'; axis: 'row' | 'col'; index: number; start: number; original: number; size: number };

const PAGE_ROWS = 20;

/**
 * Visual spreadsheet editor (spec §11.2). Controlled: it renders `content` and turns every interaction into
 * sheet operations through `emit`. Built on the package's own virtualized DOM grid.
 */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

export function SheetEditor({
  content,
  ctx,
  emit,
  readOnly,
  lint,
}: EditorBindings<SheetContent, SheetOperation>) {
  const L = editorLabels(ctx.locale);
  const visible = content.sheets.filter((candidate) => !candidate.hidden);
  const [sheetId, setSheetId] = useState(visible[0]?.id ?? content.sheets[0]!.id);
  const sheet: Sheet =
    visible.find((candidate) => candidate.id === sheetId) ?? visible[0] ?? content.sheets[0]!;
  const [selection, setSelection] = useState<Selection>(() => singleSelection({ row: 0, col: 0 }));
  const [editing, setEditing] = useState<Editing | undefined>();
  const [suggestion, setSuggestion] = useState(0);
  const [fillPreview, setFillPreview] = useState<Rect | undefined>();
  const [resize, setResize] = useState<{ axis: 'row' | 'col'; index: number; size: number } | undefined>();
  const [dialog, setDialog] = useState<'names' | 'delete-sheet' | undefined>();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>();
  const [pendingSheet, setPendingSheet] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const drag = useRef<Drag | undefined>(undefined);
  const gridRef = useRef<HTMLTableElement>(null);
  const cellInput = useRef<HTMLInputElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLSelectElement>(null);
  const lastCopy = useRef<{ text: string; payload: ClipboardPayload } | undefined>(undefined);
  const dragSheet = useRef<string | undefined>(undefined);
  const display = useMemo(
    () => ({ locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) }),
    [content, ctx.locale],
  );

  const active = selection.active;
  const activeKey = cellKey(active.row, active.col);
  const activeCell = sheet.cells[activeKey];
  const range = currentRange(selection);
  const used = usedSize(sheet);
  const bounds = { maxRow: MAX_ROWS - 1, maxCol: MAX_COLS - 1 };

  const send = useCallback(
    (operations: SheetOperation[], kind?: EmitOptions['kind']) => {
      if (readOnly || operations.length === 0) return;
      emit(operations, kind ? { kind } : undefined);
    },
    [emit, readOnly],
  );

  // Select a sheet created from the tabs once it shows up in the content.
  useEffect(() => {
    if (!pendingSheet) return;
    const created = content.sheets.find((candidate) => candidate.name === pendingSheet);
    if (created) {
      setSheetId(created.id);
      setSelection(singleSelection({ row: 0, col: 0 }));
      setPendingSheet(undefined);
    }
  }, [content.sheets, pendingSheet]);

  useEffect(() => {
    if (dropdownOpen) dropdownRef.current?.focus();
  }, [dropdownOpen]);

  // Keep the caret where the state says after programmatic edits (suggestions, pointing).
  useLayoutEffect(() => {
    if (!editing) return;
    const input = editing.origin === 'cell' ? cellInput.current : barInput.current;
    if (!input) return;
    if (document.activeElement !== input) input.focus();
    if (input.selectionStart !== editing.caret || input.selectionEnd !== editing.caret)
      input.setSelectionRange(editing.caret, editing.caret);
  }, [editing]);

  const focusGrid = () => gridRef.current?.focus();

  const startEditing = (pos: CellPos, text: string, origin: Editing['origin'] = 'cell', initial?: string) => {
    if (readOnly) return;
    setMessage(undefined);
    setSuggestion(0);
    setEditing({
      pos,
      text,
      caret: text.length,
      origin,
      initial: initial ?? cellEditText(sheet.cells[cellKey(pos.row, pos.col)], ctx.locale),
    });
  };

  /** Commits the edit as one `set_cells`; invalid formulas keep the editor open with the error. */
  const commit = (direction?: 'down' | 'up' | 'right' | 'left'): boolean => {
    if (!editing) return true;
    const key = cellKey(editing.pos.row, editing.pos.col);
    if (editing.text !== editing.initial) {
      if (editing.text.startsWith('=') && editing.text.length > 1) {
        const issue = checkFormula(editing.text.slice(1), ctx.locale);
        if (issue) {
          setMessage(`${L.invalidFormula}: ${issue.message}${issue.hint ? ` ${issue.hint}` : ''}`);
          return false;
        }
      }
      send(
        [
          {
            op: 'set_cells',
            sheet: sheet.id,
            cells: { [key]: cellPatchFromText(editing.text, ctx.locale, sheet.cells[key]) },
          },
        ],
        'typing',
      );
    }
    setEditing(undefined);
    setMessage(undefined);
    if (direction) setSelection((current) => advance(current, direction, bounds));
    focusGrid();
    return true;
  };

  const cancel = () => {
    setEditing(undefined);
    setMessage(undefined);
    focusGrid();
  };

  // ---- Derived editing helpers ----

  const prefix = editing ? functionPrefixAt(editing.text, editing.caret) : undefined;
  const suggestions = prefix ? suggestFunctions(prefix.prefix) : [];
  const signature = editing ? enclosingFunction(editing.text, editing.caret) : undefined;
  const isFormula = editing?.text.startsWith('=') ?? false;
  const references = editing && isFormula ? formulaReferences(editing.text, sheet.name) : [];
  const preview = useMemo(() => {
    if (!editing || !isFormula || editing.text.length < 2) return undefined;
    const formula = editing.text.slice(1);
    if (checkFormula(formula, ctx.locale)) return undefined;
    const key = cellKey(editing.pos.row, editing.pos.col);
    const value = previewFormula(content, sheet.id, key, formula);
    return formatCellValue(value, sheet.cells[key]?.fmt, display);
  }, [editing, isFormula, content, sheet, display, ctx.locale]);

  const setEditText = (text: string, caret: number) => {
    setSuggestion(0);
    setEditing((current) => (current ? { ...current, text, caret, pointed: undefined } : current));
  };

  const acceptSuggestion = (name: string) => {
    if (!editing) return;
    const next = applySuggestion(editing.text, editing.caret, name);
    setEditText(next.text, next.caret);
  };

  // ---- Grid interaction ----

  const filled = (row: number, col: number) => {
    const cell = sheet.cells[cellKey(row, col)];
    return cell !== undefined && (cell.v !== undefined || cell.f !== undefined);
  };

  const pointAt = (pos: CellPos, anchor: CellPos, caret?: number) => {
    setEditing((current) => {
      if (!current) return current;
      const reference = referenceText(rectOf(anchor, pos), sheet.name, sheet.name);
      const next = insertReference(current.text, caret ?? current.caret, reference, current.pointed);
      return { ...current, text: next.text, caret: next.caret, pointed: next.span };
    });
  };

  /** Live caret of the focused editor input (React's synthetic select events can lag behind). */
  const liveCaret = () => {
    const input = editing?.origin === 'bar' ? barInput.current : cellInput.current;
    return input?.selectionStart ?? editing?.caret ?? 0;
  };

  const onCellMouseDown = (pos: CellPos, event: MouseEvent) => {
    const caret = editing ? liveCaret() : 0;
    if (editing && isFormula && (editing.pointed || acceptsReference(editing.text, caret))) {
      // Point mode: the click inserts a reference into the formula instead of moving the selection.
      event.preventDefault();
      drag.current = { type: 'point', anchor: pos };
      pointAt(pos, pos, editing.pointed ? undefined : caret);
      return;
    }
    if (editing && !commit()) return;
    setDropdownOpen(false);
    if (event.shiftKey) setSelection((current) => selectTo(current, pos, true, bounds));
    else if (event.ctrlKey || event.metaKey) setSelection((current) => addRange(current, pos));
    else setSelection(singleSelection(pos));
    drag.current = { type: 'select' };
  };

  const onCellMouseEnter = (pos: CellPos) => {
    const current = drag.current;
    if (!current) return;
    if (current.type === 'select') setSelection((sel) => selectTo(sel, pos, true, bounds));
    else if (current.type === 'point') pointAt(pos, current.anchor);
    else if (current.type === 'fill') {
      const target = fillTarget(current.source, pos.row, pos.col);
      drag.current = { ...current, target };
      setFillPreview(target);
    }
  };

  const onHeaderMouseDown = (axis: 'row' | 'col', index: number, event: MouseEvent) => {
    if (editing && !commit()) return;
    setSelection((current) =>
      axis === 'row'
        ? selectRows(current, index, event.shiftKey, bounds)
        : selectColumns(current, index, event.shiftKey, bounds),
    );
    focusGrid();
  };

  const onResizeMouseDown = (axis: 'row' | 'col', index: number, event: MouseEvent) => {
    if (readOnly) return;
    event.preventDefault();
    const original =
      axis === 'col'
        ? columnPx(sheet.columns?.[columnLetter(index)]?.width ?? DEFAULT_COLUMN_WIDTH)
        : rowPx(sheet.rows?.[String(index + 1)]?.height ?? 16.5);
    drag.current = {
      type: 'resize',
      axis,
      index,
      start: axis === 'col' ? event.clientX : event.clientY,
      original,
      size: original,
    };
  };

  const onFillMouseDown = (event: MouseEvent) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { type: 'fill', source: range, target: range };
    setFillPreview(range);
  };

  // Gestures end on the window so releasing outside the grid still finishes them.
  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent) => {
      const current = drag.current;
      if (current?.type !== 'resize') return;
      const delta = (current.axis === 'col' ? event.clientX : event.clientY) - current.start;
      const size = Math.max(current.axis === 'col' ? columnPx(4) : rowPx(6), current.original + delta);
      drag.current = { ...current, size };
      setResize({ axis: current.axis, index: current.index, size });
    };
    const onUp = () => {
      const current = drag.current;
      drag.current = undefined;
      if (!current) return;
      if (current.type === 'fill') {
        setFillPreview(undefined);
        if (
          current.target.top !== current.source.top ||
          current.target.bottom !== current.source.bottom ||
          current.target.left !== current.source.left ||
          current.target.right !== current.source.right
        ) {
          send([fillOp(sheet, current.source, current.target)], 'continuous');
          setSelection({
            ...singleSelection({ row: current.target.top, col: current.target.left }),
            ranges: [current.target],
          });
        }
      } else if (current.type === 'resize') {
        setResize(undefined);
        if (current.size === current.original) return;
        if (current.axis === 'col') {
          const width = Math.min(80, Math.max(4, Math.round(((current.size - 5) / 7) * 10) / 10));
          send(
            [
              {
                op: 'set_column_width',
                sheet: sheet.id,
                column: columnLetter(current.index),
                count: 1,
                width,
              },
            ],
            'continuous',
          );
        } else {
          const height = Math.min(409, Math.max(6, Math.round(((current.size * 3) / 4) * 10) / 10));
          send(
            [{ op: 'set_row_height', sheet: sheet.id, row: current.index + 1, count: 1, height }],
            'continuous',
          );
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [send, sheet]);

  const toggleStyle = (style: 'bold' | 'italic' | 'underline' | 'strike') => {
    send(styleOps(sheet, selection.ranges, { [style]: activeCell?.s?.[style] ? null : true }));
  };

  const validation = (sheet.validations ?? []).find((candidate) => {
    const rect = parseRange(candidate.range);
    return rect ? rectContains(rect, active.row, active.col) : false;
  });

  const onGridKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (event.target !== event.currentTarget) return;
    const action = navigationKey(event);
    if (!action) return;
    const editable = !readOnly;
    switch (action.type) {
      case 'move':
        setSelection((current) => moveBy(current, action.dRow, action.dCol, action.extend, bounds));
        break;
      case 'jump':
        setSelection((current) =>
          jumpBy(current, action.dRow, action.dCol, action.extend, filled, {
            maxRow: Math.max(used.rows, active.row + 1),
            maxCol: Math.max(used.cols, active.col + 1),
          }),
        );
        break;
      case 'home':
        setSelection((current) =>
          selectTo(
            current,
            { row: action.toStart ? 0 : (action.extend ? current.focus : current.active).row, col: 0 },
            action.extend,
            bounds,
          ),
        );
        break;
      case 'page':
        setSelection((current) => moveBy(current, action.dRow * PAGE_ROWS, 0, action.extend, bounds));
        break;
      case 'advance':
        setSelection((current) => advance(current, action.direction, bounds));
        break;
      case 'select-all':
        setSelection(selectAll(bounds));
        break;
      case 'edit':
        if (!editable) return;
        startEditing(active, cellEditText(activeCell, ctx.locale));
        break;
      case 'type':
        if (!editable) return;
        startEditing(active, action.text);
        break;
      case 'clear':
        if (!editable) return;
        send(clearOps(sheet, selection.ranges));
        break;
      case 'toggle':
        if (!editable) return;
        toggleStyle(action.style);
        break;
      case 'autosum':
        if (!editable) return;
        send(autoSumOps(sheet, range));
        break;
      case 'dropdown':
        if (!editable || !validation) return;
        setDropdownOpen(true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSuggestion(
          (current) =>
            (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length,
        );
        return;
      }
      if (
        event.key === 'Tab' ||
        (event.key === 'Enter' && prefix && prefix.prefix.length > 0 && suggestions[suggestion])
      ) {
        event.preventDefault();
        acceptSuggestion(suggestions[suggestion]!.name);
        return;
      }
    }
    const action = editingKey(event);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'cancel') cancel();
    else if (action.type === 'commit') commit(action.direction);
  };

  const syncCaret = (event: SyntheticEvent<HTMLInputElement>) => {
    const caret = event.currentTarget.selectionStart ?? 0;
    setEditing((current) =>
      current && current.caret !== caret ? { ...current, caret, pointed: undefined } : current,
    );
  };

  const inputProps = (origin: Editing['origin']) => ({
    value: editing ? editing.text : cellEditText(activeCell, ctx.locale),
    readOnly,
    spellCheck: false,
    autoComplete: 'off',
    'aria-autocomplete': 'list' as const,
    'aria-controls': suggestions.length > 0 ? 'ak-sheet-suggestions' : undefined,
    'aria-activedescendant': suggestions.length > 0 ? `ak-sheet-suggestion-${suggestion}` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const caret = event.target.selectionStart ?? event.target.value.length;
      if (!editing) startEditing(active, event.target.value, origin, cellEditText(activeCell, ctx.locale));
      else setEditText(event.target.value, caret);
    },
    onKeyUp: syncCaret,
    onClick: syncCaret,
    onKeyDown: onInputKeyDown,
  });

  // ---- Clipboard ----

  const onCopy = (event: ClipboardEvent<HTMLTableElement>) => {
    if (editing) return;
    const block = copyBlock(sheet, rectWithin(range, used), display);
    event.clipboardData.setData('text/plain', block.text);
    event.clipboardData.setData('text/html', block.html);
    event.clipboardData.setData(SHEET_CLIPBOARD_MIME, JSON.stringify(block.payload));
    lastCopy.current = { text: block.text, payload: block.payload };
    event.preventDefault();
  };

  const onCut = (event: ClipboardEvent<HTMLTableElement>) => {
    if (editing || readOnly) return;
    onCopy(event);
    send(clearOps(sheet, [range], 'all'));
  };

  const onPaste = (event: ClipboardEvent<HTMLTableElement>) => {
    if (editing || readOnly) return;
    event.preventDefault();
    const data = event.clipboardData;
    const internal = data.getData(SHEET_CLIPBOARD_MIME);
    const text = data.getData('text/plain');
    let source: ClipboardPayload | string[][] | undefined;
    if (internal) {
      try {
        source = JSON.parse(internal) as ClipboardPayload;
      } catch {
        source = undefined;
      }
    }
    if (!source && lastCopy.current && text === lastCopy.current.text) source = lastCopy.current.payload;
    if (!source) {
      const html = data.getData('text/html');
      source = (html ? parseHtmlTable(html) : undefined) ?? (text ? parseTsv(text) : undefined);
    }
    if (!source) return;
    const start = { row: range.top, col: range.left };
    const cells = pastePatches(source, start, ctx.locale, rectWithin(range, used));
    send([{ op: 'set_cells', sheet: sheet.id, cells }]);
  };

  // ---- Toolbar actions ----

  const merge = () => {
    const rect = rectWithin(range, used);
    const clear: Record<string, { v: null; f: null }> = {};
    for (let row = rect.top; row <= rect.bottom; row++) {
      for (let col = rect.left; col <= rect.right; col++) {
        if ((row !== rect.top || col !== rect.left) && filled(row, col))
          clear[cellKey(row, col)] = { v: null, f: null };
      }
    }
    const operations: SheetOperation[] = [];
    if (Object.keys(clear).length > 0) operations.push({ op: 'set_cells', sheet: sheet.id, cells: clear });
    const overlapping = (sheet.merges ?? []).filter((text) => {
      const other = parseRange(text);
      return other ? rectsIntersect(other, rect) : false;
    });
    if (overlapping.length > 0)
      operations.push({ op: 'unmerge_cells', sheet: sheet.id, range: formatRange(rect) });
    operations.push({ op: 'merge_cells', sheet: sheet.id, range: formatRange(rect) });
    send(operations);
  };

  const hasMerge = (sheet.merges ?? []).some((text) => {
    const other = parseRange(text);
    return other ? rectsIntersect(other, range) : false;
  });
  const multiCell = range.top !== range.bottom || range.left !== range.right;

  const addSheet = () => {
    const name = nextSheetName(
      content.sheets.map((candidate) => candidate.name),
      L.sheetBase,
    );
    send([{ op: 'add_sheet', name }]);
    setPendingSheet(name);
  };

  const commitRename = () => {
    if (!renaming) return;
    const target = content.sheets.find((candidate) => candidate.id === renaming.id);
    const name = renaming.name.trim();
    setRenaming(undefined);
    if (target && name && name !== target.name) send([{ op: 'rename_sheet', sheet: target.id, name }]);
  };

  const moveSheet = (id: string, position: number) => {
    const current = content.sheets.findIndex((candidate) => candidate.id === id) + 1;
    if (position >= 1 && position <= content.sheets.length && position !== current)
      send([{ op: 'move_sheet', sheet: id, position }]);
  };

  const switchSheet = (id: string) => {
    if (editing && !commit()) return;
    setSheetId(id);
    setSelection(singleSelection({ row: 0, col: 0 }));
  };

  // ---- Render ----

  const marks = useMemo(() => {
    const map = new Map<string, string>();
    const prefixTarget = `cell:${sheet.id}!`;
    for (const issue of lint ?? []) {
      if (!issue.target.startsWith(prefixTarget)) continue;
      const key = issue.target.slice(prefixTarget.length);
      map.set(key, map.has(key) ? `${map.get(key)}\n${issue.message}` : issue.message);
    }
    return map;
  }, [lint, sheet.id]);

  const shownSheet = useMemo(() => {
    if (!resize) return sheet;
    if (resize.axis === 'col') {
      const width = Math.min(80, Math.max(4, (resize.size - 5) / 7));
      return { ...sheet, columns: { ...sheet.columns, [columnLetter(resize.index)]: { width } } };
    }
    return {
      ...sheet,
      rows: {
        ...sheet.rows,
        [String(resize.index + 1)]: { height: Math.min(409, Math.max(6, (resize.size * 3) / 4)) },
      },
    };
  }, [sheet, resize]);

  const errorCode = isErrorValue(activeCell?.v) ? activeCell.v.error : undefined;
  const status =
    message ??
    (errorCode ? `${activeKey} ${errorCode}: ${explainError(errorCode, ctx.locale)}` : undefined) ??
    (marks.get(activeKey) ? `${activeKey}: ${marks.get(activeKey)}` : undefined);

  let overlay: { pos: CellPos; node: ReactNode } | undefined;
  if (editing?.origin === 'cell' && editing.pos.row === active.row && editing.pos.col === active.col) {
    overlay = {
      pos: editing.pos,
      node: (
        <input
          ref={cellInput}
          className="ak-sheet-cell-input"
          aria-label={`${L.cellEditor} ${cellKey(editing.pos.row, editing.pos.col)}`}
          {...inputProps('cell')}
        />
      ),
    };
  } else if (!editing && validation && !readOnly) {
    overlay = {
      pos: active,
      node: (
        <select
          ref={dropdownRef}
          className={`ak-sheet-dropdown${dropdownOpen ? ' ak-sheet-dropdown-open' : ''}`}
          aria-label={`${L.allowed} ${activeKey}`}
          value={activeCell?.v === undefined || typeof activeCell.v === 'object' ? '' : String(activeCell.v)}
          onChange={(event) => {
            const chosen = validation.values.find((value) => String(value) === event.target.value);
            setDropdownOpen(false);
            send([
              { op: 'set_cells', sheet: sheet.id, cells: { [activeKey]: { v: chosen ?? null, f: null } } },
            ]);
            focusGrid();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDropdownOpen(false);
              focusGrid();
            }
          }}
        >
          <option value="">—</option>
          {validation.values.map((value) => (
            <option key={String(value)} value={String(value)}>
              {String(value)}
            </option>
          ))}
        </select>
      ),
    };
  }

  const swatches = themeSwatches(ctx.theme, ctx.locale);
  const quickFormat = (fmt: NamedFormat) =>
    send(formatOps(sheet, selection.ranges, activeCell?.fmt === fmt ? null : fmt));
  const editNote = () => {
    const note = globalThis.prompt?.(L.notePrompt, activeCell?.note ?? '');
    if (note === null || note === undefined) return;
    send([
      {
        op: 'set_cells',
        sheet: sheet.id,
        cells: { [activeKey]: { note: note.trim() === '' ? null : note } },
      },
    ]);
  };

  return (
    <div className={`ak-sheet ak-sheet-editor ak-ctl-scope${readOnly ? ' ak-sheet-readonly' : ''}`}>
      {readOnly ? null : (
        <Toolbar label={L.toolbar} className="ak-sheet-toolbar">
          <ToolbarGroup label={L.number}>
            <ToolbarSelect
              label={L.format}
              value={activeCell?.fmt ?? 'general'}
              options={NAMED_FORMATS.map((fmt) => ({ value: fmt, label: L.formats[fmt] }))}
              onChange={(fmt) => send(formatOps(sheet, selection.ranges, fmt === 'general' ? null : fmt))}
              width={128}
            />
            <ToolbarButton
              icon={DollarSign}
              label={L.formats.currency}
              pressed={activeCell?.fmt === 'currency'}
              onClick={() => quickFormat('currency')}
            />
            <ToolbarButton
              icon={Percent}
              label={L.formats.percent}
              pressed={activeCell?.fmt === 'percent'}
              onClick={() => quickFormat('percent')}
            />
            <ToolbarButton
              icon={Hash}
              label={L.formats.decimal2}
              pressed={activeCell?.fmt === 'decimal2'}
              onClick={() => quickFormat('decimal2')}
            />
          </ToolbarGroup>
          <ToolbarGroup label={L.text}>
            <ToolbarSelect
              label={L.fontSize}
              value={String(activeCell?.s?.fontSize ?? 11)}
              options={FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
              onChange={(size) =>
                send(styleOps(sheet, selection.ranges, { fontSize: size === '11' ? null : Number(size) }))
              }
              width={64}
            />
            <ToolbarButton
              icon={Bold}
              label={L.bold}
              shortcut="Ctrl+B"
              pressed={!!activeCell?.s?.bold}
              onClick={() => toggleStyle('bold')}
            />
            <ToolbarButton
              icon={Italic}
              label={L.italic}
              shortcut="Ctrl+I"
              pressed={!!activeCell?.s?.italic}
              onClick={() => toggleStyle('italic')}
            />
            <ToolbarButton
              icon={Underline}
              label={L.underline}
              shortcut="Ctrl+U"
              pressed={!!activeCell?.s?.underline}
              onClick={() => toggleStyle('underline')}
            />
            <ToolbarButton
              icon={Strikethrough}
              label={L.strike}
              pressed={!!activeCell?.s?.strike}
              onClick={() => toggleStyle('strike')}
            />
            <ToolbarColor
              icon={Baseline}
              label={L.textColor}
              value={activeCell?.s?.color ?? null}
              colors={swatches}
              noneLabel={L.defaultColor}
              onChange={(color) => send(styleOps(sheet, selection.ranges, { color: color as never }))}
            />
            <ToolbarColor
              icon={PaintBucket}
              label={L.background}
              value={activeCell?.s?.background ?? null}
              colors={swatches}
              noneLabel={L.defaultColor}
              onChange={(color) => send(styleOps(sheet, selection.ranges, { background: color as never }))}
            />
          </ToolbarGroup>
          <ToolbarGroup label={L.alignment}>
            {(['left', 'center', 'right'] as const).map((align) => (
              <ToolbarButton
                key={align}
                icon={align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight}
                label={align === 'left' ? L.alignLeft : align === 'center' ? L.alignCenter : L.alignRight}
                pressed={activeCell?.s?.align === align}
                onClick={() =>
                  send(
                    styleOps(sheet, selection.ranges, {
                      align: activeCell?.s?.align === align ? null : align,
                    }),
                  )
                }
              />
            ))}
            <ToolbarMenu
              icon={
                activeCell?.s?.valign === 'top'
                  ? AlignVerticalJustifyStart
                  : activeCell?.s?.valign === 'middle'
                    ? AlignVerticalJustifyCenter
                    : AlignVerticalJustifyEnd
              }
              label={L.verticalAlign}
              items={(['top', 'middle', 'bottom'] as const).map((valign) => ({
                key: valign,
                label: L.valign[valign],
                icon:
                  valign === 'top'
                    ? AlignVerticalJustifyStart
                    : valign === 'middle'
                      ? AlignVerticalJustifyCenter
                      : AlignVerticalJustifyEnd,
                checked: (activeCell?.s?.valign ?? 'bottom') === valign,
                onSelect: () =>
                  send(styleOps(sheet, selection.ranges, { valign: valign === 'bottom' ? null : valign })),
              }))}
            />
            <ToolbarButton
              icon={WrapText}
              label={L.wrap}
              pressed={!!activeCell?.s?.wrap}
              onClick={() =>
                send(styleOps(sheet, selection.ranges, { wrap: activeCell?.s?.wrap ? null : true }))
              }
            />
          </ToolbarGroup>
          <ToolbarGroup label={L.cells}>
            <ToolbarMenu
              icon={Grid2x2}
              label={L.borders}
              items={(['all', 'outer', 'bottom', 'none'] as const).map((preset) => ({
                key: preset,
                label: L.borderPresets[preset],
                icon:
                  preset === 'all'
                    ? Grid2x2
                    : preset === 'outer'
                      ? Square
                      : preset === 'bottom'
                        ? PanelBottom
                        : SquareDashed,
                onSelect: () => send(borderOps(sheet, selection.ranges, preset)),
              }))}
            />
            <ToolbarButton icon={Merge} label={L.merge} disabled={!multiCell} onClick={merge} />
            <ToolbarButton
              icon={Split}
              label={L.unmerge}
              disabled={!hasMerge}
              onClick={() =>
                send([{ op: 'unmerge_cells', sheet: sheet.id, range: formatRange(rectWithin(range, used)) }])
              }
            />
            <ToolbarMenu
              icon={Rows3}
              label={L.rowsColumns}
              items={[
                {
                  key: 'rowAbove',
                  label: L.insertRow,
                  icon: BetweenHorizontalStart,
                  onSelect: () => send([insertRowsOp(sheet, range, 'above')]),
                },
                {
                  key: 'rowBelow',
                  label: L.insertRowBelow,
                  icon: BetweenHorizontalEnd,
                  onSelect: () => send([insertRowsOp(sheet, range, 'below')]),
                },
                {
                  key: 'colLeft',
                  label: L.insertColumn,
                  icon: BetweenVerticalStart,
                  onSelect: () => send([insertColumnsOp(sheet, range, 'left')]),
                },
                {
                  key: 'colRight',
                  label: L.insertColumnRight,
                  icon: BetweenVerticalEnd,
                  onSelect: () => send([insertColumnsOp(sheet, range, 'right')]),
                },
                'separator',
                {
                  key: 'delRows',
                  label: L.deleteRows,
                  icon: TableRowsSplit,
                  danger: true,
                  onSelect: () => send([deleteRowsOp(sheet, range)]),
                },
                {
                  key: 'delCols',
                  label: L.deleteColumns,
                  icon: TableColumnsSplit,
                  danger: true,
                  onSelect: () => send([deleteColumnsOp(sheet, range)]),
                },
              ]}
            />
            <ToolbarMenu
              icon={Eraser}
              label={L.clear}
              items={[
                {
                  key: 'contents',
                  label: L.clearContents,
                  onSelect: () => send(clearOps(sheet, selection.ranges, 'contents')),
                },
                {
                  key: 'formats',
                  label: L.clearFormats,
                  onSelect: () => send(clearOps(sheet, selection.ranges, 'formats')),
                },
                {
                  key: 'all',
                  label: L.clearAll,
                  danger: true,
                  onSelect: () => send(clearOps(sheet, selection.ranges, 'all')),
                },
              ]}
            />
          </ToolbarGroup>
          <ToolbarGroup label={L.data}>
            <ToolbarButton
              icon={Sigma}
              label={L.autoSum}
              shortcut="Alt+="
              onClick={() => send(autoSumOps(sheet, range))}
            />
            <ToolbarButton
              icon={ArrowDownAZ}
              label={L.sortAsc}
              onClick={() => send(sortOps(sheet, range, active.col, false))}
            />
            <ToolbarButton
              icon={ArrowDownZA}
              label={L.sortDesc}
              onClick={() => send(sortOps(sheet, range, active.col, true))}
            />
            <ToolbarButton
              icon={MessageSquareText}
              label={L.note}
              pressed={!!activeCell?.note}
              onClick={editNote}
            />
            <ToolbarButton icon={Tag} label={L.names} onClick={() => setDialog('names')} />
          </ToolbarGroup>
          <ToolbarGroup label={L.view}>
            <ToolbarMenu
              icon={Snowflake}
              label={L.freezeMenu}
              items={[
                {
                  key: 'row',
                  label: L.freezeTopRow,
                  onSelect: () => send([{ op: 'set_frozen', sheet: sheet.id, rows: 1, cols: 0 }]),
                },
                {
                  key: 'col',
                  label: L.freezeFirstColumn,
                  onSelect: () => send([{ op: 'set_frozen', sheet: sheet.id, rows: 0, cols: 1 }]),
                },
                {
                  key: 'active',
                  label: L.freeze,
                  onSelect: () =>
                    send([
                      {
                        op: 'set_frozen',
                        sheet: sheet.id,
                        rows: Math.min(active.row, 1000),
                        cols: Math.min(active.col, 100),
                      },
                    ]),
                },
                'separator',
                {
                  key: 'none',
                  label: L.unfreeze,
                  disabled: !sheet.frozen,
                  onSelect: () => send([{ op: 'set_frozen', sheet: sheet.id, rows: 0, cols: 0 }]),
                },
              ]}
            />
          </ToolbarGroup>
        </Toolbar>
      )}
      <fieldset className="ak-sheet-formula-bar">
        <legend className="ak-sheet-sr-only">{L.formulaBar}</legend>
        <output className="ak-sheet-address" aria-label={L.cell}>
          {multiCell ? formatRange(range) : activeKey}
        </output>
        <input
          ref={barInput}
          className="ak-sheet-bar-input"
          aria-label={L.formulaBar}
          {...inputProps('bar')}
          onFocus={() => {
            if (!editing && !readOnly) startEditing(active, cellEditText(activeCell, ctx.locale), 'bar');
            else if (editing && editing.origin !== 'bar') setEditing({ ...editing, origin: 'bar' });
          }}
        />
        {preview !== undefined ? (
          <output className="ak-sheet-preview" aria-label={L.preview}>
            = {preview}
          </output>
        ) : null}
      </fieldset>
      {editing && isFormula ? (
        <div className="ak-sheet-formula-tokens" aria-hidden="true">
          {renderColored(editing.text, references)}
        </div>
      ) : null}
      {editing && (suggestions.length > 0 || signature) ? (
        <div className="ak-sheet-assist">
          {suggestions.length > 0 ? (
            <div
              id="ak-sheet-suggestions"
              role="listbox"
              aria-label={L.suggestions}
              className="ak-sheet-suggestions"
            >
              {suggestions.map((spec, index) => (
                <div
                  key={spec.name}
                  id={`ak-sheet-suggestion-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === suggestion}
                  className="ak-sheet-suggestion"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    acceptSuggestion(spec.name);
                  }}
                >
                  <code>{spec.signature}</code> <span>{spec.description}</span>
                </div>
              ))}
            </div>
          ) : signature ? (
            <p className="ak-sheet-signature">
              <code>{signature.signature}</code> — {signature.description}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="ak-sheet-panel" role="tabpanel" id={`ak-sheet-panel-${sheet.id}`}>
        <SheetGrid
          content={content}
          sheet={shownSheet}
          ctx={ctx}
          label={L.grid(sheet.name)}
          selection={selection}
          highlights={references
            .filter((reference) => reference.sheet.toUpperCase() === sheet.name.toUpperCase())
            .map(({ rect, color }) => ({ rect, color }))}
          marks={marks}
          {...(overlay ? { editor: overlay } : {})}
          fillHandle={!readOnly && !editing && selection.ranges.length === 1}
          {...(fillPreview ? { fillPreview } : {})}
          gridRef={gridRef}
          onCellMouseDown={onCellMouseDown}
          onCellMouseEnter={onCellMouseEnter}
          onCellDoubleClick={(pos) => {
            if (pos.row !== active.row || pos.col !== active.col) setSelection(singleSelection(pos));
            startEditing(pos, cellEditText(sheet.cells[cellKey(pos.row, pos.col)], ctx.locale));
          }}
          onHeaderMouseDown={onHeaderMouseDown}
          {...(readOnly ? {} : { onResizeMouseDown, onFillMouseDown })}
          onKeyDown={onGridKeyDown}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
        />
      </div>
      <div className="ak-sheet-status" role="status" aria-live="polite">
        {status}
      </div>
      <div className="ak-sheet-tabs">
        <div role="tablist" aria-label={L.sheets} className="ak-sheet-tablist">
          {visible.map((item) =>
            renaming?.id === item.id ? (
              <input
                key={item.id}
                className="ak-sheet-tab-input"
                aria-label={L.renameSheet}
                value={renaming.name}
                maxLength={31}
                onChange={(event) => setRenaming({ id: item.id, name: event.target.value })}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename();
                  if (event.key === 'Escape') setRenaming(undefined);
                }}
              />
            ) : (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === sheet.id}
                aria-controls={`ak-sheet-panel-${item.id}`}
                className="ak-sheet-tab"
                draggable={!readOnly}
                onClick={() => switchSheet(item.id)}
                onDoubleClick={() => !readOnly && setRenaming({ id: item.id, name: item.name })}
                onKeyDown={(event) => {
                  if (readOnly) return;
                  if (event.key === 'F2') setRenaming({ id: item.id, name: item.name });
                  if (
                    event.altKey &&
                    event.shiftKey &&
                    (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                  ) {
                    event.preventDefault();
                    const position = content.sheets.findIndex((candidate) => candidate.id === item.id) + 1;
                    moveSheet(item.id, position + (event.key === 'ArrowLeft' ? -1 : 1));
                  }
                }}
                onDragStart={(event) => {
                  dragSheet.current = item.id;
                  event.dataTransfer?.setData('text/plain', item.id);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = dragSheet.current ?? event.dataTransfer?.getData('text/plain');
                  dragSheet.current = undefined;
                  if (id)
                    moveSheet(id, content.sheets.findIndex((candidate) => candidate.id === item.id) + 1);
                }}
              >
                {item.name}
              </button>
            ),
          )}
        </div>
        {readOnly ? null : (
          <div className="ak-sheet-tab-actions">
            <IconButton icon={Plus} label={L.addSheet} variant="quiet" size="sm" onClick={addSheet} />
            <IconButton
              icon={PencilLine}
              label={L.renameSheet}
              variant="quiet"
              size="sm"
              onClick={() => setRenaming({ id: sheet.id, name: sheet.name })}
            />
            <IconButton
              icon={EyeOff}
              label={L.hideSheet}
              variant="quiet"
              size="sm"
              disabled={visible.length < 2}
              onClick={() => send([{ op: 'set_sheet_hidden', sheet: sheet.id, hidden: true }])}
            />
            {content.sheets.some((candidate) => candidate.hidden) ? (
              <select
                className="ak-ctl-select"
                data-size="sm"
                aria-label={L.showSheet}
                value=""
                onChange={(event) => {
                  if (event.target.value)
                    send([{ op: 'set_sheet_hidden', sheet: event.target.value, hidden: false }]);
                }}
              >
                <option value="">{L.showSheet}</option>
                {content.sheets
                  .filter((candidate) => candidate.hidden)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            ) : null}
            <IconButton
              icon={Trash2}
              label={L.deleteSheet}
              variant="danger"
              size="sm"
              disabled={content.sheets.length < 2}
              onClick={() => setDialog('delete-sheet')}
            />
          </div>
        )}
      </div>
      {dialog === 'delete-sheet' ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ak-sheet-delete-title"
          className="ak-sheet-dialog"
        >
          <p id="ak-sheet-delete-title">{L.confirmDelete(sheet.name)}</p>
          <div className="ak-sheet-dialog-actions">
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                setDialog(undefined);
                send([{ op: 'remove_sheet', sheet: sheet.id }]);
              }}
            >
              {L.confirm}
            </Button>
            <Button onClick={() => setDialog(undefined)}>{L.cancel}</Button>
          </div>
        </div>
      ) : null}
      {dialog === 'names' ? (
        <NamesDialog
          content={content}
          defaultRef={`${quoteSheetName(sheet.name)}!${absoluteRange(rectWithin(range, used))}`}
          readOnly={readOnly}
          labels={L}
          onSet={(name, ref) => send([{ op: 'set_name', name, ref }])}
          onRemove={(name) => send([{ op: 'remove_name', name }])}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </div>
  );
}

function rectWithin(rect: Rect, used: { rows: number; cols: number }): Rect {
  return {
    top: rect.top,
    left: rect.left,
    bottom: Math.max(rect.top, Math.min(rect.bottom, used.rows - 1)),
    right: Math.max(rect.left, Math.min(rect.right, used.cols - 1)),
  };
}

function absoluteRange(rect: Rect): string {
  const part = (row: number, col: number) => `$${columnLetter(col)}$${row + 1}`;
  const a = part(rect.top, rect.left);
  return rect.top === rect.bottom && rect.left === rect.right ? a : `${a}:${part(rect.bottom, rect.right)}`;
}

/** Formula text with each reference colored like its outline on the grid. */
function renderColored(text: string, references: { start: number; end: number; color: string }[]) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.start > cursor) parts.push(text.slice(cursor, reference.start));
    parts.push(
      <span key={reference.start} style={{ color: reference.color }}>
        {text.slice(reference.start, reference.end)}
      </span>,
    );
    cursor = reference.end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

function NamesDialog(props: {
  content: SheetContent;
  defaultRef: string;
  readOnly: boolean;
  labels: ReturnType<typeof editorLabels>;
  onSet(name: string, ref: string): void;
  onRemove(name: string): void;
  onClose(): void;
}) {
  const L = props.labels;
  const [name, setName] = useState('');
  const [ref, setRef] = useState(props.defaultRef);
  const names = props.content.names ?? [];
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ak-sheet-names-title" className="ak-sheet-dialog">
      <h2 id="ak-sheet-names-title">{L.names}</h2>
      {names.length === 0 ? <p>{L.noNames}</p> : null}
      <ul className="ak-sheet-names">
        {names.map((item) => (
          <li key={item.name}>
            <code>{item.name}</code> = <code>{item.ref}</code>
            {props.readOnly ? null : (
              <IconButton
                icon={X}
                label={L.removeName(item.name)}
                variant="quiet"
                size="sm"
                onClick={() => props.onRemove(item.name)}
              />
            )}
          </li>
        ))}
      </ul>
      {props.readOnly ? null : (
        <form
          className="ak-sheet-names-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !ref.trim()) return;
            props.onSet(name.trim(), ref.trim());
            setName('');
          }}
        >
          <label className="ak-ctl-field">
            <span className="ak-ctl-label">{L.name}</span>
            <input className="ak-ctl-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="ak-ctl-field">
            <span className="ak-ctl-label">{L.reference}</span>
            <input className="ak-ctl-input" value={ref} onChange={(event) => setRef(event.target.value)} />
          </label>
          <Button type="submit" variant="primary" icon={Plus}>
            {L.addName}
          </Button>
        </form>
      )}
      <div className="ak-sheet-dialog-actions">
        <Button onClick={props.onClose}>{L.close}</Button>
      </div>
    </div>
  );
}
