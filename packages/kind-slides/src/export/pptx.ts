import {
  ArtifactError,
  type ArtifactExporter,
  type Color,
  type ExportContext,
  resolveColor,
  type Theme,
  toDataUrl,
} from '@artkit-ai/core';
import PptxModule from 'pptxgenjs';
import { chartLegendPosition } from '../chart-scale.js';
import {
  composeSlide,
  DEFAULT_SHAPE_TEXT_STYLE,
  type Primitive,
  type ResolvedTextStyle,
  resolveTextStyle,
} from '../compose.js';
import { tableColumnWidths, textElementParagraphs } from '../elements.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import type {
  ChartElement,
  ImageElement,
  ShapeElement,
  SlidesContent,
  TableElement,
  TextElement,
} from '../schema.js';
import { type NormalizedParagraph, normalizeParagraphs } from '../text.js';
import { TEXT_BOX } from '../text-metrics.js';
import { createSlidesHtmlExporter } from './html.js';
import { containRect, imageSize } from './image-size.js';
import { createSlidesMarkdownExporter } from './md.js';

// pptxgenjs ships CommonJS-style typings: under NodeNext the default import is typed as the module object,
// while the ESM build exports the class itself. Normalize both views.
const PptxGenJS: typeof PptxModule.default = ((PptxModule as unknown as { default?: unknown }).default ??
  PptxModule) as typeof PptxModule.default;
type PptxGenJS = InstanceType<typeof PptxModule.default>;
type Slide = PptxModule.default.Slide;
type TextProps = PptxModule.default.TextProps;

/** pptxgenjs wants colors as "RRGGBB". */
function hex(
  theme: Theme,
  color: Color | undefined,
  fallback: Parameters<typeof resolveColor>[2] = 'text',
): string {
  return resolveColor(theme, color, fallback).slice(1);
}

interface Resolved {
  bytes: Uint8Array;
  mimeType: string;
}

class DeckWriter {
  readonly #assets = new Map<string, Promise<Resolved | undefined>>();

  constructor(
    private readonly pptx: PptxGenJS,
    private readonly ctx: ExportContext,
  ) {}

  private get theme(): Theme {
    return this.ctx.theme;
  }

  private asset(ref: string): Promise<Resolved | undefined> {
    let pending = this.#assets.get(ref);
    if (!pending) {
      pending = this.ctx.assets.resolve(ref).then(
        (asset) => asset,
        () => {
          this.ctx.warn(`Image ${ref} could not be loaded; a placeholder was exported instead.`);
          return undefined;
        },
      );
      this.#assets.set(ref, pending);
    }
    return pending;
  }

  private runs(paragraphs: NormalizedParagraph[], style: ResolvedTextStyle): TextProps[] {
    const out: TextProps[] = [];
    paragraphs.forEach((paragraph, p) => {
      const last = p === paragraphs.length - 1;
      paragraph.runs.forEach((run, r) => {
        const options: PptxModule.default.TextPropsOptions = {
          paraSpaceAfter: Math.round(style.fontSize * TEXT_BOX.paragraphSpacing * 10) / 10,
        };
        if (run.bold) options.bold = true;
        if (run.italic) options.italic = true;
        if (run.underline) options.underline = { style: 'sng' };
        if (run.color) options.color = hex(this.theme, run.color);
        if (run.link) options.hyperlink = { url: run.link };
        if (paragraph.list === 'bullet') options.bullet = { indent: TEXT_BOX.bulletIndentPt };
        else if (paragraph.list === 'number')
          options.bullet = { type: 'number', indent: TEXT_BOX.bulletIndentPt };
        else options.bullet = false;
        if (paragraph.list && paragraph.level > 0) options.indentLevel = paragraph.level;
        if (r === paragraph.runs.length - 1 && !last) options.breakLine = true;
        out.push({ text: run.text, options });
      });
    });
    return out;
  }

