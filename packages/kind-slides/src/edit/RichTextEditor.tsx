import { COLOR_TOKENS, type Color, type RenderContext, resolveColor } from '@artkit/core';
import {
  Bold,
  Check,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  type LucideIcon,
  Underline,
} from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ResolvedTextStyle } from '../compose.js';
import { cqw, type Rect } from '../geometry.js';
import { tr } from '../i18n.js';
import { boxStyle, textBoxStyle } from '../react/Primitives.js';
import { colorCss } from '../react/style.js';
import type { NormalizedParagraph } from '../text.js';
import { TEXT_BOX } from '../text-metrics.js';
import {
  type Mark,
  readParagraphs,
  readSelection,
  setList,
  setRunColor,
  shiftLevel,
  type TextRange,
  toggleMark,
  writeSelection,
} from './rich-text.js';

export interface RichTextEditorProps {
  paragraphs: NormalizedParagraph[];
  style: ResolvedTextStyle;
  rect: Rect;
  ctx: RenderContext;
  fill?: Color;
  label: string;
  onCommit(paragraphs: NormalizedParagraph[]): void;
  onCancel(): void;
}

function ParagraphNodes({
  paragraphs,
  ctx,
}: {
  paragraphs: NormalizedParagraph[];
  ctx: RenderContext;
}): ReactElement {
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
          key={index}
          className="ak-slides-edit-p"
          data-list={paragraph.list}
          data-level={paragraph.list ? paragraph.level : undefined}
          style={
            paragraph.list ? { marginLeft: cqw(TEXT_BOX.bulletIndentPt * (paragraph.level + 1)) } : undefined
          }
        >
          {paragraph.runs.every((run) => run.text === '') ? (
            <br />
          ) : (
            paragraph.runs.map((run, runIndex) => {
              const css: CSSProperties = {};
              if (run.bold) css.fontWeight = 700;
              if (run.italic) css.fontStyle = 'italic';
              if (run.underline) css.textDecoration = 'underline';
              if (run.color) css.color = colorCss(ctx.theme, run.color);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
                <span key={runIndex} style={css} data-color={run.color} data-link={run.link}>
                  {run.text}
                </span>
              );
            })
          )}
        </div>
      ))}
    </>
  );
}

/**
 * In-place text editing limited to the schema: paragraphs, bullet and numbered lists with levels, bold,
 * italic, underline and theme-token colors. The DOM is read back into paragraphs on commit.
 */
