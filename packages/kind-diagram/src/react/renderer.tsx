import { type RenderContext, themeCssVariables } from '@artkit-ai/core';
import { Toolbar, ToolbarButton, ToolbarGroup, useOptionalArtkit } from '@artkit-ai/react';
import { ChevronDown, ChevronUp, Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { describeDiagram } from '../describe.js';
import { type DiagramLayout, type LayoutEngine, layoutDiagram } from '../layout/index.js';
import { buildDiagramScene } from '../scene.js';
import type { DiagramContent } from '../schema.js';
import { msg } from '../text.js';
import { renderSceneElement } from './svg-element.js';

export interface DiagramRendererProps {
  content: DiagramContent;
  ctx: RenderContext;
  className?: string;
  /** Precomputed layout (e.g. from `layoutDiagramAsync` with an elkjs adapter). */
  layout?: DiagramLayout;
  /** Synchronous layout engine replacing the built-in ones. */
  engine?: LayoutEngine;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;

interface View {
  zoom: number;
  /** Center of the view in diagram units. */
  cx: number;
  cy: number;
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Ids of the nodes whose label (or id) contains the query, accent and case insensitive, in reading order. */
export function findDiagramNodes(content: DiagramContent, layout: DiagramLayout, query: string): string[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const labels = new Map(content.nodes.map((node) => [node.id, `${node.label} ${node.id}`]));
  return [...layout.nodes]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .filter((node) => fold(labels.get(node.id) ?? '').includes(needle))
    .map((node) => node.id);
}

/**
 * Read-only SVG renderer. Screen mode adds zoom and pan (wheel, drag, toolbar buttons and keyboard:
 * + / - / 0 and arrows); print mode renders the whole diagram at its natural size.
 */
export function DiagramRenderer({ content, ctx, className, layout: given, engine }: DiagramRendererProps) {
  const layout = useMemo(
    () => given ?? layoutDiagram(content, engine ? { engine } : {}),
    [content, given, engine],
  );
  const scene = useMemo(() => buildDiagramScene(content, layout), [content, layout]);
  const description = useMemo(() => describeDiagram(content, ctx.locale), [content, ctx.locale]);
  const baseId = `ak-diagram-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const markers = { start: `${baseId}-arrow-start`, end: `${baseId}-arrow-end` };
  const { bounds } = layout;
  const home: View = { zoom: 1, cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2 };
  const [view, setView] = useState<View>(home);
  const viewRef = useRef(view);
  viewRef.current = view;
  const homeKey = `${bounds.x}|${bounds.y}|${bounds.width}|${bounds.height}`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: View; pointer: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const interactive = ctx.mode === 'screen';
  const hosted = useOptionalArtkit() !== null;
  const t = (en: string, pt: string) => msg(ctx.locale, en, pt);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const matches = useMemo(() => findDiagramNodes(content, layout, query), [content, layout, query]);
  const current = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : undefined;
  const placed = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Center the view on the current match.
  useEffect(() => {
    const node = current ? placed.get(current) : undefined;
    if (!node) return;
    setView((view) => ({ ...view, cx: node.x + node.width / 2, cy: node.y + node.height / 2 }));
  }, [current, placed]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    setMatchIndex((index) => (index + delta + matches.length) % matches.length);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the view only when the drawing area changes.
  useEffect(() => {
    setView({ zoom: 1, cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2 });
  }, [homeKey]);

  const unitsPerPixel = useCallback(
    (zoom: number) => {
      const width = svgRef.current?.getBoundingClientRect().width ?? 0;
      return width > 0 ? bounds.width / zoom / width : 1 / zoom;
    },
    [bounds.width],
  );

  const zoomBy = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      if (!anchor) return { ...current, zoom };
      // Keep the diagram point under the pointer fixed while zooming.
      const ratio = current.zoom / zoom;
      return {
        zoom,
        cx: anchor.x + (current.cx - anchor.x) * ratio,
        cy: anchor.y + (current.cy - anchor.y) * ratio,
      };
    });
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!interactive || !element) return;
    // React registers wheel listeners as passive; a native listener is needed to keep the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      let anchor: { x: number; y: number } | undefined;
      if (rect && rect.width > 0 && rect.height > 0) {
        const current = viewRef.current;
        const w = bounds.width / current.zoom;
        const h = bounds.height / current.zoom;
        anchor = {
          x: current.cx - w / 2 + ((event.clientX - rect.left) / rect.width) * w,
          y: current.cy - h / 2 + ((event.clientY - rect.top) / rect.height) * h,
        };
      }
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, anchor);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [interactive, zoomBy, bounds.width, bounds.height]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return;
    if ((event.target as Element).closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, view, pointer: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanning(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const scale = unitsPerPixel(start.view.zoom);
    setView({
      ...start.view,
      cx: start.view.cx - (event.clientX - start.x) * scale,
      cy: start.view.cy - (event.clientY - start.y) * scale,
    });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setPanning(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const step = 40 * unitsPerPixel(view.zoom);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') setView(home);
    else if (moves[event.key]) {
      const [dx, dy] = moves[event.key]!;
      setView((current) => ({ ...current, cx: current.cx + dx, cy: current.cy + dy }));
    } else return;
    event.preventDefault();
  };

  const zoom = interactive ? view.zoom : 1;
  const w = bounds.width / zoom;
  const h = bounds.height / zoom;
  const cx = interactive ? view.cx : home.cx;
  const cy = interactive ? view.cy : home.cy;
  const viewBox = `${round(cx - w / 2)} ${round(cy - h / 2)} ${round(w)} ${round(h)}`;
  const classes = [
    'ak-diagram',
    `ak-diagram--${ctx.mode}`,
    ctx.provisional ? 'ak-diagram--provisional' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = t('Diagram', 'Diagrama');

  const svg = (
    <svg
      ref={svgRef}
      className="ak-diagram-svg"
      xmlns="http://www.w3.org/2000/svg"
      width={bounds.width}
      height={bounds.height}
      viewBox={viewBox}
      role="img"
      aria-labelledby={`${baseId}-title`}
      aria-describedby={`${baseId}-desc`}
    >
      <title id={`${baseId}-title`}>{title}</title>
      <desc id={`${baseId}-desc`}>{description}</desc>
      <defs>
        <marker
          id={markers.end}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="10"
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path className="ak-diagram-marker" d="M0 0L10 5L0 10z" />
        </marker>
        <marker
          id={markers.start}
          viewBox="0 0 10 10"
          refX="0"
          refY="5"
          markerWidth="10"
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path className="ak-diagram-marker" d="M10 0L0 5L10 10z" />
        </marker>
      </defs>
      <g className="ak-diagram-groups">
        {scene.groups.map((element, index) => renderSceneElement(element, index))}
      </g>
      <g className="ak-diagram-edges">
        {scene.edges.map((element, index) => renderSceneElement(element, index, markers))}
      </g>
      <g className="ak-diagram-group-labels">
        {scene.groupLabels.map((element, index) => renderSceneElement(element, index))}
      </g>
      <g className="ak-diagram-nodes">
        {scene.nodes.map((element, index) => renderSceneElement(element, index))}
      </g>
      {matches.length > 0 ? (
        <g className="ak-diagram-matches">
          {matches.map((id) => {
            const node = placed.get(id);
            return node ? (
              <rect
                key={id}
                className={`ak-diagram-match${id === current ? ' is-current' : ''}`}
                x={node.x - 5}
                y={node.y - 5}
                width={node.width + 10}
                height={node.height + 10}
                rx={10}
              />
            ) : null;
          })}
        </g>
      ) : null}
    </svg>
  );

  return (
    <figure
      className={classes}
      // Inside <ArtifactProvider> the host sets the theme variables (with dark mode); standalone uses the artifact theme.
      style={hosted && interactive ? undefined : (themeCssVariables(ctx.theme) as CSSProperties)}
      data-engine={layout.engine}
    >
      {interactive && (
        <Toolbar
          label={t('Diagram viewer', 'Visualizador de diagrama')}
          className="ak-diagram-toolbar"
          sticky={false}
        >
          <ToolbarGroup label={t('Find', 'Localizar')}>
            <label className="ak-diagram-search">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={t('Find node', 'Localizar nó')}
                aria-label={t('Find node', 'Localizar nó')}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setMatchIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    step(event.shiftKey ? -1 : 1);
                  } else if (event.key === 'Escape') setQuery('');
                }}
              />
              {query ? (
                <span className="ak-diagram-search-count" aria-live="polite">
                  {matches.length === 0
                    ? t('No results', 'Nada encontrado')
                    : `${Math.min(matchIndex, matches.length - 1) + 1}/${matches.length}`}
                </span>
              ) : null}
            </label>
            <ToolbarButton
              icon={ChevronUp}
              label={t('Previous match', 'Resultado anterior')}
              disabled={matches.length < 2}
              keepFocus={false}
              onClick={() => step(-1)}
            />
            <ToolbarButton
              icon={ChevronDown}
              label={t('Next match', 'Próximo resultado')}
              disabled={matches.length < 2}
              keepFocus={false}
              onClick={() => step(1)}
            />
          </ToolbarGroup>
          <ToolbarGroup label={t('Zoom', 'Zoom')}>
            <ToolbarButton
              icon={ZoomOut}
              label={t('Zoom out', 'Afastar')}
              keepFocus={false}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            />
            <span className="ak-diagram-zoom" aria-live="polite">
              {Math.round(view.zoom * 100)}%
            </span>
            <ToolbarButton
              icon={ZoomIn}
              label={t('Zoom in', 'Aproximar')}
              keepFocus={false}
              onClick={() => zoomBy(ZOOM_STEP)}
            />
            <ToolbarButton
              icon={Maximize2}
              label={t('Reset view', 'Restaurar visão')}
              keepFocus={false}
              onClick={() => setView(home)}
            />
          </ToolbarGroup>
        </Toolbar>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a pan/zoom surface, not a form fieldset. */}
      <div
        ref={viewportRef}
        className="ak-diagram-viewport"
        role="group"
        aria-label={
          interactive
            ? t(
                'Diagram view: + and - zoom, arrows pan, 0 resets',
                'Visão do diagrama: + e - aproximam, setas movem, 0 restaura',
              )
            : t('Diagram', 'Diagrama')
        }
        tabIndex={interactive ? 0 : undefined}
        data-panning={panning ? 'true' : undefined}
        data-zoom={round(zoom)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {svg}
      </div>
    </figure>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
