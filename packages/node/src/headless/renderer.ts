import { type PageSize, pageDimensions } from './html.js';

/** Request interception handle (subset of Playwright's `Route`). */
export interface HeadlessRoute {
  abort(errorCode?: string): Promise<void>;
}

export interface HeadlessPdfOptions {
  format?: string;
  width?: string;
  height?: string;
  printBackground: boolean;
  preferCSSPageSize: boolean;
  margin: { top: string; right: string; bottom: string; left: string };
}

/** Subset of Playwright's `Page` used by the renderer. */
export interface HeadlessPage {
  setContent(
    html: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number },
  ): Promise<unknown>;
  emulateMedia(options: { media: 'print' | 'screen' }): Promise<unknown>;
  pdf(options: HeadlessPdfOptions): Promise<Uint8Array>;
  screenshot(options: { type: 'png'; fullPage: boolean; timeout?: number }): Promise<Uint8Array>;
}

export interface HeadlessContextOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  javaScriptEnabled: boolean;
  offline: boolean;
  serviceWorkers: 'block';
  acceptDownloads: boolean;
}

/** Subset of Playwright's `BrowserContext`. */
export interface HeadlessContext {
  route(url: string, handler: (route: HeadlessRoute) => unknown): Promise<unknown>;
  newPage(): Promise<HeadlessPage>;
  close(): Promise<unknown>;
}

/**
 * Minimal browser contract (a structural subset of Playwright's `Browser`). Inject your own
 * implementation through `launch` to use another driver or a fake in tests.
 */
export interface HeadlessBrowser {
  newContext(options: HeadlessContextOptions): Promise<HeadlessContext>;
  close(): Promise<unknown>;
  isConnected?(): boolean;
}

export type HeadlessLauncher = () => Promise<HeadlessBrowser>;

export interface RenderJob {
  /** Complete, self-contained HTML (see `buildPrintHtml`). */
  html: string;
  format: 'pdf' | 'png';
  page: PageSize;
  signal?: AbortSignal;
  /** Device pixel ratio for PNG (default 1). */
  scale?: number;
}

export interface HeadlessRenderer {
  /**
   * Renders HTML to PDF (one page per print page) or PNG (a single image of the full page height:
   * multi-page content becomes one tall PNG with the pages stacked).
   */
  render(job: RenderJob): Promise<Uint8Array>;
  /** Waits for in-flight renders to settle and closes the browser. Further renders fail. */
  close(): Promise<void>;
  /** Renders running now. */
  readonly active: number;
  /** Renders waiting for a slot. */
  readonly queued: number;
}

export interface HeadlessRendererOptions {
  /** Browser factory; defaults to Playwright Chromium (optional peer dependency). */
  launch?: HeadlessLauncher;
  /** Pages rendered at the same time (default 2). Extra jobs wait in a FIFO queue. */
  concurrency?: number;
  /** Limit for one render, from opening the page to the output (default 30 000 ms). */
  pageTimeoutMs?: number;
  /** Relaunch the browser after this many renders to bound memory growth (default 200). */
  recycleAfter?: number;
}

export type HeadlessRenderErrorReason = 'timeout' | 'aborted' | 'closed' | 'launch';

/** Failure of the headless pipeline. The service turns it into `EXPORT_FAILED` for the model. */
export class HeadlessRenderError extends Error {
  readonly reason: HeadlessRenderErrorReason;
  constructor(reason: HeadlessRenderErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HeadlessRenderError';
    this.reason = reason;
  }
}

const PLAYWRIGHT_MISSING =
  'Headless PNG/PDF export needs the optional peer dependency "playwright". Install it with ' +
  '`npm install playwright` (or `pnpm add playwright`) and download Chromium with `npx playwright install chromium`, ' +
  'or pass a custom `launch` to createHeadlessRenderer.';

export interface PlaywrightLauncherOptions {
  /** Options forwarded to `chromium.launch` (e.g. `executablePath`). `headless` is always true. */
  launchOptions?: Record<string, unknown>;
}

