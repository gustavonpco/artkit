import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { type DragEvent, type KeyboardEvent, type ReactElement, useState } from 'react';
import { slideTitle } from '../compose.js';
import type { LayoutRegistry } from '../layouts.js';
import { SlideView } from '../react/SlideView.js';
import type { SlidesContent } from '../schema.js';
import { SelectField } from './controls.js';
import type { EditorEnv } from './types.js';

export interface SlidePanelProps {
  env: EditorEnv;
  content: SlidesContent;
  layouts: LayoutRegistry;
  currentId: string | undefined;
  onSelect(slideId: string): void;
  /** Adds a slide with the layout after the current one and returns its id. */
  onInsert(layout: string): void;
}

const DRAG_TYPE = 'application/x-artkit-slide';

/** Thumbnails with drag-and-drop reordering, duplicate, hide, delete and insert-with-layout. */
export function SlidePanel({
  env,
  content,
  layouts,
  currentId,
  onSelect,
  onInsert,
}: SlidePanelProps): ReactElement {
  const { t, readOnly } = env;
  const [layout, setLayout] = useState(
    layouts.has('title-content') ? 'title-content' : (layouts.names()[0] ?? ''),
  );
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  const move = (slideId: string, position: number) =>
    env.emit([{ op: 'move_slide', slide: slideId, position }]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, slideId: string) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !readOnly) {
      const target = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (target >= 0 && target < content.slides.length) move(slideId, target + 1);
      event.preventDefault();
      return;
    }
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : -1;
    if (next >= 0 && next < content.slides.length) {
      event.preventDefault();
      onSelect(content.slides[next]!.id);
      event.currentTarget
        .closest('.ak-slides-panel')
        ?.querySelectorAll<HTMLButtonElement>('.ak-slides-thumb')
        [next]?.focus();
    }
  };
  const onDrop = (event: DragEvent<HTMLLIElement>, index: number) => {
    event.preventDefault();
    setDropTarget(undefined);
    const slideId = event.dataTransfer.getData(DRAG_TYPE);
    if (!slideId || readOnly) return;
    const from = content.slides.findIndex((slide) => slide.id === slideId);
    if (from < 0 || from === index) return;
    move(slideId, index + 1);
  };
  return (
    <nav className="ak-slides-panel" aria-label={t('Slides', 'Slides')}>
      <ol className="ak-slides-thumbs ak-slides-thumbs-vertical">
        {content.slides.map((slide, index) => {
          const title = slideTitle(slide, layouts);
          const label = `${t('Slide', 'Slide')} ${index + 1}${title ? `: ${title}` : ''}${slide.hidden ? ` (${t('hidden', 'oculto')})` : ''}`;
          return (
            <li
              key={slide.id}
              data-slide-id={slide.id}
              draggable={!readOnly}
              className={dropTarget === slide.id ? 'ak-slides-drop-target' : undefined}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, slide.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (readOnly) return;
                event.preventDefault();
                setDropTarget(slide.id);
              }}
              onDragLeave={() => setDropTarget((current) => (current === slide.id ? undefined : current))}
              onDrop={(event) => onDrop(event, index)}
            >
              <button
                type="button"
                className="ak-slides-thumb"
                aria-current={slide.id === currentId}
                aria-label={label}
                title={`${label}${readOnly ? '' : ` — ${t('Alt+↑/↓ to move', 'Alt+↑/↓ para mover')}`}`}
                onClick={() => onSelect(slide.id)}
                onKeyDown={(event) => onKeyDown(event, index, slide.id)}
              >
                <SlideView
                  slide={slide}
                  ctx={env.ctx}
                  layouts={layouts}
                  {...(content.footer ? { footer: content.footer } : {})}
                  slideNumber={index + 1}
                  decorative
                />
                <span className="ak-slides-thumb-number" aria-hidden="true">
                  {index + 1}
                </span>
              </button>
              {!readOnly ? (
                <fieldset
                  className="ak-slides-thumb-actions"
                  aria-label={`${t('Actions for', 'Ações do')} ${label}`}
                >
                  <button
                    type="button"
                    className="ak-ctl-button"
                    data-variant="quiet"
                    data-size="sm"
                    data-icon-only=""
                    aria-label={t('Move up', 'Mover para cima')}
                    disabled={index === 0}
                    onClick={() => move(slide.id, index)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ak-ctl-button"
                    data-variant="quiet"
                    data-size="sm"
                    data-icon-only=""
                    aria-label={t('Move down', 'Mover para baixo')}
                    disabled={index === content.slides.length - 1}
                    onClick={() => move(slide.id, index + 2)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ak-ctl-button"
                    data-variant="quiet"
                    data-size="sm"
                    data-icon-only=""
                    aria-label={t('Duplicate slide', 'Duplicar slide')}
                    onClick={() => env.emit([{ op: 'duplicate_slide', slide: slide.id }])}
                  >
                    <Copy aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ak-ctl-button"
                    data-variant="quiet"
                    data-size="sm"
                    data-icon-only=""
                    aria-label={
                      slide.hidden ? t('Show slide', 'Mostrar slide') : t('Hide slide', 'Ocultar slide')
                    }
                    aria-pressed={!!slide.hidden}
                    onClick={() => env.emit([{ op: 'set_hidden', slide: slide.id, hidden: !slide.hidden }])}
                  >
                    {slide.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="ak-ctl-button"
                    data-variant="danger"
                    data-size="sm"
                    data-icon-only=""
                    aria-label={t('Delete slide', 'Excluir slide')}
                    onClick={() => env.emit([{ op: 'remove_slide', slide: slide.id }])}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </fieldset>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!readOnly ? (
        <div className="ak-slides-insert">
          <SelectField
            label={t('New slide layout', 'Layout do novo slide')}
            value={layout}
            options={layouts.list().map((item) => ({ value: item.name, label: item.label }))}
            onChange={setLayout}
          />
          <button type="button" className="ak-ctl-button" onClick={() => onInsert(layout)}>
            <Plus aria-hidden="true" />
            {t('Add slide', 'Adicionar slide')}
          </button>
        </div>
      ) : null}
    </nav>
  );
}