  private textOptions(
    rect: { x: number; y: number; w: number; h: number },
    style: ResolvedTextStyle,
  ): PptxModule.default.TextPropsOptions {
    const padX = TEXT_BOX.padX * 72;
    const padY = TEXT_BOX.padY * 72;
    return {
      x: rect.x,
      y: rect.y,
      w: Math.max(0.01, rect.w),
      h: Math.max(0.01, rect.h),
      fontFace: this.theme.fonts[style.font],
      fontSize: style.fontSize,
      color: hex(this.theme, style.color),
      bold: style.bold,
      italic: style.italic,
      align: style.align,
      valign: style.valign,
      // pptxgenjs reads the array as [left, right, bottom, top], in points.
      margin: [padX, padX, padY, padY],
      wrap: true,
      fit: 'none',
    };
  }

  private text(slide: Slide, element: TextElement): void {
    const style = resolveTextStyle(element);
    slide.addText(this.runs(textElementParagraphs(element), style), {
      ...this.textOptions(element, style),
      ...(element.fill ? { fill: { color: hex(this.theme, element.fill) } } : {}),
    });
  }

  private shape(slide: Slide, element: ShapeElement): void {
    const isLine = element.shape === 'line' || element.shape === 'arrow';
    const lineWidth = element.line?.width ?? (isLine ? 1.5 : undefined);
    const line: PptxModule.default.ShapeLineProps | undefined =
      element.line || isLine
        ? {
            color: hex(this.theme, element.line?.color ?? (isLine ? 'text' : 'muted')),
            width: lineWidth ?? 1,
            ...(element.line?.dash === 'dash'
              ? { dashType: 'dash' as const }
              : element.line?.dash === 'dot'
                ? { dashType: 'sysDot' as const }
                : {}),
            ...(element.shape === 'arrow' ? { endArrowType: 'triangle' as const } : {}),
          }
        : undefined;
    const type =
      element.shape === 'rect'
        ? this.pptx.ShapeType.rect
        : element.shape === 'roundRect'
          ? this.pptx.ShapeType.roundRect
          : element.shape === 'ellipse'
            ? this.pptx.ShapeType.ellipse
            : this.pptx.ShapeType.line;
    const geometry: PptxModule.default.ShapeProps = {
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      ...(element.fill && !isLine ? { fill: { color: hex(this.theme, element.fill) } } : {}),
      ...(line && (lineWidth ?? 1) > 0 ? { line } : {}),
      ...(element.flipH ? { flipH: true } : {}),
      ...(element.flipV ? { flipV: true } : {}),
      ...(element.shape === 'roundRect' ? { rectRadius: Math.min(element.w, element.h) * 0.1667 } : {}),
    };
    if (element.text && !isLine) {
      const style = resolveTextStyle(element.text, DEFAULT_SHAPE_TEXT_STYLE);
      slide.addText(this.runs(normalizeParagraphs(element.text.paragraphs), style), {
        ...this.textOptions(element, style),
        ...geometry,
        shape: type,
      } as PptxModule.default.TextPropsOptions);
      return;
    }
    if (element.text && isLine) this.ctx.warn(`Text on line "${element.id}" is not exported.`);
    slide.addShape(type, geometry);
  }

  private placeholder(slide: Slide, element: ImageElement, reason: string): void {
    this.ctx.warn(reason);
    slide.addText(element.alt || element.asset, {
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      fontSize: 12,
      fontFace: this.theme.fonts.body,
      color: hex(this.theme, 'muted'),
      align: 'center',
      valign: 'middle',
      fill: { color: hex(this.theme, 'surface') },
      line: { color: hex(this.theme, 'muted'), width: 0.75, dashType: 'dash' },
    });
  }

