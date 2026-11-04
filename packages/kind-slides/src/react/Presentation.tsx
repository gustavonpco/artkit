import type { RenderContext } from '@artkit-ai/core';
import { ChevronLeft, ChevronRight, MonitorSpeaker, TimerReset } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { tr } from '../i18n.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import type { SlidesContent } from '../schema.js';
import { SlideView } from './SlideView.js';

export interface SlidesPresentationProps {
  content: SlidesContent;
  ctx: RenderContext;
  layouts?: LayoutRegistry;
  /** Slide to start from (defaults to the first visible slide). */
  startSlideId?: string;
  onExit(): void;
  /** Called whenever the current slide changes. */
  onSlideChange?(slideId: string): void;
  /** Request browser fullscreen on open (default true). */
  fullscreen?: boolean;
  /** Start in presenter view (current slide, next slide, notes and timer). */
  presenter?: boolean;
}

/** Elapsed time as mm:ss (or h:mm:ss). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Keys handled by the presentation, exported for documentation and tests. */
export const PRESENTATION_KEYS = {
  next: ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'],
  previous: ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'],
  first: ['Home'],
  last: ['End'],
  notes: ['s'],
  presenter: ['v'],
  exit: ['Escape'],
} as const;

/** Fullscreen presentation of the visible slides with keyboard navigation and optional speaker notes. */
export function SlidesPresentation({
  content,
  ctx,
  layouts = builtInLayouts,
  startSlideId,
  onExit,
  onSlideChange,
  fullscreen = true,
  presenter: startInPresenter = false,
}: SlidesPresentationProps): ReactElement {
  const visible = content.slides
    .map((slide, index) => ({ slide, number: index + 1 }))
    .filter(({ slide }) => !slide.hidden);
  const initial = Math.max(
    0,
    visible.findIndex(({ slide }) => slide.id === startSlideId),
  );
  const [position, setPosition] = useState(initial);
  const [showNotes, setShowNotes] = useState(false);
  const [presenter, setPresenter] = useState(startInPresenter);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!presenter) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [presenter]);
  const root = useRef<HTMLDivElement>(null);
  const current = visible[Math.min(position, visible.length - 1)];

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(visible.length - 1, next));
      setPosition(clamped);
      const target = visible[clamped];
      if (target) onSlideChange?.(target.slide.id);
    },
    [visible, onSlideChange],
  );

  useEffect(() => {
    const element = root.current;
    element?.focus();
    const doc = element?.ownerDocument;
    if (fullscreen && element && doc?.fullscreenEnabled && typeof element.requestFullscreen === 'function') {
      element.requestFullscreen().catch(() => undefined);
    }
    const onFullscreenChange = () => {
      if (doc && !doc.fullscreenElement && fullscreen) onExit();
    };
    doc?.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      doc?.removeEventListener('fullscreenchange', onFullscreenChange);
      if (doc?.fullscreenElement && typeof doc.exitFullscreen === 'function')
        doc.exitFullscreen().catch(() => undefined);
    };
  }, [fullscreen, onExit]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    const has = (list: readonly string[]) => list.includes(key);
    if (has(PRESENTATION_KEYS.next)) go(position + 1);
    else if (has(PRESENTATION_KEYS.previous)) go(position - 1);
    else if (has(PRESENTATION_KEYS.first)) go(0);
    else if (has(PRESENTATION_KEYS.last)) go(visible.length - 1);
    else if (has(PRESENTATION_KEYS.notes)) setShowNotes((value) => !value);
    else if (has(PRESENTATION_KEYS.presenter)) setPresenter((value) => !value);
    else if (has(PRESENTATION_KEYS.exit)) onExit();
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={root}
      className={`ak-slides-presentation${presenter ? ' ak-slides-presenter' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={tr(ctx.locale, 'Presentation', 'Apresentação')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="ak-slides-presentation-stage">
        {current ? (
          <SlideView
            slide={current.slide}
            ctx={ctx}
            layouts={layouts}
            {...(content.footer ? { footer: content.footer } : {})}
            slideNumber={current.number}
          />
        ) : (
          <p>{tr(ctx.locale, 'No visible slides.', 'Nenhum slide visível.')}</p>
        )}
      </div>
      {presenter && current ? (
        <aside
          className="ak-slides-presenter-side"
          aria-label={tr(ctx.locale, 'Presenter view', 'Visão do apresentador')}
        >
          <div className="ak-slides-presenter-timer">
            <span role="timer" aria-label={tr(ctx.locale, 'Elapsed time', 'Tempo decorrido')}>
              {formatElapsed(now - startedAt)}
            </span>
            <button
              type="button"
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
              }}
            >
              <TimerReset aria-hidden="true" />
              {tr(ctx.locale, 'Reset', 'Reiniciar')}
            </button>
          </div>
          <h2>{tr(ctx.locale, 'Next', 'Próximo')}</h2>
          {visible[position + 1] ? (
            <div className="ak-slides-presenter-next">
              <SlideView
                slide={visible[position + 1]!.slide}
                ctx={ctx}
                layouts={layouts}
                {...(content.footer ? { footer: content.footer } : {})}
                slideNumber={visible[position + 1]!.number}
              />
            </div>
          ) : (
            <p>{tr(ctx.locale, 'End of the presentation.', 'Fim da apresentação.')}</p>
          )}
          <h2>{tr(ctx.locale, 'Speaker notes', 'Notas do apresentador')}</h2>
          <p className="ak-slides-presenter-notes">
            {current.slide.notes || tr(ctx.locale, 'No speaker notes.', 'Sem notas do apresentador.')}
          </p>
        </aside>
      ) : null}
      {showNotes && !presenter && current ? (
        <section
          className="ak-slides-presentation-notes"
          aria-label={tr(ctx.locale, 'Speaker notes', 'Notas do apresentador')}
        >
          {current.slide.notes || tr(ctx.locale, 'No speaker notes.', 'Sem notas do apresentador.')}
        </section>
      ) : null}
      <div className="ak-slides-presentation-bar">
        <span aria-live="polite">
          {visible.length > 0 ? position + 1 : 0} / {visible.length}
        </span>
        <button
          type="button"
          onClick={() => go(position - 1)}
          disabled={position === 0}
          aria-label={tr(ctx.locale, 'Previous slide', 'Slide anterior')}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => go(position + 1)}
          disabled={position >= visible.length - 1}
          aria-label={tr(ctx.locale, 'Next slide', 'Próximo slide')}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setShowNotes((value) => !value)} aria-pressed={showNotes}>
          {tr(ctx.locale, 'Notes', 'Notas')}
        </button>
        <button type="button" onClick={() => setPresenter((value) => !value)} aria-pressed={presenter}>
          <MonitorSpeaker aria-hidden="true" />
          {tr(ctx.locale, 'Presenter view', 'Visão do apresentador')}
        </button>
        <button type="button" onClick={onExit}>
          {tr(ctx.locale, 'Exit', 'Sair')}
        </button>
      </div>
    </div>
  );
}
