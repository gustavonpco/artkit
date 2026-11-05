import PptxModule from 'pptxgenjs';

// pptxgenjs ships a CommonJS default export; resolve the constructor the same way under Node and bundlers.
const PptxGenJS: typeof PptxModule.default = ((PptxModule as unknown as { default?: unknown }).default ??
  PptxModule) as typeof PptxModule.default;

import { type ArtifactExporter, type ExportContext, resolveColor } from '@artkit-ai/core';
import {
  argsOf,
  type ComponentCall,
  callsOf,
  childrenOf,
  parseStatements,
  tokenize,
} from '@artkit-ai/format-openui';

export interface DeckSlide {
  layout: string;
  title?: string;
  subtitle?: string;
  bullets: string[];
  texts: string[];
  notes?: string;
  table?: { headers: string[]; rows: string[][] };
  unsupported: string[];
}

function strings(inner: string): string[] {
  return tokenize(inner)
    .filter((token) => token.kind === 'string')
    .map((token) => token.text.slice(1, -1));
}

/** Resolves a child item (a declaration name or an inline call) to its component call. */
function callOf(item: string, byName: Map<string, string>): ComponentCall | undefined {
  const expr = byName.get(item) ?? item;
  return callsOf(expr).find((call) => call.component === expr.split('(')[0]?.trim());
}

function slideOf(call: ComponentCall, byName: Map<string, string>): DeckSlide {
  const args = argsOf(call.inner);
  const layout = strings(args[0] ?? '')[0] ?? 'title-content';
  const slide: DeckSlide = { layout, bullets: [], texts: [], unsupported: [] };
  const visit = (item: string) => {
    const child = callOf(item, byName);
    if (!child) return;
    switch (child.component) {
      case 'Title':
        slide.title ??= strings(child.inner)[0];
        break;
      case 'Subtitle':
        slide.subtitle ??= strings(child.inner)[0];
        break;
      case 'Bullets':
        slide.bullets.push(...strings(child.inner));
        break;
      case 'Text':
      case 'Quote':
        slide.texts.push(...strings(child.inner).slice(0, 1));
        break;
      case 'Notes':
        slide.notes = strings(child.inner)[0];
        break;
      case 'Table': {
        const [headers = [], rows = []] = [strings(argsOf(child.inner)[0] ?? ''), []];
        slide.table = {
          headers,
          rows: [
            ...rows,
            ...strings(child.inner)
              .slice(headers.length)
              .map((cell) => [cell]),
          ],
        };
        break;
      }
      default:
        slide.unsupported.push(child.component);
    }
  };
  for (const item of childrenOf(`X(${call.inner})`)) visit(item);
  for (const item of args.slice(1)) if (!item.startsWith('[')) visit(item);
  return slide;
}

/** Slides of a Deck in order, read from the OpenUI text (root → slides → components). */
export function deckSlides(content: string): DeckSlide[] {
  const { statements } = parseStatements(content);
  const byName = new Map(statements.map((statement) => [statement.name, statement.expr]));
  const root = byName.get('root');
  if (!root) return [];
  const deck = callsOf(root).find((call) => call.component === 'Deck');
  if (!deck) return [];
  const slides: DeckSlide[] = [];
  for (const item of childrenOf(`X(${deck.inner})`)) {
    const call = callOf(item, byName);
    if (call?.component === 'Slide') slides.push(slideOf(call, byName));
  }
  return slides;
}

/** pptx exporter for OpenUI decks: one slide per Slide, 16:9, native text, bullets, tables and speaker notes. */
export const deckPptxExporter: ArtifactExporter<string> = {
  format: 'openui',
  target: 'pptx',
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  extension: 'pptx',
  runtime: 'node',
  async export(content: string, ctx: ExportContext): Promise<Uint8Array> {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = ctx.title;
    pptx.author = 'artkit';
    const ink = resolveColor(ctx.theme, 'text');
    const accent = resolveColor(ctx.theme, 'accent');
    for (const slide of deckSlides(content)) {
      const out = pptx.addSlide();
      const titleSize = slide.layout === 'title' ? 40 : 30;
      if (slide.title)
        out.addText(slide.title, {
          x: 0.6,
          y: 0.4,
          w: 12,
          h: 1,
          fontSize: titleSize,
          bold: true,
          color: accent.replace('#', ''),
        });
      if (slide.subtitle)
        out.addText(slide.subtitle, {
          x: 0.6,
          y: 1.5,
          w: 12,
          h: 0.6,
          fontSize: 20,
          color: ink.replace('#', ''),
        });
      if (slide.bullets.length > 0) {
        out.addText(
          slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
          { x: 0.8, y: 2.2, w: 11.5, h: 4.6, fontSize: 20, color: ink.replace('#', '') },
        );
      }
      if (slide.texts.length > 0)
        out.addText(slide.texts.join('\n'), {
          x: 0.8,
          y: 2.2,
          w: 11.5,
          h: 4.6,
          fontSize: 18,
          color: ink.replace('#', ''),
        });
      if (slide.table) {
        out.addTable(
          [slide.table.headers, ...slide.table.rows].map((row, index) =>
            row.map((cell) => ({ text: cell, options: { bold: index === 0 } })),
          ),
          { x: 0.8, y: 2.2, w: 11.5, fontSize: 14 },
        );
      }
      if (slide.unsupported.length > 0)
        ctx.warn(`Componentes sem equivalente no pptx: ${[...new Set(slide.unsupported)].join(', ')}.`);
      if (slide.notes) out.addNotes(slide.notes);
    }
    const data = await pptx.write({ outputType: 'uint8array' });
    return data as Uint8Array;
  },
};