  private async image(slide: Slide, element: ImageElement): Promise<void> {
    const asset = await this.asset(element.asset);
    if (!asset) {
      this.placeholder(slide, element, `Image ${element.asset} is unavailable; exported as a placeholder.`);
      return;
    }
    if (asset.mimeType === 'image/svg+xml') {
      this.placeholder(
        slide,
        element,
        `SVG image ${element.asset} cannot be embedded without a raster fallback; exported as a placeholder.`,
      );
      return;
    }
    const data = toDataUrl(asset.bytes, asset.mimeType);
    const size = imageSize(asset.bytes);
    const base = { data, altText: element.alt };
    if (!size) {
      this.ctx.warn(`Image ${element.asset} has unknown dimensions; it was stretched to its box.`);
      slide.addImage({ ...base, x: element.x, y: element.y, w: element.w, h: element.h });
      return;
    }
    if (element.fit === 'cover') {
      const ratio = size.width / size.height;
      slide.addImage({
        ...base,
        x: element.x,
        y: element.y,
        w: ratio,
        h: 1,
        sizing: { type: 'cover', w: element.w, h: element.h },
      });
      return;
    }
    slide.addImage({ ...base, ...containRect(element, size) });
  }

  private table(slide: Slide, element: TableElement): void {
    const theme = this.theme;
    const fontSize = element.fontSize ?? 14;
    const border = { type: 'solid' as const, pt: 0.75, color: hex(theme, element.borderColor ?? 'muted') };
    const rows: PptxModule.default.TableRow[] = [];
    if (element.header) {
      rows.push(
        element.header.map((cell) => ({
          text: cell,
          options: {
            bold: true,
            fill: { color: hex(theme, element.headerFill ?? 'text') },
            color: hex(theme, element.headerColor ?? 'background'),
          },
        })),
      );
    }
    element.rows.forEach((row, index) => {
      const banded = element.banded && index % 2 === 1;
      rows.push(
        row.map((cell) => ({
          text: cell,
          options: banded ? { fill: { color: hex(theme, 'surface') } } : {},
        })),
      );
    });
    slide.addTable(rows, {
      x: element.x,
      y: element.y,
      w: element.w,
      colW: tableColumnWidths(element, element.w),
      rowH: element.h / Math.max(1, rows.length),
      fontSize,
      fontFace: theme.fonts.body,
      color: hex(theme, element.color ?? 'text'),
      border,
      valign: 'middle',
      autoPage: false,
    });
  }

  private chart(slide: Slide, element: ChartElement): void {
    const theme = this.theme;
    const pie = element.chartType === 'pie';
    const data = element.series.map((series) => ({
      name: series.name,
      labels: element.categories,
      values: series.values,
    }));
    const palette = theme.chartPalette.map((color) => color.slice(1).toUpperCase());
    const colors = pie
      ? element.categories.map((_, index) => palette[index % palette.length]!)
      : element.series.map((series, index) =>
          series.color ? hex(theme, series.color) : palette[index % palette.length]!,
        );
    const legend = chartLegendPosition(element);
    const fontSize = element.fontSize ?? 12;
    const type =
      element.chartType === 'line'
        ? this.pptx.ChartType.line
        : pie
          ? this.pptx.ChartType.pie
          : this.pptx.ChartType.bar;
    const options: PptxModule.default.IChartOpts = {
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      chartColors: colors,
      showLegend: legend !== 'none',
      ...(legend !== 'none'
        ? {
            legendPos: legend === 'top' ? 't' : legend === 'right' ? 'r' : 'b',
            legendFontSize: fontSize,
            legendFontFace: theme.fonts.body,
          }
        : {}),
      showValue: element.showValues ?? false,
      dataLabelFontSize: fontSize,
      dataLabelFontFace: theme.fonts.body,
      ...(element.title
        ? {
            showTitle: true,
            title: element.title,
            titleFontSize: fontSize * 1.25,
            titleFontFace: theme.fonts.heading,
            titleColor: hex(theme, 'text'),
          }
        : {}),
    };
    if (!pie) {
      Object.assign(options, {
        catAxisLabelFontSize: fontSize,
        catAxisLabelFontFace: theme.fonts.body,
        catAxisLabelColor: hex(theme, 'text'),
        valAxisLabelFontSize: fontSize,
        valAxisLabelFontFace: theme.fonts.body,
        valAxisLabelColor: hex(theme, 'muted'),
        valGridLine: { color: 'D9DEE3', size: 0.75 },
      } satisfies PptxModule.default.IChartOpts);
    }
    if (element.chartType === 'bar' || element.chartType === 'stackedBar') options.barDir = 'bar';
    if (element.chartType === 'column') options.barDir = 'col';
    if (element.chartType === 'stackedBar') options.barGrouping = 'stacked';
    if (element.chartType === 'line')
      Object.assign(options, { lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 6 });
    if (pie) Object.assign(options, { showPercent: false, dataLabelColor: 'FFFFFF' });
    slide.addChart(type, data, options);
  }

