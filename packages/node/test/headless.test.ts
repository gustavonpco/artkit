import {
  type ArtifactExporter,
  createMemoryAssetStore,
  defaultTheme,
  type ExportContext,
  type RenderContext,
  silentLogger,
} from '@artkit-ai/core';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  buildPrintHtml,
  collectAssetRefs,
  createHeadlessExporters,
  createHeadlessRenderer,
  createPlaywrightLauncher,
  type HeadlessBrowser,
  type HeadlessContextOptions,
  type HeadlessPage,
  HeadlessRenderError,
} from '../src/headless/index.js';
import { PNG, user } from './helpers.js';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 fake');

interface FakeOptions {
  /** Called inside setContent; return a promise to hold the page. */
  onSetContent?: (html: string) => Promise<void> | void;
  connected?: () => boolean;
}

/** In-memory HeadlessBrowser recording everything the renderer does. */
function fakeBrowser(options: FakeOptions = {}) {
  const log = {
    launches: 0,
    contexts: [] as HeadlessContextOptions[],
    routes: [] as string[],
    aborted: [] as (string | undefined)[],
    html: [] as string[],
    media: [] as string[],
    pdf: [] as unknown[],
    screenshots: [] as unknown[],
    closedContexts: 0,
    closedBrowsers: 0,
    active: 0,
    maxActive: 0,
  };
  const launch = async (): Promise<HeadlessBrowser> => {
    log.launches++;
    return {
      isConnected: options.connected ?? (() => true),
      async close() {
        log.closedBrowsers++;
      },
      async newContext(contextOptions) {
        log.contexts.push(contextOptions);
        log.active++;
        log.maxActive = Math.max(log.maxActive, log.active);
        let closed = false;
        return {
          async route(url, handler) {
            log.routes.push(url);
            // Simulate the page requesting an external image: the handler must abort it.
            await handler({
              abort: async (code?: string) => {
                log.aborted.push(code);
              },
            });
          },
          async newPage(): Promise<HeadlessPage> {
            return {
              async setContent(html) {
                log.html.push(html);
                await options.onSetContent?.(html);
              },
              async emulateMedia(media) {
                log.media.push(media.media);
              },
              async pdf(pdfOptions) {
                log.pdf.push(pdfOptions);
                return PDF_BYTES;
              },
              async screenshot(shotOptions) {
                log.screenshots.push(shotOptions);
                return PNG;
              },
            };
          },
          async close() {
            if (!closed) {
              closed = true;
              log.closedContexts++;
              log.active--;
            }
          },
        };
      },
    };
  };
  return { launch, log };
}

function exportContext(overrides: Partial<ExportContext> = {}): ExportContext & { warnings: string[] } {
  const warnings: string[] = [];
  const assets = createMemoryAssetStore();
  return {
    title: 'Q3 <Report> & "Notes"',
    theme: defaultTheme,
    locale: 'pt-BR',
    assets: { resolve: (ref) => assets.get(user, ref) },
    logger: silentLogger,
    warn: (message) => warnings.push(message),
    warnings,
    ...overrides,
  };
}

interface NoteContent {
  items: { id: string; text: string; image?: string }[];
}

