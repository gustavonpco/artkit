import { defaultTheme, type ExportContext, silentLogger } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { containRect, exportSlidesToPptx, imageSize, slidesExporters } from '../src/export/index.js';
import { slidesKind } from '../src/index.js';
import { fullDeck } from './fixtures.js';
import { readZip } from './zip.js';

// 2x1 PNG (red, blue).
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAP/wH/JTYm6QAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

function context(overrides: Partial<ExportContext> = {}): ExportContext & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    title: 'Deck',
    theme: defaultTheme,
    locale: 'en',
    logger: silentLogger,
    assets: {
      async resolve(ref) {
        if (ref === 'asset://photo') return { bytes: PNG, mimeType: 'image/png' };
        throw new Error('missing');
      },
    },
    warn: (message) => warnings.push(message),
    warnings,
    ...overrides,
  };
}

function slideXml(files: Map<string, string>, n: number): string {
  return files.get(`ppt/slides/slide${n}.xml`) ?? '';
}

describe('pptx exporter', () => {
  it('is registered as an any-runtime pptx exporter', () => {
    expect(slidesExporters[0]).toMatchObject({
      kind: 'slides',
      format: 'pptx',
      extension: 'pptx',
      runtime: 'any',
    });
  });

  it('writes native text, tables, charts, notes, footer and slide numbers', async () => {
    const ctx = context();
    const bytes = await exportSlidesToPptx(fullDeck, ctx);
    const files = readZip(bytes);
    const slides = [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slides).toHaveLength(7);
    expect(slideXml(files, 1)).toContain('Supplier portal');
    expect(slideXml(files, 2)).toContain('Three disconnected systems');
    expect(slideXml(files, 2)).toContain('<a:buChar');
    expect(slideXml(files, 2)).toMatch(
      /<a:rPr[^>]*b="1"[^>]*>(?:(?!<\/a:rPr>).)*<\/a:rPr><a:t>twice<\/a:t>/s,
    );
    // Footer text and native slide number on content slides, not on the title slide.
    expect(slideXml(files, 2)).toContain('Acme · Confidential');
    expect(slideXml(files, 2)).toContain('type="slidenum"');
    expect(slideXml(files, 1)).not.toContain('Acme · Confidential');
    // Native table.
    expect(slideXml(files, 4)).toContain('<a:tbl>');
    expect(slideXml(files, 4)).toContain('Discovery');
    // Native charts with the theme palette.
    const charts = [...files.keys()].filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    expect(charts.length).toBe(2);
    const chartXml = charts.map((name) => files.get(name)!).join('');
    expect(chartXml).toContain('Suppliers');
    expect(chartXml).toContain('<c:barDir val="col"/>');
    expect(chartXml).toContain('<c:pieChart>');
    expect(chartXml).toContain(defaultTheme.chartPalette[0]!.slice(1));
    // Notes.
    const notes = [...files.entries()]
      .filter(([name]) => name.startsWith('ppt/notesSlides/'))
      .map(([, xml]) => xml)
      .join('');
    expect(notes).toContain('Open with the discovery meeting context.');
    // Hidden slide, background and image.
    expect(slideXml(files, 7)).toContain('show="0"');
    expect(slideXml(files, 7)).toContain(defaultTheme.colors.surface.slice(1));
    expect(slideXml(files, 7)).toContain('descr="Team photo"');
    expect([...files.keys()].some((name) => name.startsWith('ppt/media/'))).toBe(true);
    // Missing asset degrades with a warning.
    expect(ctx.warnings.some((warning) => warning.includes('asset://diagram'))).toBe(true);
  });

  it('exports custom layouts and warns about unknown ones', async () => {
    const ctx = context();
    const content = {
      size: '16:9' as const,
      slides: [{ id: 'x', layout: 'mystery', slots: { title: 'Hello', body: 'World' }, elements: [] }],
    };
    const files = readZip(await exportSlidesToPptx(content, ctx));
    expect(slideXml(files, 1)).toContain('World');
    expect(ctx.warnings[0]).toContain('unknown layout');
  });

  it('honors abort signals', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exportSlidesToPptx(fullDeck, context({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
    });
  });

  it('reads image sizes and fits them', () => {
    expect(imageSize(PNG)).toEqual({ width: 2, height: 1 });
    expect(containRect({ x: 0, y: 0, w: 4, h: 4 }, { width: 2, height: 1 })).toEqual({
      x: 0,
      y: 1,
      w: 4,
      h: 2,
    });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it('every instruction example exports', async () => {
    const example = slidesKind.instructions.examples[0]!.content;
    const prepared = slidesKind.contentSchema.parse(example);
    const files = readZip(await exportSlidesToPptx(prepared, context()));
    expect(slideXml(files, 3)).toContain('40%');
  });
});

describe('html and markdown exporters', () => {
  it('registers pptx, html and md', () => {
    expect(slidesExporters.map((exporter) => exporter.format)).toEqual(['pptx', 'html', 'md']);
  });

  it('writes a self-contained html deck with notes and without hidden slides', async () => {
    const ctx = context();
    const exporter = slidesExporters.find((item) => item.format === 'html')!;
    const html = new TextDecoder().decode(await exporter.export(fullDeck, ctx));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('--ak-color-text');
    expect(html).toContain('Supplier portal');
    expect(html.match(/class="ak-slides-export-slide"/g)).toHaveLength(6);
    expect(html).not.toContain('<script');
    expect(ctx.warnings.some((warning) => warning.includes('hidden slide'))).toBe(true);
    const all = new TextDecoder().decode(
      await exporter.export(fullDeck, context({ options: { hidden: true } })),
    );
    expect(all.match(/class="ak-slides-export-slide"/g)).toHaveLength(7);
  });

  it('writes a markdown outline with headings, tables and notes', async () => {
    const ctx = context();
    const exporter = slidesExporters.find((item) => item.format === 'md')!;
    const md = new TextDecoder().decode(await exporter.export(fullDeck, ctx));
    expect(md.startsWith('# Deck\n')).toBe(true);
    expect(md).toMatch(/^## 1\. Supplier portal/m);
    expect(md.split('\n---\n')).toHaveLength(8);
    expect(md).toContain('| --- |');
    expect(ctx.warnings).toHaveLength(1);
  });
});
