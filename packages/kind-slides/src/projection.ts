import {
  ellipsis,
  type Projection,
  type ProjectionItem,
  type ProjectionOptions,
  projectItems,
} from '@artkit-ai/core';
import { composeSlide, resolveTextStyle, slideTitle } from './compose.js';
import { tableColumnCount, textElementParagraphs } from './elements.js';
import { CANVAS, fmt, type Rect } from './geometry.js';
import { tr } from './i18n.js';
import type { LayoutRegistry } from './layouts.js';
import type {
  ChartElement,
  Slide,
  SlideElement,
  SlidesContent,
  SlotContent,
  TableElement,
} from './schema.js';
import { listOrdinals, type NormalizedParagraph, normalizeParagraphs, paragraphMarkdown } from './text.js';

function box(rect: Rect): string {
  return `(${fmt(rect.x)},${fmt(rect.y)} ${fmt(rect.w)}x${fmt(rect.h)})`;
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function paragraphLines(paragraphs: NormalizedParagraph[], indent: string): string[] {
  const ordinals = listOrdinals(paragraphs);
  return paragraphs.map(
    (paragraph, index) => `${indent}${paragraphMarkdown(paragraph, ordinals[index] ?? 0)}`,
  );
}

/** One line when the text is a single plain paragraph, otherwise a header plus indented lines. */
function textLines(
  head: string,
  paragraphs: NormalizedParagraph[],
  rect: Rect,
  suffix: string,
  indent: string,
): string[] {
  const single = paragraphs.length === 1 && !paragraphs[0]!.list ? paragraphs[0]! : undefined;
  if (single) return [`${head} ${quote(paragraphMarkdown(single, 0))} ${box(rect)}${suffix}`];
  return [`${head} ${box(rect)}${suffix}`, ...paragraphLines(paragraphs, indent)];
}

function tableLines(table: Pick<TableElement, 'header' | 'rows'>, indent: string): string[] {
  const row = (cells: string[]) => `${indent}| ${cells.join(' | ')} |`;
  return [...(table.header ? [`${row(table.header)} (header)`] : []), ...table.rows.map(row)];
}

function chartLines(
  chart: Pick<ChartElement, 'categories' | 'series'>,
  indent: string,
  locale: string,
): string[] {
  return [
    `${indent}${tr(locale, 'categories', 'categorias')}: ${chart.categories.join(', ')}`,
    ...chart.series.map(
      (series) =>
        `${indent}${tr(locale, 'series', 'série')} ${quote(series.name)}: ${series.values.join(', ')}`,
    ),
  ];
}

function slotLines(name: string, content: SlotContent, rect: Rect, locale: string): string[] {
  const head = `  [${name}]`;
  const inner = '    ';
  if (typeof content === 'string')
    return textLines(`${head} text`, normalizeParagraphs(content.split(/\r?\n/)), rect, '', inner);
  switch (content.type) {
    case 'text':
      return textLines(`${head} text`, normalizeParagraphs(content.paragraphs), rect, '', inner);
    case 'bullets':
      return [
        `${head} bullets ${box(rect)}`,
        ...paragraphLines(normalizeParagraphs(content.items, 'bullet'), inner),
      ];
    case 'image':
      return [
        `${head} image ${content.asset} alt=${quote(content.alt)}${content.fit ? ` fit=${content.fit}` : ''} ${box(rect)}`,
        ...(content.caption ? [`${inner}caption: ${quote(content.caption)}`] : []),
      ];
    case 'table':
      return [
        `${head} table ${tableColumnCount(content)}x${content.rows.length + (content.header ? 1 : 0)} ${box(rect)}`,
        ...tableLines(content, inner),
      ];
    case 'chart':
      return [
        `${head} chart ${content.chartType}${content.title ? ` ${quote(content.title)}` : ''} ${box(rect)}`,
        ...chartLines(content, inner, locale),
      ];
    case 'stats':
      return [
        `${head} stats ${box(rect)}`,
        ...content.items.map(
          (item) =>
            `${inner}- ${item.value} — ${item.label}${item.description ? ` (${item.description})` : ''}`,
        ),
      ];
    case 'steps':
      return [
        `${head} steps ${box(rect)}`,
        ...content.items.map(
          (item, index) =>
            `${inner}- ${item.marker ?? String(index + 1).padStart(2, '0')} ${item.title}${item.description ? `: ${item.description}` : ''}`,
        ),
      ];
    case 'cards':
      return [
        `${head} cards ${box(rect)}`,
        ...content.items.map((item) => {
          if (item.image)
            return `${inner}- image ${item.image.asset} alt=${quote(item.image.alt)}${item.caption ? ` caption=${quote(item.caption)}` : ''}`;
          const parts = [
            item.title,
            item.value,
            item.text,
            item.bullets?.length ? item.bullets.map((b) => `• ${b}`).join(' ') : undefined,
          ].filter(Boolean);
          return `${inner}- ${parts.join(' | ')}`;
        }),
      ];
    case 'quote':
      return [
        `${head} quote ${quote(content.text)}${content.attribution ? ` — ${content.attribution}` : ''} ${box(rect)}`,
      ];
  }
}

function styleSuffix(element: Extract<SlideElement, { type: 'text' }>): string {
  const style = resolveTextStyle(element);
  const parts: string[] = [`${fmt(style.fontSize)}pt`];
  if (style.bold) parts.push('bold');
  if (style.italic) parts.push('italic');
  if (element.color) parts.push(`color=${element.color}`);
  if (element.fill) parts.push(`fill=${element.fill}`);
  if (element.align && element.align !== 'left') parts.push(`align=${element.align}`);
  if (element.valign && element.valign !== 'top') parts.push(`valign=${element.valign}`);
  if (element.font && element.font !== 'body') parts.push(`font=${element.font}`);
  return ` ${parts.join(' ')}`;
}

function elementLines(element: SlideElement, locale: string): string[] {
  const head = `  #${element.id}`;
  const inner = '    ';
  switch (element.type) {
    case 'text': {
      const kind = element.bullets ? 'bullets' : 'text';
      const paragraphs = textElementParagraphs(element);
      if (kind === 'bullets')
        return [
          `${head} bullets ${box(element)}${styleSuffix(element)}`,
          ...paragraphLines(paragraphs, inner),
        ];
      return textLines(`${head} text`, paragraphs, element, styleSuffix(element), inner);
    }
    case 'shape': {
      const attrs = [
        element.fill ? `fill=${element.fill}` : '',
        element.line?.color ? `line=${element.line.color}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const text = element.text
        ? ` ${quote(
            normalizeParagraphs(element.text.paragraphs)
              .map((p) => p.runs.map((r) => r.text).join(''))
              .join(' / '),
          )}`
        : '';
      return [`${head} shape ${element.shape}${attrs ? ` ${attrs}` : ''} ${box(element)}${text}`];
    }
    case 'image':
      return [
        `${head} image ${element.asset} alt=${quote(element.alt)}${element.fit ? ` fit=${element.fit}` : ''} ${box(element)}`,
      ];
    case 'table':
      return [
        `${head} table ${tableColumnCount(element)}x${element.rows.length + (element.header ? 1 : 0)} ${box(element)}`,
        ...tableLines(element, inner),
      ];
    case 'chart':
      return [
        `${head} chart ${element.chartType}${element.title ? ` ${quote(element.title)}` : ''} ${box(element)}`,
        ...chartLines(element, inner, locale),
      ];
  }
}

export function projectSlide(slide: Slide, index: number, layouts: LayoutRegistry, locale: string): string {
  const composed = composeSlide(slide, { layouts });
  const flags = [
    slide.hidden ? tr(locale, 'hidden', 'oculto') : '',
    composed.unknownLayout ? tr(locale, 'unknown layout', 'layout desconhecido') : '',
  ]
    .filter(Boolean)
    .map((flag) => `, ${flag}`)
    .join('');
  const lines = [`Slide ${index + 1} (id: ${slide.id}, layout: ${slide.layout}${flags})`];
  if (slide.background) {
    const parts = [slide.background.color, slide.background.image].filter(Boolean).join(' ');
    lines.push(`  ${tr(locale, 'background', 'fundo')}: ${parts}`);
  }
  const empty: string[] = [];
  for (const { slot, content: value } of composed.slots) {
    if (value === undefined) empty.push(slot.name);
    else lines.push(...slotLines(slot.name, value, slot.box, locale));
  }
  for (const element of slide.elements) lines.push(...elementLines(element, locale));
  if (empty.length > 0) lines.push(`  ${tr(locale, 'empty slots', 'slots vazios')}: ${empty.join(', ')}`);
  if (slide.notes) lines.push(`  ${tr(locale, 'notes', 'notas')}: ${quote(slide.notes)}`);
  return lines.join('\n');
}

export function slideOutline(slide: Slide, index: number, layouts: LayoutRegistry, locale: string): string {
  const title = slideTitle(slide, layouts);
  const hidden = slide.hidden ? ` [${tr(locale, 'hidden', 'oculto')}]` : '';
  return `Slide ${index + 1} (id: ${slide.id}, layout: ${slide.layout}): ${title ? ellipsis(title, 80) : tr(locale, '(untitled)', '(sem título)')}${hidden}`;
}

/** Text projection (spec §9.3): one item per slide, ids always visible, cut on slide boundaries. */
export function projectSlides(
  content: SlidesContent,
  options: ProjectionOptions,
  layouts: LayoutRegistry,
): Projection {
  const locale = options.locale;
  const items: ProjectionItem[] = content.slides.map((slide, index) => ({
    id: slide.id,
    text: projectSlide(slide, index, layouts, locale),
    outline: slideOutline(slide, index, layouts, locale),
  }));
  const footer = content.footer
    ? `, footer: ${[content.footer.text ? quote(content.footer.text) : '', content.footer.slideNumber ? tr(locale, 'slide numbers', 'números de slide') : ''].filter(Boolean).join(' + ')}`
    : '';
  const header = `Deck ${content.size} (${CANVAS.width}x${CANVAS.height} in), ${content.slides.length} slides${footer}`;
  return projectItems(items, options, { header });
}
