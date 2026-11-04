import { defaultTheme, type ExportContext, silentLogger } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { documentExporters, imageSize } from '../src/export/index.js';
import { markdownToContent } from '../src/index.js';
import { prepare, unzip } from './helpers.js';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

function context(options?: Record<string, unknown>): ExportContext & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    title: 'Proposal <Acme>',
    theme: defaultTheme,
    locale: 'en',
    logger: silentLogger,
    assets: {
      resolve: async (ref) => {
        if (ref === 'asset://logo') return { bytes: PNG, mimeType: 'image/png' };
        if (ref === 'asset://vector')
          return {
            bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
            mimeType: 'image/svg+xml',
          };
        throw new Error('missing');
      },
    },
    warn: (message) => warnings.push(message),
    warnings,
    ...(options ? { options } : {}),
  };
}

const content = prepare({
  cover: {
    eyebrow: 'Technical proposal',
    title: 'Portal',
    subtitle: 'Acme',
    fields: [{ label: 'Client', value: 'Acme' }],
  },
  page: {
    size: 'A4',
    orientation: 'landscape',
    header: 'Confidential',
    footer: 'Acme Inc.',
    pageNumbers: true,
  },
  blocks: [
    { id: 'toc', type: 'toc', maxLevel: 2 },
    { id: 'scope', type: 'heading', level: 1, runs: [{ text: 'Scope' }] },
    {
      id: 'p1',
      type: 'paragraph',
      runs: [
        { text: 'See ' },
        { text: 'costs', link: '#cost-table' },
        { text: ' and ' },
        { text: 'the site', link: 'https://example.com', bold: true },
        { text: ' <b>&</b>' },
      ],
    },
    {
      id: 'l1',
      type: 'list',
      ordered: true,
      items: [
        { runs: [{ text: 'one' }], children: [{ runs: [{ text: 'sub' }] }], childrenOrdered: false },
        { runs: [{ text: 'two' }] },
      ],
    },
    { id: 'l2', type: 'list', items: [{ runs: [{ text: 'bullet' }] }] },
    {
      id: 'cost-table',
      type: 'table',
      header: [[{ text: 'Module' }], [{ text: 'Hours' }]],
      rows: [[[{ text: 'Login' }], [{ text: '40' }]]],
      footer: [[{ text: 'Total' }], [{ text: '40' }]],
      align: ['left', 'right'],
      widths: [3, 1],
      caption: 'Estimate',
    },
    { id: 'c1', type: 'callout', tone: 'warning', title: 'Note', runs: [{ text: 'Prices change.' }] },
    { id: 'q1', type: 'quote', runs: [{ text: 'Great.' }], attribution: 'Ana' },
    { id: 'code1', type: 'code', language: 'ts', text: 'const a = 1;\nconst b = 2;' },
    { id: 'img1', type: 'image', asset: 'asset://logo', alt: 'Company logo', caption: 'Logo' },
    { id: 'img2', type: 'image', asset: 'asset://vector', alt: 'Vector chart' },
    { id: 'img3', type: 'image', asset: 'asset://gone', alt: 'Gone' },
    { id: 'hr', type: 'divider' },
    { id: 'pb', type: 'pageBreak' },
    {
      id: 'end',
      type: 'paragraph',
      runs: [
        { text: 'x', superscript: true },
        { text: 'y', subscript: true },
        { text: 'z', strike: true, underline: true, italic: true },
      ],
    },
  ],
});

const exporter = (format: string) => documentExporters.find((candidate) => candidate.format === format)!;