function noteRender(content: NoteContent, ctx: RenderContext) {
  return createElement(
    'article',
    { className: `ak-note ak-note--${ctx.mode}` },
    content.items.map((item) =>
      createElement(
        'section',
        { key: item.id, id: item.id },
        createElement('p', null, item.text),
        item.image
          ? createElement('img', { src: ctx.resolveAssetUrl?.(item.image) ?? 'about:blank', alt: item.id })
          : null,
      ),
    ),
  );
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('buildPrintHtml', () => {
  it('escapes the title, keeps CSS inside <style> and includes theme variables', () => {
    const html = buildPrintHtml({
      body: '<p>ok</p>',
      title: '</title><script>x()</script>',
      locale: 'pt-BR"><x',
      theme: defaultTheme,
      page: { width: 1280, height: 720 },
      css: ['.a { color: red } </style><script>alert(1)</script>'],
    });
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</title>');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('</style><script>');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).toContain(`--ak-color-accent: ${defaultTheme.colors.accent};`);
    expect(html).toContain('@page { size: 1280px 720px; margin: 0; }');
    expect(html).toContain('content="default-src &#39;none&#39;;');
  });
});

describe('collectAssetRefs', () => {
  it('finds whole and embedded refs once', () => {
    const refs = collectAssetRefs({
      a: 'asset://img_1',
      b: ['see ![x](asset://img_2).', { c: 'asset://img_1' }],
      n: 3,
    });
    expect(refs.sort()).toEqual(['asset://img_1', 'asset://img_2']);
  });
});

describe('createHeadlessRenderer', () => {
  it('isolates each render with JavaScript off, offline mode and every request aborted', async () => {
    const { launch, log } = fakeBrowser();
    const renderer = createHeadlessRenderer({ launch });
    const bytes = await renderer.render({ html: '<p>x</p>', format: 'pdf', page: 'A4' });
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-1.7 fake');
    expect(log.contexts[0]).toEqual({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
      offline: true,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    expect(log.routes).toEqual(['**/*']);
    expect(log.aborted).toEqual(['blockedbyclient']);
    expect(log.pdf[0]).toMatchObject({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    expect(log.closedContexts).toBe(1);
    await renderer.close();
    expect(log.closedBrowsers).toBe(1);
    await expect(renderer.render({ html: '', format: 'pdf', page: 'A4' })).rejects.toMatchObject({
      reason: 'closed',
    });
  });

  it('renders PNG as one full-page screenshot with print media', async () => {
    const { launch, log } = fakeBrowser();
    const renderer = createHeadlessRenderer({ launch });
    const bytes = await renderer.render({
      html: '<p>x</p>',
      format: 'png',
      page: { width: 1280, height: 720 },
      scale: 2,
    });
    expect([...bytes]).toEqual([...PNG]);
    expect(log.media).toEqual(['print']);
    expect(log.screenshots[0]).toMatchObject({ type: 'png', fullPage: true });
    expect(log.contexts[0]).toMatchObject({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    await renderer.close();
  });

  it('limits concurrency and queues the rest in order', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];
    let call = 0;
    const { launch, log } = fakeBrowser({ onSetContent: () => gates[call++]!.promise });
    const renderer = createHeadlessRenderer({ launch, concurrency: 2 });
    const jobs = gates.map(() => renderer.render({ html: '<p/>', format: 'pdf', page: 'Letter' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(renderer.active).toBe(2);
    expect(renderer.queued).toBe(3);
    for (const gate of gates) gate.resolve();
    await Promise.all(jobs);
    expect(log.maxActive).toBe(2);
    expect(log.launches).toBe(1);
    expect(renderer.active).toBe(0);
    await renderer.close();
  });

  it('times out a stuck page and closes its context', async () => {
    const { launch, log } = fakeBrowser({ onSetContent: () => new Promise(() => {}) });
    const renderer = createHeadlessRenderer({ launch, pageTimeoutMs: 40 });
    const error = await renderer.render({ html: '<p/>', format: 'pdf', page: 'A4' }).catch((e) => e);
    expect(error).toBeInstanceOf(HeadlessRenderError);
    expect(error.reason).toBe('timeout');
    expect(log.closedContexts).toBe(1);
    expect(renderer.active).toBe(0);
    await renderer.close();
  });

  it('honors the caller signal, also while queued', async () => {
    const gate = deferred();
    const { launch } = fakeBrowser({ onSetContent: () => gate.promise });
    const renderer = createHeadlessRenderer({ launch, concurrency: 1 });
    const first = renderer.render({ html: '', format: 'pdf', page: 'A4' });
    const controller = new AbortController();
    const queued = renderer.render({ html: '', format: 'pdf', page: 'A4', signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ reason: 'aborted' });
    expect(renderer.queued).toBe(0);
    gate.resolve();
    await first;
    await expect(
      renderer.render({ html: '', format: 'pdf', page: 'A4', signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ reason: 'aborted' });
    await renderer.close();
  });

  it('recycles and relaunches browsers', async () => {
    let connected = true;
    const { launch, log } = fakeBrowser({ connected: () => connected });
    const renderer = createHeadlessRenderer({ launch, recycleAfter: 2 });
    for (let i = 0; i < 3; i++) await renderer.render({ html: '', format: 'pdf', page: 'A4' });
    expect(log.launches).toBe(2);
    expect(log.closedBrowsers).toBe(1);
    connected = false;
    // A disconnected browser is replaced once, then the job fails clearly.
    await expect(renderer.render({ html: '', format: 'pdf', page: 'A4' })).rejects.toMatchObject({
      reason: 'launch',
    });
    connected = true;
    await renderer.render({ html: '', format: 'pdf', page: 'A4' });
    await renderer.close();
  });

  it('does not cache a failed launch', async () => {
    let attempts = 0;
    const good = fakeBrowser();
    const renderer = createHeadlessRenderer({
      launch: async () => {
        if (attempts++ === 0) throw new Error('no chromium');
        return good.launch();
      },
    });
    await expect(renderer.render({ html: '', format: 'pdf', page: 'A4' })).rejects.toThrow('no chromium');
    await renderer.render({ html: '', format: 'pdf', page: 'A4' });
    expect(attempts).toBe(2);
    await renderer.close();
  });

  it('validates options and jobs', async () => {
    expect(() => createHeadlessRenderer({ concurrency: 0 })).toThrow(TypeError);
    expect(() => createHeadlessRenderer({ pageTimeoutMs: -1 })).toThrow(TypeError);
    const renderer = createHeadlessRenderer({ launch: fakeBrowser().launch });
    await expect(
      renderer.render({ html: '', format: 'pdf', page: { width: 0, height: 10 } }),
    ).rejects.toThrow(TypeError);
    await renderer.close();
  });
});

describe('createHeadlessExporters', () => {
  it('builds node exporters per kind and format', () => {
    const { launch } = fakeBrowser();
    const exporters = createHeadlessExporters({
      renderer: createHeadlessRenderer({ launch }),
      kinds: [{ kind: 'note', render: noteRender, formats: ['pdf', 'png', 'pdf'] }],
    });
    expect(
      exporters.map((e: ArtifactExporter) => [e.kind, e.format, e.mimeType, e.extension, e.runtime]),
    ).toEqual([
      ['note', 'pdf', 'application/pdf', 'pdf', 'node'],
      ['note', 'png', 'image/png', 'png', 'node'],
    ]);
  });

  it('renders the React renderer in print mode with escaped content, CSS, theme and inlined assets', async () => {
    const { launch, log } = fakeBrowser();
    const renderer = createHeadlessRenderer({ launch });
    const assets = createMemoryAssetStore();
    const stored = await assets.put(user, PNG, { mimeType: 'image/png' });
    const [pdf] = createHeadlessExporters({
      renderer,
      kinds: [
        {
          kind: 'note',
          render: noteRender,
          css: '.ak-note { color: var(--ak-color-text); }',
          formats: ['pdf'],
          page: { width: 1280, height: 720 },
        },
      ],
    });
    const ctx = exportContext({ assets: { resolve: (ref) => assets.get(user, ref) } });
    const content: NoteContent = {
      items: [
        { id: 'a', text: '<script>alert("x")</script> & more', image: stored.ref },
        { id: 'b', text: 'missing image', image: 'asset://gone' },
      ],
    };
    const bytes = await pdf!.export(content, ctx);
    expect(new TextDecoder().decode(bytes)).toContain('%PDF');
    const html = log.html[0]!;
    expect(html).toContain('ak-note--print');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more');
    expect(html).not.toContain('<script>');
    expect(html).toContain('.ak-note { color: var(--ak-color-text); }');
    expect(html).toContain(`--ak-color-background: ${defaultTheme.colors.background};`);
    expect(html).toContain('<title>Q3 &lt;Report&gt; &amp; &quot;Notes&quot;</title>');
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('src="about:blank"');
    expect(ctx.warnings).toEqual(['Asset asset://gone could not be loaded; a placeholder was rendered.']);
    expect(log.pdf[0]).toMatchObject({ width: '1280px', height: '720px' });
    await renderer.close();
  });

  it('caps the inlined asset bytes', async () => {
    const { launch, log } = fakeBrowser();
    const renderer = createHeadlessRenderer({ launch });
    const assets = createMemoryAssetStore();
    const stored = await assets.put(user, PNG, { mimeType: 'image/png' });
    const [png] = createHeadlessExporters({
      renderer,
      maxAssetBytes: 4,
      kinds: [{ kind: 'note', render: noteRender, formats: ['png'], scale: 2 }],
    });
    const ctx = exportContext({ assets: { resolve: (ref) => assets.get(user, ref) } });
    await png!.export({ items: [{ id: 'a', text: 'x', image: stored.ref }] }, ctx);
    expect(ctx.warnings[0]).toMatch(/was not embedded/);
    expect(log.html[0]).not.toContain('data:image/png');
    expect(log.contexts[0]?.deviceScaleFactor).toBe(2);
    await renderer.close();
  });

  it('uses an injected markup renderer', async () => {
    const { launch, log } = fakeBrowser();
    const renderer = createHeadlessRenderer({ launch });
    const [pdf] = createHeadlessExporters({
      renderer,
      renderToStaticMarkup: () => '<main>custom</main>',
      kinds: [{ kind: 'note', render: noteRender, formats: ['pdf'] }],
    });
    await pdf!.export({ items: [] }, exportContext());
    expect(log.html[0]).toContain('<main>custom</main>');
    await renderer.close();
  });
});

async function playwrightAvailable(): Promise<boolean> {
  try {
    const browser = await createPlaywrightLauncher()();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const realBrowser = await playwrightAvailable();

describe.skipIf(!realBrowser)('headless rendering in real Chromium', () => {
  it('produces PDF and PNG files without network access', async () => {
    const renderer = createHeadlessRenderer({ concurrency: 2 });
    try {
      const assets = createMemoryAssetStore();
      const stored = await assets.put(user, PNG, { mimeType: 'image/png' });
      const exporters = createHeadlessExporters({
        renderer,
        kinds: [
          { kind: 'note', render: noteRender, formats: ['pdf', 'png'], page: { width: 640, height: 360 } },
        ],
      });
      const content: NoteContent = { items: [{ id: 'a', text: 'Hello', image: stored.ref }] };
      const ctx = exportContext({ assets: { resolve: (ref) => assets.get(user, ref) } });
      const [pdf, png] = await Promise.all(exporters.map((exporter) => exporter.export(content, ctx)));
      expect(new TextDecoder().decode(pdf!.slice(0, 5))).toBe('%PDF-');
      expect([...png!.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // An external resource must not stall or fail the render: it is aborted.
      const external = buildPrintHtml({
        body: '<img src="https://example.com/x.png" alt="x"><p>offline</p>',
        title: 'x',
        locale: 'en',
        theme: defaultTheme,
        page: 'A4',
      });
      const bytes = await renderer.render({ html: external, format: 'pdf', page: 'A4' });
      expect(bytes.byteLength).toBeGreaterThan(100);
    } finally {
      await renderer.close();
    }
  });
});