/** Launcher backed by Playwright Chromium, imported lazily so the dependency stays optional. */
export function createPlaywrightLauncher(options: PlaywrightLauncherOptions = {}): HeadlessLauncher {
  return async () => {
    // A variable specifier keeps bundlers and the type checker from requiring the optional peer.
    const specifier = 'playwright';
    let chromium: { launch(options: Record<string, unknown>): Promise<unknown> } | undefined;
    try {
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        chromium?: typeof chromium;
        default?: { chromium?: typeof chromium };
      };
      chromium = mod.chromium ?? mod.default?.chromium;
    } catch (cause) {
      throw new HeadlessRenderError('launch', PLAYWRIGHT_MISSING, { cause });
    }
    if (!chromium) throw new HeadlessRenderError('launch', PLAYWRIGHT_MISSING);
    try {
      return (await chromium.launch({ ...options.launchOptions, headless: true })) as HeadlessBrowser;
    } catch (cause) {
      throw new HeadlessRenderError(
        'launch',
        'Could not launch Chromium through Playwright. Run `npx playwright install chromium` (or set `executablePath`).',
        { cause },
      );
    }
  };
}

interface BrowserSlot {
  browser: Promise<HeadlessBrowser>;
  uses: number;
  inFlight: number;
  retired: boolean;
}

/**
 * Headless renderer with a recycled browser, a concurrency limit, a per-page timeout and total network
 * blocking (spec §12.3, §16): each render runs in a fresh, isolated context with JavaScript disabled,
 * offline mode and every request aborted, so assets must already be inlined as data URLs.
 */