describe('docx exporter', () => {
  it('writes native Word structures', async () => {
    const ctx = context();
    const bytes = await exporter('docx').export(content, ctx);
    const files = unzip(bytes);
    const xml = files.get('word/document.xml')!;
    expect(xml).toBeDefined();
    // Native heading styles (Word TOC) and a TOC field limited to the requested levels.
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('TOC \\h \\o &quot;1-2&quot;');
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    // Cover followed by a page break, page break block too.
    expect((xml.match(/<w:br w:type="page"\/>/g) ?? []).length).toBe(2);
    // Lists use numbering definitions.
    expect(xml).toContain('<w:numPr>');
    const numbering = files.get('word/numbering.xml')!;
    expect(numbering).toContain('w:val="decimal"');
    expect(numbering).toContain('w:val="bullet"');
    // Table with repeated header row and column widths proportional to [3, 1].
    expect(xml).toContain('<w:tblHeader/>');
    const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    // Grid columns 0-1 belong to the cover fields table.
    expect(grid[2]! / grid[3]!).toBeCloseTo(3, 1);
    // Internal link to a bookmark, external hyperlink relationship.
    expect(xml).toContain('w:anchor="ak_cost_table"');
    expect(xml).toContain('w:name="ak_cost_table"');
    expect(files.get('word/_rels/document.xml.rels')).toContain('https://example.com');
    // Text is escaped, formatting kept.
    expect(xml).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(xml).toContain('<w:strike/>');
    // Landscape page, header and footer with page numbers; first page (cover) without them.
    expect(xml).toMatch(/<w:pgSz w:w="(\d+)" w:h="(\d+)" w:orient="landscape"\/>/);
    const [, w, h] = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(xml)!;
    expect(Number(w)).toBeGreaterThan(Number(h));
    expect(xml).toContain('<w:titlePg/>');
    const headers = [...files.entries()]
      .filter(([name]) => name.startsWith('word/header'))
      .map(([, text]) => text)
      .join('');
    const footers = [...files.entries()]
      .filter(([name]) => name.startsWith('word/footer'))
      .map(([, text]) => text)
      .join('');
    expect(headers).toContain('Confidential');
    expect(footers).toContain('Acme Inc.');
    expect(footers).toContain('PAGE');
    expect(footers).toContain('NUMPAGES');
    // The PNG is embedded; unsupported or missing images degrade with warnings.
    expect([...files.keys()].some((name) => name.startsWith('word/media/'))).toBe(true);
    expect(xml).toContain('descr="Company logo"');
    expect(xml).toContain('[Vector chart]');
    expect(ctx.warnings).toEqual([
      'Image asset://gone could not be loaded; a placeholder was used.',
      'Callouts were exported as shaded single-cell tables (Word has no callout element).',
      'Image asset://vector (image/svg+xml) is not supported by Word; its alt text was used.',
    ]);
    expect(files.get('word/settings.xml')).toContain('w:updateFields');
  });

  it('exports an empty document', async () => {
    const files = unzip(await exporter('docx').export({ blocks: [] }, context()));
    expect(files.get('word/document.xml')).toContain('<w:body>');
  });

  it('reads image dimensions', () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
    expect(imageSize(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 2, 0]))).toEqual({
      width: 3,
      height: 2,
    });
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0, 0,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 30, height: 20 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe('md exporter', () => {
  it('writes GFM that converts back to the same document', async () => {
    const ctx = context();
    const text = new TextDecoder().decode(await exporter('md').export(content, ctx));
    expect(text.startsWith('---\neyebrow: "Technical proposal"\ntitle: "Portal"')).toBe(true);
    expect(text).toContain('| Module | Hours |\n| :--- | ---: |');
    expect(text).toContain('> [!WARNING]\n> **Note**\n> Prices change.');
    expect(text).toContain('See [costs](#cost-table) and [**the site**](https://example.com) \\<b>&\\</b>');
    expect(ctx.warnings).toHaveLength(2);
    const back = markdownToContent(text).content;
    expect(back.cover).toEqual(content.cover);
    expect(back.page).toEqual(content.page);
    expect(back.blocks.map(({ id: _id, ...rest }) => rest)).toEqual(
      content.blocks.map(({ id: _id, ...rest }) => rest),
    );
  });

  it('can embed images and drop metadata comments', async () => {
    const text = new TextDecoder().decode(
      await exporter('md').export(content, context({ images: 'embed', metadata: false })),
    );
    expect(text).toContain('![Company logo](data:image/png;base64,');
    expect(text).not.toContain('ak:table');
  });
});

describe('html exporter', () => {
  it('writes a self-contained, escaped page with theme colors', async () => {
    const ctx = context();
    const html = new TextDecoder().decode(await exporter('html').export(content, ctx));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Proposal &lt;Acme&gt;</title>');
    expect(html).toContain(`--ak-color-accent: ${defaultTheme.colors.accent};`);
    expect(html).toContain('.ak-document-callout--warning');
    expect(html).toContain('@page { size: 297mm 210mm;');
    expect(html).toContain('<h1 id="ak-scope">Scope</h1>');
    expect(html).toContain('<a href="#ak-cost-table">costs</a>');
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer"><strong>the site</strong></a>',
    );
    expect(html).toContain(' &lt;b&gt;&amp;&lt;/b&gt;');
    expect(html).toContain('<li class="ak-document-toc-level-1"><a href="#ak-scope">Scope</a></li>');
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain(
      '<thead><tr><th scope="col">Module</th><th scope="col" style="text-align:right">Hours</th></tr></thead>',
    );
    expect(html).toContain('<tfoot>');
    expect(html).toContain('<ol id="ak-l1"><li>one<ul><li>sub</li></ul></li><li>two</li></ol>');
    expect(html).not.toMatch(/<script/i);
    expect(ctx.warnings).toEqual(['Image asset://gone could not be loaded; a placeholder was used.']);
  });
});