  async primitive(slide: Slide, primitive: Primitive): Promise<void> {
    const { element } = primitive;
    if (primitive.source.kind === 'footer' && primitive.source.part === 'number' && element.type === 'text') {
      // Native slide number field, so PowerPoint renumbers when slides move.
      const style = resolveTextStyle(element);
      slide.slideNumber = {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        fontFace: this.theme.fonts[style.font],
        fontSize: style.fontSize,
        color: hex(this.theme, style.color),
        align: 'right',
        valign: 'middle',
      } as PptxModule.default.SlideNumberProps;
      return;
    }
    switch (element.type) {
      case 'text':
        this.text(slide, element);
        return;
      case 'shape':
        this.shape(slide, element);
        return;
      case 'image':
        await this.image(slide, element);
        return;
      case 'table':
        this.table(slide, element);
        return;
      case 'chart':
        this.chart(slide, element);
        return;
    }
  }

  async background(slide: Slide, background: { color: Color; image?: string }): Promise<void> {
    if (background.image) {
      const asset = await this.asset(background.image);
      if (asset && asset.mimeType !== 'image/svg+xml') {
        slide.background = { data: toDataUrl(asset.bytes, asset.mimeType) };
        return;
      }
      if (asset)
        this.ctx.warn(
          `SVG background ${background.image} is not supported in pptx; the background color was used.`,
        );
    }
    slide.background = { color: hex(this.theme, background.color, 'background') };
  }
}

export interface SlidesExporterOptions {
  /** Layouts of the kind (`slidesKind.layouts`); defaults to the built-ins. */
  layouts?: LayoutRegistry;
}

/** Writes a deck to PowerPoint with native, editable text boxes, tables and charts (spec §11.3, §12). */
export async function exportSlidesToPptx(
  content: SlidesContent,
  ctx: ExportContext,
  options: SlidesExporterOptions = {},
): Promise<Uint8Array> {
  const layouts = options.layouts ?? builtInLayouts;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = ctx.title;
  pptx.subject = ctx.title;
  pptx.theme = { headFontFace: ctx.theme.fonts.heading, bodyFontFace: ctx.theme.fonts.body };
  const writer = new DeckWriter(pptx, ctx);
  for (const [index, slide] of content.slides.entries()) {
    if (ctx.signal?.aborted) throw new ArtifactError('EXPORT_FAILED', 'Export aborted.');
    const composed = composeSlide(slide, {
      layouts,
      ...(content.footer ? { footer: content.footer } : {}),
      slideNumber: index + 1,
    });
    if (composed.unknownLayout)
      ctx.warn(
        `Slide ${slide.id} uses unknown layout "${slide.layout}"; a fallback arrangement was exported.`,
      );
    const target = pptx.addSlide();
    if (slide.hidden) target.hidden = true;
    await writer.background(target, composed.background);
    for (const primitive of composed.primitives) await writer.primitive(target, primitive);
    if (slide.notes) target.addNotes(slide.notes);
  }
  const output = await pptx.write({ outputType: 'uint8array', compression: true });
  if (output instanceof Uint8Array) return output;
  if (output instanceof ArrayBuffer) return new Uint8Array(output);
  throw new ArtifactError('EXPORT_FAILED', 'pptxgenjs did not return bytes.');
}

export function createSlidesExporters(
  options: SlidesExporterOptions = {},
): ArtifactExporter<SlidesContent>[] {
  return [
    {
      kind: 'slides',
      format: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
      runtime: 'any',
      export: (content, ctx) => exportSlidesToPptx(content, ctx, options),
    },
    createSlidesHtmlExporter(options.layouts),
    createSlidesMarkdownExporter(options.layouts),
  ];
}
