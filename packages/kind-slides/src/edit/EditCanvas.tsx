import type { Color, LintIssue } from '@artkit/core';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  OnDrag,
  OnDragGroup,
  OnDragGroupStart,
  OnDragStart,
  OnResize,
  OnResizeStart,
} from 'react-moveable';
import {
  composeSlide,
  DEFAULT_SHAPE_TEXT_STYLE,
  type ResolvedTextStyle,
  resolveTextStyle,
} from '../compose.js';
import { textElementParagraphs } from '../elements.js';
import { CANVAS, pctX, pctY, type Rect } from '../geometry.js';
import { type LayoutDefinition, type LayoutRegistry, TYPOGRAPHY } from '../layouts.js';
import type { SlidesOperation } from '../operations.js';
import { boxStyle } from '../react/Primitives.js';
import { SlideView } from '../react/SlideView.js';
import type { Footer, Slide, SlideElement, SlotContent } from '../schema.js';
import { type NormalizedParagraph, normalizeParagraphs } from '../text.js';
import {
  boundingRect,
  clampPosition,
  clampSize,
  type Direction,
  type Guide,
  moveRect,
  nudgeRect,
  rectChanged,
  resizeRect,
  snapMove,
  snapResize,
} from './geometry.js';
import { Moveable, type MoveableInstance } from './moveable.js';
import { RichTextEditor } from './RichTextEditor.js';
import { toTextFields } from './rich-text.js';
import type { EditorEnv, Selection, TextTarget } from './types.js';

export interface EditCanvasProps {
  env: EditorEnv;
  slide: Slide;
  slideNumber: number;
  footer?: Footer;
  layouts: LayoutRegistry;
  layout: LayoutDefinition;
  selection: Selection;
  onSelect(selection: Selection): void;
  editing: TextTarget | undefined;
  onEdit(target: TextTarget | undefined): void;
  /** Grid step in inches; undefined disables the grid. */
  grid?: number;
  onCopy?(): void;
  onCut?(): void;
  onPaste?(): void;
  onDuplicate?(): void;
}

/** Pixels per inch of the rendered canvas. jsdom has no layout, so fall back to 72 px per inch. */
function pixelsPerInch(element: HTMLElement | null): number {
  const width = element?.getBoundingClientRect().width || element?.offsetWidth || 0;
  return width > 0 ? width / CANVAS.width : 72;
}

const isLine = (element: SlideElement) =>
  element.type === 'shape' && (element.shape === 'line' || element.shape === 'arrow');

/** Hit area of an element: lines get a minimum thickness so they can be grabbed. */
function hitRect(element: SlideElement): Rect {
  const min = 0.12;
  const w = Math.max(element.w, min);
  const h = Math.max(element.h, min);
  return { x: element.x - (w - element.w) / 2, y: element.y - (h - element.h) / 2, w, h };
}

function textTargetData(
  slide: Slide,
  layout: LayoutDefinition,
  target: TextTarget,
): { paragraphs: NormalizedParagraph[]; style: ResolvedTextStyle; rect: Rect; fill?: Color } | undefined {
  if (target.kind === 'element') {
    const element = slide.elements.find((candidate) => candidate.id === target.id);
    if (element?.type === 'text')
      return {
        paragraphs: textElementParagraphs(element),
        style: resolveTextStyle(element),
        rect: element,
        ...(element.fill ? { fill: element.fill } : {}),
      };
    if (element?.type === 'shape' && !isLine(element)) {
      return {
        paragraphs: element.text
          ? normalizeParagraphs(element.text.paragraphs)
          : [{ runs: [{ text: '' }], level: 0 }],
        style: resolveTextStyle(element.text ?? {}, DEFAULT_SHAPE_TEXT_STYLE),
        rect: element,
      };
    }
    return undefined;
  }
  const slot = layout.slots.find((candidate) => candidate.name === target.slot);
  if (!slot) return undefined;
  const content = slide.slots[slot.name];
  const role = TYPOGRAPHY[slot.role];
  const style: ResolvedTextStyle = {
    fontSize: slot.fontSize ?? role.fontSize,
    font: role.font,
    bold: role.bold,
    italic: role.italic,
    color: slot.color ?? role.color,
    align: slot.align ?? 'left',
    valign: slot.valign ?? 'top',
  };
  if (content === undefined)
    return { paragraphs: [{ runs: [{ text: '' }], level: 0 }], style, rect: slot.box };
  if (typeof content === 'string')
    return { paragraphs: normalizeParagraphs(content.split(/\r?\n/)), style, rect: slot.box };
  if (content.type === 'text' || content.type === 'bullets') {
    const paragraphs =
      content.type === 'text'
        ? normalizeParagraphs(content.paragraphs)
        : normalizeParagraphs(content.items, 'bullet');
    return {
      paragraphs,
      style: resolveTextStyle(content, style),
      rect: slot.box,
    };
  }
  return undefined;
}

