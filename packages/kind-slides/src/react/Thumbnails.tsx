import type { RenderContext } from '@artkit-ai/core';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { slideTitle } from '../compose.js';
import { tr } from '../i18n.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import type { SlidesContent } from '../schema.js';
import { SlideView } from './SlideView.js';

export interface SlideThumbnailsProps {
  content: SlidesContent;
  ctx: RenderContext;
  layouts?: LayoutRegistry;
  currentId?: string;
  onSelect?(slideId: string): void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  /** Extra controls rendered under each thumbnail (the editor adds its slide actions here). */
  renderExtra?(slideId: string, index: number): ReactNode;
}

/** Strip of slide thumbnails; arrow keys move between them. */
export function SlideThumbnails({
  content,
  ctx,
  layouts = builtInLayouts,
  currentId,
  onSelect,
  orientation = 'horizontal',
  className,
  renderExtra,
}: SlideThumbnailsProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index - 1
          : -1;
    if (next < 0 || next >= content.slides.length || event.altKey) return;
    event.preventDefault();
    const target = content.slides[next]!;
    onSelect?.(target.id);
    const list = event.currentTarget.closest('.ak-slides-thumbs');
    list?.querySelectorAll<HTMLButtonElement>('.ak-slides-thumb')[next]?.focus();
  };
  return (
    <ol
      className={`ak-slides-thumbs${orientation === 'vertical' ? ' ak-slides-thumbs-vertical' : ''}${className ? ` ${className}` : ''}`}
      aria-label={tr(ctx.locale, 'Slides', 'Slides')}
    >
      {content.slides.map((slide, index) => {
        const title = slideTitle(slide, layouts);
        const label = `${tr(ctx.locale, 'Slide', 'Slide')} ${index + 1}${title ? `: ${title}` : ''}${slide.hidden ? ` (${tr(ctx.locale, 'hidden', 'oculto')})` : ''}`;
        return (
          <li key={slide.id} data-slide-id={slide.id}>
            <button
              type="button"
              className="ak-slides-thumb"
              aria-current={slide.id === currentId}
              aria-label={label}
              title={label}
              onClick={() => onSelect?.(slide.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <SlideView
                slide={slide}
                ctx={ctx}
                layouts={layouts}
                {...(content.footer ? { footer: content.footer } : {})}
                slideNumber={index + 1}
                decorative
              />
              <span className="ak-slides-thumb-number" aria-hidden="true">
                {index + 1}
              </span>
            </button>
            {renderExtra?.(slide.id, index)}
          </li>
        );
      })}
    </ol>
  );
}

export interface SlideNotesProps {
  notes: string | undefined;
  locale: string;
  className?: string;
}

/** Speaker notes of a slide. */
export function SlideNotes({ notes, locale, className }: SlideNotesProps): ReactElement {
  return (
    <section
      className={`ak-slides-notes${notes ? '' : ' ak-slides-notes-empty'}${className ? ` ${className}` : ''}`}
      aria-label={tr(locale, 'Speaker notes', 'Notas do apresentador')}
    >
      {notes || tr(locale, 'No speaker notes.', 'Sem notas do apresentador.')}
    </section>
  );
}
