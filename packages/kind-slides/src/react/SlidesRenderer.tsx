import type { RenderContext } from '@artkit-ai/core';
import { Toolbar, ToolbarButton, ToolbarGroup } from '@artkit-ai/react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  MonitorSpeaker,
  Presentation,
  StickyNote,
} from 'lucide-react';
import { type KeyboardEvent, type ReactElement, useEffect, useState } from 'react';
import { tr } from '../i18n.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import type { SlidesContent } from '../schema.js';
import { SlidesPresentation } from './Presentation.js';
import { SlideView } from './SlideView.js';
import { SlideNotes, SlideThumbnails } from './Thumbnails.js';

export interface SlidesRendererProps {
  content: SlidesContent;
  ctx: RenderContext;
  /** Show only this slide (e.g. a chat card); otherwise the full viewer. */
  slideId?: string;
  /** Layouts of the kind (`slidesKind.layouts`); defaults to the built-ins. */
  layouts?: LayoutRegistry;
  className?: string;
  /** Show the speaker notes under the current slide initially. */
  showNotes?: boolean;
}

/**
 * Read-only deck renderer. Screen mode is a viewer (current slide, navigation, thumbnails, overview grid,
 * notes, presentation and presenter view); print mode renders every visible slide on its own fixed-size page (spec §12.3).
 */
export function SlidesRenderer({
  content,
  ctx,
  slideId,
  layouts = builtInLayouts,
  className,
  showNotes: initialNotes = false,
}: SlidesRendererProps): ReactElement {
  const footer = content.footer ? { footer: content.footer } : {};
  if (ctx.mode === 'print') {
    return (
      <div className={`ak-slides ak-slides-print${className ? ` ${className}` : ''}`}>
        {content.slides.map((slide, index) =>
          slide.hidden || (slideId !== undefined && slide.id !== slideId) ? null : (
            <section key={slide.id} className="ak-slides-page">
              <SlideView slide={slide} ctx={ctx} layouts={layouts} {...footer} slideNumber={index + 1} />
            </section>
          ),
        )}
      </div>
    );
  }
  if (slideId !== undefined) {
    const index = content.slides.findIndex((slide) => slide.id === slideId);
    const slide = content.slides[index];
    return (
      <div className={`ak-slides${className ? ` ${className}` : ''}`}>
        {slide ? (
          <SlideView slide={slide} ctx={ctx} layouts={layouts} {...footer} slideNumber={index + 1} />
        ) : (
          <p className="ak-slides-notes-empty">
            {tr(ctx.locale, `Slide "${slideId}" not found.`, `Slide "${slideId}" não encontrado.`)}
          </p>
        )}
      </div>
    );
  }
  return (
    <SlidesViewer
      content={content}
      ctx={ctx}
      layouts={layouts}
      showNotes={initialNotes}
      {...(className ? { className } : {})}
    />
  );
}