/** Slot content after a text edit: plain strings stay strings; lists and formatting need objects. */
function slotTextContent(
  previous: SlotContent | undefined,
  paragraphs: NormalizedParagraph[],
  accepts: readonly string[],
): SlotContent | null {
  const plain = paragraphs.every(
    (paragraph) => !paragraph.list && paragraph.runs.every((run) => Object.keys(run).length === 1),
  );
  const text = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
  if (text.trim() === '' && paragraphs.length <= 1) return null;
  const style =
    typeof previous === 'object' && (previous.type === 'text' || previous.type === 'bullets')
      ? previous
      : undefined;
  const { type: _type, ...styleFields } = style ?? { type: 'text' };
  const { paragraphs: _p, items: _i, ...rest } = styleFields as Record<string, unknown>;
  if (plain && !style && accepts.includes('text')) return text;
  const fields = toTextFields(
    paragraphs,
    accepts.includes('bullets') && (style?.type === 'bullets' || !accepts.includes('text')),
  );
  if ('bullets' in fields) return { ...rest, type: 'bullets', items: fields.bullets } as SlotContent;
  return { ...rest, type: 'text', paragraphs: fields.paragraphs } as SlotContent;
}

/**
 * The editing surface: the slide drawn by the read-only renderer, with hit areas, selection handles
 * (react-moveable), smart guides, an optional grid and in-place text editing on top.
 */