export function createHeadlessRenderer(options: HeadlessRendererOptions = {}): HeadlessRenderer {
  const launch = options.launch ?? createPlaywrightLauncher();
  const concurrency = options.concurrency ?? 2;
  const pageTimeoutMs = options.pageTimeoutMs ?? 30_000;
  const recycleAfter = options.recycleAfter ?? 200;
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new TypeError('createHeadlessRenderer: `concurrency` must be a positive integer.');
  if (!Number.isFinite(pageTimeoutMs) || pageTimeoutMs <= 0)
    throw new TypeError('createHeadlessRenderer: `pageTimeoutMs` must be positive.');
  if (!Number.isInteger(recycleAfter) || recycleAfter < 1)
    throw new TypeError('createHeadlessRenderer: `recycleAfter` must be a positive integer.');

  let active = 0;
  let closed = false;
  const waiting: Array<{ grant: () => void; reject: (error: unknown) => void }> = [];
  const running = new Set<Promise<unknown>>();
  let slot: BrowserSlot | undefined;

  async function acquireSlot(signal: AbortSignal): Promise<void> {
    if (active < concurrency) {
      active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(abortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      waiting.push(entry);
    });
  }

  function releaseSlot(): void {
    const next = waiting.shift();
    // The slot passes straight to the next job, so `active` stays the same.
    if (next) next.grant();
    else active--;
  }

  function retire(target: BrowserSlot): void {
    if (target.retired) return;
    target.retired = true;
    if (slot === target) slot = undefined;
    if (target.inFlight === 0) closeBrowser(target);
  }

  function closeBrowser(target: BrowserSlot): void {
    target.browser.then((browser) => browser.close()).catch(() => {});
  }

  function checkoutBrowser(): BrowserSlot {
    if (!slot || slot.uses >= recycleAfter) {
      if (slot) retire(slot);
      const fresh: BrowserSlot = { browser: launch(), uses: 0, inFlight: 0, retired: false };
      // A failed launch is not cached: the next job retries.
      fresh.browser.catch(() => retire(fresh));
      slot = fresh;
    }
    slot.uses++;
    slot.inFlight++;
    return slot;
  }

  function releaseBrowser(target: BrowserSlot): void {
    target.inFlight--;
    if (target.retired && target.inFlight === 0) closeBrowser(target);
  }

  async function renderOnce(job: RenderJob, signal: AbortSignal, retried = false): Promise<Uint8Array> {
    const { width, height } = pageDimensions(job.page);
    const target = checkoutBrowser();
    let browser: HeadlessBrowser;
    try {
      browser = await raceAbort(target.browser, signal);
    } catch (error) {
      releaseBrowser(target);
      throw error;
    }
    if (browser.isConnected && !browser.isConnected()) {
      // The browser crashed or was closed externally: replace it, once, for this job.
      retire(target);
      releaseBrowser(target);
      if (retried) throw new HeadlessRenderError('launch', 'The headless browser disconnected.');
      return renderOnce(job, signal, true);
    }
    let context: HeadlessContext | undefined;
    try {
      const contextPromise = browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: job.scale ?? 1,
        javaScriptEnabled: false,
        offline: true,
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      // A context that arrives after a timeout must still be closed.
      contextPromise.then((late) => (signal.aborted ? late.close() : undefined)).catch(() => {});
      context = await raceAbort(contextPromise, signal);
      // Total network blocking: data URLs are not routed, every other request is aborted.
      await raceAbort(
        context.route('**/*', (route) => route.abort('blockedbyclient')),
        signal,
      );
      const page = await raceAbort(context.newPage(), signal);
      if (job.format === 'png') await raceAbort(page.emulateMedia({ media: 'print' }), signal);
      await raceAbort(page.setContent(job.html, { waitUntil: 'load', timeout: pageTimeoutMs }), signal);
      const output =
        job.format === 'pdf'
          ? await raceAbort(
              page.pdf({
                ...(typeof job.page === 'string'
                  ? { format: job.page }
                  : { width: `${width}px`, height: `${height}px` }),
                printBackground: true,
                preferCSSPageSize: true,
                margin: { top: '0', right: '0', bottom: '0', left: '0' },
              }),
              signal,
            )
          : await raceAbort(page.screenshot({ type: 'png', fullPage: true, timeout: pageTimeoutMs }), signal);
      return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
    } finally {
      // Closing the context also cancels pending page work after a timeout or abort.
      if (context) await context.close().catch(() => {});
      releaseBrowser(target);
    }
  }

  async function render(job: RenderJob): Promise<Uint8Array> {
    if (closed) throw new HeadlessRenderError('closed', 'The headless renderer is closed.');
    if (job.format !== 'pdf' && job.format !== 'png')
      throw new TypeError(`Unsupported headless format "${String(job.format)}".`);
    pageDimensions(job.page);
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(abortError(job.signal!));
    if (job.signal?.aborted) throw abortError(job.signal);
    job.signal?.addEventListener('abort', onCallerAbort, { once: true });
    try {
      await acquireSlot(controller.signal);
      // The page timeout starts once a slot is granted, so queueing does not eat the render budget.
      const timer = setTimeout(
        () =>
          controller.abort(
            new HeadlessRenderError('timeout', `Headless render timed out after ${pageTimeoutMs} ms.`),
          ),
        pageTimeoutMs,
      );
      try {
        return await renderOnce(job, controller.signal);
      } finally {
        clearTimeout(timer);
        releaseSlot();
      }
    } finally {
      job.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    render(job) {
      const promise = render(job);
      running.add(promise);
      const forget = () => running.delete(promise);
      promise.then(forget, forget);
      return promise;
    },
    async close() {
      closed = true;
      for (const entry of waiting.splice(0))
        entry.reject(new HeadlessRenderError('closed', 'The headless renderer is closed.'));
      await Promise.allSettled([...running]);
      if (slot) {
        const last = slot;
        slot = undefined;
        last.retired = true;
        await last.browser.then((browser) => browser.close()).catch(() => {});
      }
    },
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
  };
}

function abortError(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  if (reason instanceof HeadlessRenderError) return reason;
  return new HeadlessRenderError('aborted', 'Headless render was aborted.', { cause: reason });
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
