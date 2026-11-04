import type { ArtifactExporter } from '@artkit-ai/core';
import { composeSlide, slideTitle, slotPlainText } from '../compose.js';
import { tr } from '../i18n.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import type {
  ChartElement,
  Paragraph,
  SlideElement,
  SlidesContent,
  SlotContent,
  TableElement,
} from '../schema.js';
import { listOrdinals, normalizeParagraphs, paragraphMarkdown } from '../text.js';

/*
 * Markdown outline of a deck: one section per slide (title as heading, slot and element content in reading
 * order, speaker notes as a quote). Layout, positions and styling are not kept.
 */

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(header: readonly string[] | undefined, rows: readonly (readonly string[])[]): string[] {
  const columns = Math.max(header?.length ?? 0, ...rows.map((row) => row.length));
  if (columns === 0) return [];
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: columns }, (_, index) => cell(cells[index] ?? '')).join(' | ')} |`;
  const head = header ?? Array.from({ length: columns }, () => '');
  return [line(head), `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`, ...rows.map(line)];
}

function chart(element: Pick<ChartElement, 'title' | 'categories' | 'series'>): string[] {
  const rows = element.categories.map((category, index) => [
    category,
    ...element.series.map((series) => String(series.values[index] ?? '')),
  ]);
  return [
    ...(element.title ? [`**${element.title}**`, ''] : []),
    ...table(['', ...element.series.map((series) => series.name)], rows),
  ];
}

function paragraphs(items: readonly Paragraph[], defaultList?: 'bullet' | 'number'): string[] {
  const normalized = normalizeParagraphs(items, defaultList);
  const ordinals = listOrdinals(normalized);
  return normalized.map((paragraph, index) => paragraphMarkdown(paragraph, ordinals[index] ?? 0));
}

function slotLines(content: SlotContent): string[] {
  if (typeof content === 'string') return content ? [content] : [];
  switch (content.type) {
    case 'text':
      return paragraphs(content.paragraphs);
    case 'bullets':
      return paragraphs(content.items, 'bullet');
    case 'quote':
      return [`> ${content.text}`, ...(content.attribution ? ['>', `> — ${content.attribution}`] : [])];
    case 'image':
      return [
        `![${content.alt}](${content.asset})`,
        ...(content.caption ? ['', `_${content.caption}_`] : []),
      ];
    case 'table':
      return table(content.header, content.rows);
    case 'chart':
      return chart(content);
    case 'stats':
      return content.items.map(
        (item) => `- **${item.value}** ${item.label}${item.description ? ` — ${item.description}` : ''}`,
      );
    case 'steps':
      return content.items.map(
        (item, index) => `${index + 1}. **${item.title}**${item.description ? ` — ${item.description}` : ''}`,
      );
    case 'cards':
      return content.items.flatMap((item) => {
        const head = [item.value ? `**${item.value}**` : '', item.title ? `**${item.title}**` : '']
          .filter(Boolean)
          .join(' ');
        return [
          `- ${head || item.caption || ''}${item.text ? ` — ${item.text}` : ''}`,
          ...(item.bullets ?? []).map((bullet) => `  - ${bullet}`),
        ];
      });
  }
}

function elementLines(element: SlideElement): string[] {
  switch (element.type) {
    case 'text':
      return element.bullets ? paragraphs(element.bullets, 'bullet') : paragraphs(element.paragraphs ?? []);
    case 'shape':
      return element.text ? paragraphs(element.text.paragraphs) : [];
    case 'image':
      return [`![${element.alt}](${element.asset})`];
    case 'table':
      return table((element as TableElement).header, element.rows);
    case 'chart':
      return chart(element);
  }
}

export interface SlidesMarkdownOptions {
  title?: string;
  locale?: string;
  layouts?: LayoutRegistry;
  /** Include hidden slides (default true, marked as hidden). */
  hidden?: boolean;
}

export function slidesToMarkdown(content: SlidesContent, options: SlidesMarkdownOptions = {}): string {
  const locale = options.locale ?? 'en';
  const layouts = options.layouts ?? builtInLayouts;
  const sections: string[] = [];
  if (options.title) sections.push(`# ${options.title}`);
  content.slides.forEach((slide, index) => {
    if (slide.hidden && options.hidden === false) return;
    const title = slideTitle(slide, layouts).trim();
    const hidden = slide.hidden ? ` _(${tr(locale, 'hidden', 'oculto')})_` : '';
    const blocks: string[][] = [];
    const composed = composeSlide(slide, { layouts });
    let titleUsed = false;
    for (const { slot, content: value } of composed.slots) {
      if (value === undefined) continue;
      if (
        !titleUsed &&
        (slot.role === 'title' || slot.role === 'display') &&
        slotPlainText(value).trim() === title
      ) {
        titleUsed = true;
        continue;
      }
      blocks.push(slotLines(value));
    }
    for (const element of slide.elements) blocks.push(elementLines(element));
    if (slide.notes)
      blocks.push(
        slide.notes
          .split('\n')
          .map((line, position) =>
            position === 0 ? `> **${tr(locale, 'Notes', 'Notas')}:** ${line}` : `> ${line}`,
          ),
      );
    const heading = `## ${index + 1}. ${title || tr(locale, '(untitled)', '(sem título)')}${hidden}`;
    sections.push(
      [heading, ...blocks.filter((lines) => lines.length > 0).map((lines) => lines.join('\n'))].join('\n\n'),
    );
  });
  return `${sections.join('\n\n---\n\n')}\n`;
}

export function createSlidesMarkdownExporter(
  layouts: LayoutRegistry = builtInLayouts,
): ArtifactExporter<SlidesContent> {
  return {
    kind: 'slides',
    format: 'md',
    mimeType: 'text/markdown; charset=utf-8',
    extension: 'md',
    runtime: 'any',
    async export(content, ctx) {
      ctx.warn('Markdown keeps the text, tables and charts as an outline; layout and styling are not kept.');
      const markdown = slidesToMarkdown(content, {
        title: ctx.title,
        locale: ctx.locale,
        layouts,
        hidden: ctx.options?.hidden !== false,
      });
      return new TextEncoder().encode(markdown);
    },
  };
}