export function EditCanvas({
  env,
  slide,
  slideNumber,
  footer,
  layouts,
  layout,
  selection,
  onSelect,
  editing,
  onEdit,
  grid,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
}: EditCanvasProps): ReactElement {
  const { t, readOnly } = env;
  const overlay = useRef<HTMLDivElement>(null);
  const hitRefs = useRef(new Map<string, HTMLDivElement>());
  const moveable = useRef<MoveableInstance>(null);
  const pendingDrag = useRef<MouseEvent | undefined>(undefined);
  const gesture = useRef<{ start: Map<string, Rect>; direction?: [Direction, Direction] } | undefined>(
    undefined,
  );
  const [preview, setPreview] = useState<Map<string, Rect> | undefined>(undefined);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [targets, setTargets] = useState<HTMLDivElement[]>([]);

  const selectedIds = selection.kind === 'elements' ? selection.ids : [];
  const selectedKey = selectedIds.join('|');
  const shown = useMemo<Slide>(
    () =>
      preview
        ? {
            ...slide,
            elements: slide.elements.map((element) =>
              preview.has(element.id) ? { ...element, ...preview.get(element.id)! } : element,
            ),
          }
        : slide,
    [slide, preview],
  );
  const composed = composeSlide(slide, { layouts, ...(footer ? { footer } : {}), slideNumber });
  const issuesByTarget = useMemo(() => {
    const map = new Map<string, LintIssue[]>();
    for (const issue of env.lint) map.set(issue.target, [...(map.get(issue.target) ?? []), issue]);
    return map;
  }, [env.lint]);

  // Moveable needs the DOM nodes of the selected hit areas; collect them after render.
  useLayoutEffect(() => {
    const nodes = selectedKey
      .split('|')
      .filter(Boolean)
      .map((id) => hitRefs.current.get(id))
      .filter((node): node is HTMLDivElement => !!node);
    setTargets((current) =>
      current.length === nodes.length && current.every((node, i) => node === nodes[i]) ? current : nodes,
    );
  }, [selectedKey]);

  // Start dragging right away when the pointer went down on an element that was not selected yet.
  useLayoutEffect(() => {
    const event = pendingDrag.current;
    if (event && targets.length > 0 && moveable.current) {
      pendingDrag.current = undefined;
      moveable.current.dragStart(event, event.target);
    }
    moveable.current?.updateRect();
  }, [targets]);

  const others = (exclude: ReadonlySet<string>): Rect[] => [
    ...slide.elements
      .filter((element) => !exclude.has(element.id))
      .map((element) => ({ x: element.x, y: element.y, w: element.w, h: element.h })),
    ...layout.slots.filter((slot) => slide.slots[slot.name] !== undefined).map((slot) => slot.box),
  ];
  const elementById = (id: string) => slide.elements.find((element) => element.id === id);
  const scale = () => pixelsPerInch(overlay.current);

  const commitGesture = () => {
    const start = gesture.current?.start;
    const result = preview;
    gesture.current = undefined;
    setPreview(undefined);
    setGuides([]);
    if (!start || !result) return;
    const ops: SlidesOperation[] = [];
    for (const [id, rect] of result) {
      const before = start.get(id);
      if (!before || !rectChanged(before, rect)) continue;
      const set: Record<string, number> = {};
      if (Math.abs(before.x - rect.x) > 1e-4) set.x = rect.x;
      if (Math.abs(before.y - rect.y) > 1e-4) set.y = rect.y;
      if (Math.abs(before.w - rect.w) > 1e-4) set.w = rect.w;
      if (Math.abs(before.h - rect.h) > 1e-4) set.h = rect.h;
      ops.push({ op: 'update_element', element: id, set });
    }
    if (ops.length > 0) env.emit(ops, { kind: 'continuous' });
  };

  const startGesture = (ids: string[], direction?: [Direction, Direction]) => {
    const start = new Map<string, Rect>();
    for (const id of ids) {
      const element = elementById(id);
      if (element) start.set(id, { x: element.x, y: element.y, w: element.w, h: element.h });
    }
    gesture.current = { start, ...(direction ? { direction } : {}) };
  };

  const dragTo = (dist: number[]) => {
    const start = gesture.current?.start;
    if (!start || start.size === 0) return;
    const ppi = scale();
    const dx = (dist[0] ?? 0) / ppi;
    const dy = (dist[1] ?? 0) / ppi;
    const ids = [...start.keys()];
    const bounds = boundingRect([...start.values()]);
    const moved = moveRect(bounds, dx, dy);
    const snapped = snapMove(moved, others(new Set(ids)), grid ? { grid } : {});
    const clamped = clampPosition(snapped.rect);
    const offsetX = clamped.x - bounds.x;
    const offsetY = clamped.y - bounds.y;
    const next = new Map<string, Rect>();
    for (const [id, rect] of start)
      next.set(id, clampPosition({ ...rect, x: rect.x + offsetX, y: rect.y + offsetY }));
    setPreview(next);
    setGuides(snapped.guides);
  };

  const resizeTo = (event: OnResize) => {
    const current = gesture.current;
    const id = [...(current?.start.keys() ?? [])][0];
    const start = id ? current?.start.get(id) : undefined;
    const element = id ? elementById(id) : undefined;
    if (!id || !start || !element || !current) return;
    const direction = (current.direction ?? [event.direction[0] ?? 0, event.direction[1] ?? 0]) as [
      Direction,
      Direction,
    ];
    const ppi = scale();
    const keepRatio = element.type === 'image' || !!(event.inputEvent as MouseEvent | undefined)?.shiftKey;
    const minSize = isLine(element) ? 0 : 0.1;
    const rect = resizeRect(start, direction, (event.dist[0] ?? 0) / ppi, (event.dist[1] ?? 0) / ppi, {
      keepRatio,
      minSize,
    });
    const snapped = snapResize(rect, direction, others(new Set([id])), {
      keepRatio,
      ...(grid ? { grid } : {}),
    });
    setPreview(new Map([[id, clampSize(snapped.rect)]]));
    setGuides(snapped.guides);
  };

  const onElementPointerDown = (event: PointerEvent<HTMLDivElement>, id: string) => {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    overlay.current?.parentElement?.closest<HTMLElement>('.ak-slides-canvas')?.focus({ preventScroll: true });
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (additive) {
      const ids = selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id];
      onSelect(ids.length > 0 ? { kind: 'elements', ids } : { kind: 'none' });
      return;
    }
    if (!selectedIds.includes(id)) {
      pendingDrag.current = event.nativeEvent;
      onSelect({ kind: 'elements', ids: [id] });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || readOnly) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (key === 'Escape') {
      onSelect({ kind: 'none' });
    } else if ((key === 'Delete' || key === 'Backspace') && selectedIds.length > 0) {
      env.emit(selectedIds.map((id) => ({ op: 'remove_element', element: id })));
      onSelect({ kind: 'none' });
    } else if ((key === 'Delete' || key === 'Backspace') && selection.kind === 'slot') {
      env.emit([{ op: 'set_slot', slide: slide.id, slot: selection.slot, content: null }]);
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      if (selectedIds.length === 0) return;
      const step = event.shiftKey ? 0.5 : 0.05;
      const ops: SlidesOperation[] = [];
      for (const id of selectedIds) {
        const element = elementById(id);
        if (!element) continue;
        const rect = nudgeRect(element, key, step, event.altKey);
        if (!rectChanged(element, rect)) continue;
        ops.push({
          op: 'update_element',
          element: id,
          set: event.altKey ? { w: rect.w, h: rect.h } : { x: rect.x, y: rect.y },
        });
      }
      // Repeated nudges are batched by the host like keystrokes.
      if (ops.length > 0) env.emit(ops, { kind: 'typing' });
    } else if (mod && (key === 'a' || key === 'A')) {
      onSelect(
        slide.elements.length > 0
          ? { kind: 'elements', ids: slide.elements.map((element) => element.id) }
          : { kind: 'none' },
      );
    } else if (mod && (key === 'd' || key === 'D') && selectedIds.length > 0) {
      onDuplicate?.();
    } else if (mod && (key === 'c' || key === 'C') && selectedIds.length > 0 && onCopy) {
      onCopy();
    } else if (mod && (key === 'x' || key === 'X') && selectedIds.length > 0 && onCut) {
      onCut();
    } else if (mod && (key === 'v' || key === 'V') && onPaste) {
      onPaste();
    } else if (key === 'Enter') {
      if (selectedIds.length === 1) onEdit({ kind: 'element', id: selectedIds[0]! });
      else if (selection.kind === 'slot') onEdit({ kind: 'slot', slot: selection.slot });
      else return;
    } else if (key === 'Tab' && slide.elements.length > 0) {
      const index =
        selectedIds.length === 1 ? slide.elements.findIndex((element) => element.id === selectedIds[0]) : -1;
      const next = (index + (event.shiftKey ? -1 : 1) + slide.elements.length) % slide.elements.length;
      onSelect({ kind: 'elements', ids: [slide.elements[next]!.id] });
    } else return;
    event.preventDefault();
  };

  const editData = editing ? textTargetData(slide, layout, editing) : undefined;
  const commitText = (paragraphs: NormalizedParagraph[]) => {
    const target = editing;
    onEdit(undefined);
    if (!target) return;
    if (target.kind === 'slot') {
      const slot = layout.slots.find((candidate) => candidate.name === target.slot);
      if (!slot) return;
      const previous = slide.slots[slot.name];
      const next = slotTextContent(previous, paragraphs, slot.accepts);
      if (JSON.stringify(next) !== JSON.stringify(previous ?? null))
        env.emit([{ op: 'set_slot', slide: slide.id, slot: slot.name, content: next }], { kind: 'typing' });
      return;
    }
    const element = elementById(target.id);
    if (element?.type === 'text') {
      const fields = toTextFields(paragraphs, element.bullets !== undefined);
      const before = 'bullets' in fields ? element.bullets : element.paragraphs;
      const after = 'bullets' in fields ? fields.bullets : fields.paragraphs;
      if (JSON.stringify(before) !== JSON.stringify(after))
        env.emit([{ op: 'update_element', element: element.id, set: fields }], { kind: 'typing' });
    } else if (element?.type === 'shape') {
      const empty = paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text === ''));
      const fields = toTextFields(paragraphs, false);
      const text = empty
        ? null
        : {
            ...(element.text ?? {}),
            paragraphs: 'paragraphs' in fields ? fields.paragraphs : fields.bullets,
          };
      env.emit([{ op: 'update_element', element: element.id, set: { text } }], { kind: 'typing' });
    }
  };

  const single = selectedIds.length === 1 ? elementById(selectedIds[0]!) : undefined;
  const slotIssues = (name: string) => issuesByTarget.get(`slot:${slide.id}.${name}`) ?? [];
  const overflowClass = (issues: LintIssue[]) =>
    issues.some((issue) => issue.code === 'text-overflow' || issue.code === 'table-overflow')
      ? ' ak-slides-overflow'
      : '';

  return (
    <div
      className={`ak-slides-canvas${readOnly ? ' ak-slides-readonly' : ''}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes keyboard commands (nudge, delete, select).
      tabIndex={0}
      role="application"
      aria-roledescription={t('slide editor', 'editor de slide')}
      aria-label={t(`Slide ${slideNumber} canvas`, `Área do slide ${slideNumber}`)}
      onKeyDown={onKeyDown}
    >
      <SlideView
        slide={shown}
        ctx={env.ctx}
        layouts={layouts}
        {...(footer ? { footer } : {})}
        slideNumber={slideNumber}
      >
        <div
          ref={overlay}
          className="ak-slides-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !editing) onSelect({ kind: 'none' });
          }}
        >
          {grid ? (
            <div
              className="ak-slides-grid-lines"
              style={{ backgroundSize: `${pctX(grid)} ${pctY(grid)}` } as CSSProperties}
              aria-hidden="true"
            />
          ) : null}
          {layout.slots.map((slot) => {
            const empty = slide.slots[slot.name] === undefined;
            const issues = slotIssues(slot.name);
            const selected = selection.kind === 'slot' && selection.slot === slot.name;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: direct-manipulation target; the canvas offers keyboard equivalents (Tab, Enter, arrows).
              <div
                key={`slot-${slot.name}`}
                className={`ak-slides-slot-box${empty ? ' ak-slides-slot-empty' : ''}${selected ? ' ak-slides-selected' : ''}${overflowClass(issues)}`}
                style={boxStyle(slot.box)}
                data-slot={slot.name}
                title={issues.map((issue) => issue.message).join('\n') || undefined}
                onPointerDown={(event) => {
                  if (readOnly || event.button !== 0) return;
                  event.stopPropagation();
                  onSelect({ kind: 'slot', slot: slot.name });
                }}
                onDoubleClick={() => {
                  if (!readOnly && (slot.accepts.includes('text') || slot.accepts.includes('bullets')))
                    onEdit({ kind: 'slot', slot: slot.name });
                }}
              >
                {empty ? <span className="ak-slides-slot-placeholder">{slot.label ?? slot.name}</span> : null}
                {issues.length > 0 && overflowClass(issues) ? (
                  <span className="ak-slides-overflow-badge" aria-hidden="true">
                    !
                  </span>
                ) : null}
              </div>
            );
          })}
          {shown.elements.map((element) => {
            const selected = selectedIds.includes(element.id);
            const issues = issuesByTarget.get(`element:${element.id}`) ?? [];
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: direct-manipulation target; the canvas offers keyboard equivalents (Tab, Enter, arrows).
              <div
                key={element.id}
                ref={(node) => {
                  if (node) hitRefs.current.set(element.id, node);
                  else hitRefs.current.delete(element.id);
                }}
                className={`ak-slides-hit${selected ? ' ak-slides-selected' : ''}${overflowClass(issues)}`}
                style={boxStyle(hitRect(element))}
                data-element-id={element.id}
                title={issues.map((issue) => issue.message).join('\n') || undefined}
                onPointerDown={(event) => onElementPointerDown(event, element.id)}
                onDoubleClick={() => {
                  if (
                    !readOnly &&
                    (element.type === 'text' || (element.type === 'shape' && !isLine(element)))
                  )
                    onEdit({ kind: 'element', id: element.id });
                }}
              >
                {overflowClass(issues) ? (
                  <span className="ak-slides-overflow-badge" aria-hidden="true">
                    !
                  </span>
                ) : null}
              </div>
            );
          })}
          {guides.map((guide) => (
            <div
              key={`${guide.axis}-${guide.position}-${guide.from}`}
              className={`ak-slides-guide ak-slides-guide-${guide.axis}`}
              style={
                guide.axis === 'x'
                  ? { left: pctX(guide.position), top: pctY(guide.from), height: pctY(guide.to - guide.from) }
                  : { top: pctY(guide.position), left: pctX(guide.from), width: pctX(guide.to - guide.from) }
              }
              aria-hidden="true"
            />
          ))}
          {!readOnly && !editing && targets.length > 0 ? (
            <Moveable
              ref={moveable}
              target={targets.length === 1 ? targets[0]! : targets}
              draggable
              resizable={targets.length === 1 && !!single}
              keepRatio={single?.type === 'image'}
              throttleDrag={0}
              throttleResize={0}
              origin={false}
              renderDirections={
                single && isLine(single) ? ['w', 'e'] : ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']
              }
              onDragStart={(event: OnDragStart) =>
                startGesture(
                  selectedIds.length > 0 ? selectedIds : [event.target.getAttribute('data-element-id') ?? ''],
                )
              }
              onDrag={(event: OnDrag) => dragTo(event.dist)}
              onDragEnd={commitGesture}
              onDragGroupStart={(_event: OnDragGroupStart) => startGesture(selectedIds)}
              onDragGroup={(event: OnDragGroup) => dragTo(event.dist)}
              onDragGroupEnd={commitGesture}
              onResizeStart={(event: OnResizeStart) =>
                startGesture(selectedIds, [
                  (event.direction[0] ?? 0) as Direction,
                  (event.direction[1] ?? 0) as Direction,
                ])
              }
              onResize={resizeTo}
              onResizeEnd={commitGesture}
            />
          ) : null}
          {editing && editData ? (
            <RichTextEditor
              key={editing.kind === 'element' ? `e-${editing.id}` : `s-${editing.slot}`}
              paragraphs={editData.paragraphs}
              style={editData.style}
              rect={editData.rect}
              ctx={env.ctx}
              {...(editData.fill ? { fill: editData.fill } : {})}
              label={t('Edit text', 'Editar texto')}
              onCommit={commitText}
              onCancel={() => onEdit(undefined)}
            />
          ) : null}
        </div>
      </SlideView>
      <p className="ak-slides-sr-only" aria-live="polite">
        {selection.kind === 'elements' && selectedIds.length > 0
          ? t(`${selectedIds.length} selected`, `${selectedIds.length} selecionado(s)`)
          : selection.kind === 'slot'
            ? t(`Slot ${selection.slot} selected`, `Slot ${selection.slot} selecionado`)
            : ''}
      </p>
      {composed.unknownLayout ? (
        <p className="ak-slides-issue ak-slides-issue-warning">
          {t(`Unknown layout "${slide.layout}".`, `Layout "${slide.layout}" desconhecido.`)}
        </p>
      ) : null}
    </div>
  );
}