export function RichTextEditor({
  paragraphs,
  style,
  rect,
  ctx,
  fill,
  label,
  onCommit,
  onCancel,
}: RichTextEditorProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState(paragraphs);
  const [version, setVersion] = useState(0);
  const pendingSelection = useRef<TextRange | undefined>(undefined);
  const done = useRef(false);
  // The editable node is remounted after formatting; blur events from that swap are not a commit.
  const remounting = useRef(false);
  const t = (en: string, pt: string) => tr(ctx.locale, en, pt);

  useLayoutEffect(() => {
    const element = root.current;
    remounting.current = false;
    if (!element) return;
    element.focus();
    const range = pendingSelection.current;
    pendingSelection.current = undefined;
    if (range) writeSelection(element, range);
    else if (version === 0) {
      // Start with the caret at the end of the text.
      const selection = element.ownerDocument.getSelection();
      if (selection) {
        const end = element.ownerDocument.createRange();
        end.selectNodeContents(element);
        end.collapse(false);
        selection.removeAllRanges();
        selection.addRange(end);
      }
    }
  }, [version]);

  const current = () => (root.current ? readParagraphs(root.current) : model);
  const selectionOrAll = (paras: NormalizedParagraph[]): TextRange => {
    const range = root.current ? readSelection(root.current) : undefined;
    if (range) return range;
    const last = paras.length - 1;
    return {
      start: { paragraph: 0, offset: 0 },
      end: { paragraph: last, offset: paras[last]?.runs.reduce((sum, run) => sum + run.text.length, 0) ?? 0 },
    };
  };
  const transform = (fn: (paras: NormalizedParagraph[], range: TextRange) => NormalizedParagraph[]) => {
    const paras = current();
    const range = selectionOrAll(paras);
    pendingSelection.current = range;
    remounting.current = true;
    setModel(fn(paras, range));
    setVersion((value) => value + 1);
  };
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(current());
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const mark = (value: Mark) => transform((paras, range) => toggleMark(paras, range, value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (mod && event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (mod && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      mark('bold');
    } else if (mod && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      mark('italic');
    } else if (mod && (event.key === 'u' || event.key === 'U')) {
      event.preventDefault();
      mark('underline');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      transform((paras, range) => shiftLevel(paras, range, event.shiftKey ? -1 : 1));
    }
    event.stopPropagation();
  };

  // Toolbar buttons keep the text selection by not taking focus.
  const keep = (event: { preventDefault(): void }) => event.preventDefault();
  const button = (Icon: LucideIcon, title: string, action: () => void, primary = false) => (
    <button
      type="button"
      className="ak-tb-button"
      data-variant={primary ? 'primary' : undefined}
      title={title}
      aria-label={title}
      onMouseDown={keep}
      onClick={action}
    >
      <Icon aria-hidden="true" />
    </button>
  );

  return (
    <div className="ak-slides-richtext" style={boxStyle(rect)}>
      <div
        className="ak-tb ak-slides-richtext-bar"
        role="toolbar"
        aria-label={t('Text formatting', 'Formatação de texto')}
      >
        {button(Bold, t('Bold', 'Negrito'), () => mark('bold'))}
        {button(Italic, t('Italic', 'Itálico'), () => mark('italic'))}
        {button(Underline, t('Underline', 'Sublinhado'), () => mark('underline'))}
        <span className="ak-slides-richtext-sep" aria-hidden="true" />
        {button(List, t('Bulleted list', 'Lista com marcadores'), () =>
          transform((paras, range) =>
            setList(paras, range, paras[range.start.paragraph]?.list === 'bullet' ? undefined : 'bullet'),
          ),
        )}
        {button(ListOrdered, t('Numbered list', 'Lista numerada'), () =>
          transform((paras, range) =>
            setList(paras, range, paras[range.start.paragraph]?.list === 'number' ? undefined : 'number'),
          ),
        )}
        {button(IndentDecrease, t('Decrease indent', 'Diminuir recuo'), () =>
          transform((paras, range) => shiftLevel(paras, range, -1)),
        )}
        {button(IndentIncrease, t('Increase indent', 'Aumentar recuo'), () =>
          transform((paras, range) => shiftLevel(paras, range, 1)),
        )}
        <span className="ak-slides-richtext-sep" aria-hidden="true" />
        <span className="ak-slides-richtext-colors">
          {COLOR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              className="ak-ctl-swatch"
              style={{ background: resolveColor(ctx.theme, token) }}
              title={`${t('Text color', 'Cor do texto')}: ${token}`}
              aria-label={`${t('Text color', 'Cor do texto')}: ${token}`}
              onMouseDown={keep}
              onClick={() => transform((paras, range) => setRunColor(paras, range, token))}
            />
          ))}
          {button(Eraser, t('Default color', 'Cor padrão'), () =>
            transform((paras, range) => setRunColor(paras, range, undefined)),
          )}
        </span>
        <span className="ak-slides-richtext-sep" aria-hidden="true" />
        {button(Check, t('Done (Ctrl+Enter)', 'Concluir (Ctrl+Enter)'), commit, true)}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: rich text (runs, lists) needs a contentEditable textbox, not a textarea. */}
      <div
        key={version}
        ref={root}
        className="ak-slides-richtext-area"
        style={{ ...textBoxStyle(ctx, style, fill), width: '100%', height: '100%' }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Focus moving to the formatting bar is not the end of the edit.
          if (remounting.current) return;
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.parentElement?.contains(event.relatedTarget)
          )
            return;
          commit();
        }}
      >
        <ParagraphNodes paragraphs={model} ctx={ctx} />
      </div>
    </div>
  );
}