function SlidesViewer({
  content,
  ctx,
  layouts,
  className,
  showNotes: initialNotes,
}: Required<Pick<SlidesRendererProps, 'content' | 'ctx' | 'layouts' | 'showNotes'>> & {
  className?: string;
}): ReactElement {
  const [currentId, setCurrentId] = useState<string | undefined>(content.slides[0]?.id);
  const [notes, setNotes] = useState(initialNotes);
  const [presenting, setPresenting] = useState<'audience' | 'presenter' | undefined>(undefined);
  const [overview, setOverview] = useState(false);
  const found = content.slides.findIndex((slide) => slide.id === currentId);
  const index = Math.max(found, 0);
  const slide = content.slides[index];

  // Keep a valid selection while streaming or after the deck changes.
  useEffect(() => {
    if (found < 0 && content.slides[0]) setCurrentId(content.slides[0].id);
  }, [found, content.slides]);

  const go = (next: number) => {
    const target = content.slides[Math.max(0, Math.min(content.slides.length - 1, next))];
    if (target) setCurrentId(target.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') go(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(content.slides.length - 1);
    else return;
    event.preventDefault();
  };

  if (!slide) {
    return (
      <div className={`ak-slides ak-slides-notes-empty${className ? ` ${className}` : ''}`}>
        {tr(ctx.locale, 'This deck has no slides yet.', 'Este deck ainda não tem slides.')}
      </div>
    );
  }
  return (
    <div className={`ak-slides${className ? ` ${className}` : ''}`}>
      <Toolbar
        label={tr(ctx.locale, 'Slide viewer', 'Visualizador de slides')}
        className="ak-slides-viewer-toolbar"
        sticky={false}
      >
        <ToolbarGroup label={tr(ctx.locale, 'Navigation', 'Navegação')}>
          <ToolbarButton
            icon={ChevronLeft}
            label={tr(ctx.locale, 'Previous slide', 'Slide anterior')}
            disabled={index === 0}
            onClick={() => go(index - 1)}
            keepFocus={false}
          />
          <span className="ak-slides-counter" aria-live="polite">
            {index + 1} / {content.slides.length}
          </span>
          <ToolbarButton
            icon={ChevronRight}
            label={tr(ctx.locale, 'Next slide', 'Próximo slide')}
            disabled={index === content.slides.length - 1}
            onClick={() => go(index + 1)}
            keepFocus={false}
          />
        </ToolbarGroup>
        <ToolbarGroup label={tr(ctx.locale, 'View', 'Exibição')}>
          <ToolbarButton
            icon={LayoutGrid}
            label={tr(ctx.locale, 'Overview', 'Visão geral')}
            pressed={overview}
            onClick={() => setOverview((value) => !value)}
            keepFocus={false}
          />
          <ToolbarButton
            icon={StickyNote}
            label={tr(ctx.locale, 'Speaker notes', 'Notas do apresentador')}
            pressed={notes}
            onClick={() => setNotes((value) => !value)}
            keepFocus={false}
          />
        </ToolbarGroup>
        <ToolbarGroup label={tr(ctx.locale, 'Present', 'Apresentar')}>
          <ToolbarButton
            icon={MonitorSpeaker}
            label={tr(ctx.locale, 'Presenter view', 'Visão do apresentador')}
            onClick={() => setPresenting('presenter')}
            keepFocus={false}
          />
          <ToolbarButton
            icon={Presentation}
            label={tr(ctx.locale, 'Present', 'Apresentar')}
            showLabel
            variant="primary"
            onClick={() => setPresenting('audience')}
            keepFocus={false}
          />
        </ToolbarGroup>
      </Toolbar>
      <section
        className="ak-slides-viewer"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the viewer is a keyboard navigation target.
        tabIndex={0}
        aria-roledescription={tr(ctx.locale, 'slide viewer', 'visualizador de slides')}
        aria-label={tr(ctx.locale, 'Slides', 'Slides')}
        onKeyDown={onKeyDown}
      >
        <SlideView
          slide={slide}
          ctx={ctx}
          layouts={layouts}
          {...(content.footer ? { footer: content.footer } : {})}
          slideNumber={index + 1}
        />
      </section>
      {overview ? (
        <ol className="ak-slides-overview" aria-label={tr(ctx.locale, 'All slides', 'Todos os slides')}>
          {content.slides.map((item, position) => (
            <li key={item.id}>
              <button
                type="button"
                className="ak-slides-overview-item"
                aria-current={item.id === slide.id}
                aria-label={`${tr(ctx.locale, 'Slide', 'Slide')} ${position + 1}`}
                onClick={() => {
                  setCurrentId(item.id);
                  setOverview(false);
                }}
              >
                <SlideView
                  slide={item}
                  ctx={ctx}
                  layouts={layouts}
                  {...(content.footer ? { footer: content.footer } : {})}
                  slideNumber={position + 1}
                />
                <span className="ak-slides-thumb-number">{position + 1}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {notes ? <SlideNotes notes={slide.notes} locale={ctx.locale} /> : null}
      {overview ? null : (
        <SlideThumbnails
          content={content}
          ctx={ctx}
          layouts={layouts}
          currentId={slide.id}
          onSelect={setCurrentId}
        />
      )}
      {presenting ? (
        <SlidesPresentation
          presenter={presenting === 'presenter'}
          content={content}
          ctx={ctx}
          layouts={layouts}
          startSlideId={slide.id}
          onSlideChange={setCurrentId}
          onExit={() => setPresenting(undefined)}
        />
      ) : null}
    </div>
  );
}
