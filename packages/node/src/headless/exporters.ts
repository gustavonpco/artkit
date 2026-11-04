import type { ArtifactExporter, ExportContext, RenderContext } from '@artkit-ai/core';
import { toDataUrl } from '@artkit-ai/core';
import type { ReactElement } from 'react';
import { buildPrintHtml, type PageSize, pageDimensions } from './html.js';
import type { HeadlessRenderer } from './renderer.js';

export type HeadlessFormat = 'pdf' | 'png';

export interface HeadlessKind<Content = unknown> {
  kind: string;
  /** Renders the kind's `/react` renderer, e.g. `(content, ctx) => <DocumentRenderer content={content} ctx={ctx} />`. */
  render(content: Content, ctx: RenderContext): ReactElement;
  /** CSS exported by the kind (`documentCss`…); the theme variables are always included. */
  css?: string | readonly string[];
  formats: readonly HeadlessFormat[];
  /** Default `'A4'`. Use `{ width: 1280, height: 720 }` for 16:9 slides. */
  page?: PageSize;
  /** Device pixel ratio of PNG output (default 1). */
  scale?: number;
}

export interface HeadlessExportersOptions {
  renderer: HeadlessRenderer;
  // biome-ignore lint/suspicious/noExplicitAny: kinds with different content types share one list.
  kinds: readonly HeadlessKind<any>[];
  /** Maximum total bytes of assets inlined into one page (default 50 MiB); the rest get placeholders. */
  maxAssetBytes?: number;
  /** Markup renderer; defaults to `renderToStaticMarkup` from `react-dom/server` (optional peer). */
  renderToStaticMarkup?(element: ReactElement): string;
}

const MIME: Record<HeadlessFormat, string> = { pdf: 'application/pdf', png: 'image/png' };
const ASSET_REF_IN_TEXT = /asset:\/\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}/g;
const MAX_DEPTH = 64;

/** Collects every `asset://` reference in string values, whole or embedded (e.g. Markdown image syntax). */
export function collectAssetRefs(content: unknown): string[] {
  const refs = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      // Trailing dots usually end a sentence rather than an id.
      for (const match of value.matchAll(ASSET_REF_IN_TEXT)) refs.add(match[0].replace(/\.+$/, ''));
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(content, 0);
  return [...refs];
}

async function resolveAssets(
  content: unknown,
  ctx: ExportContext,
  maxBytes: number,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  let total = 0;
  for (const ref of collectAssetRefs(content)) {
    if (ctx.signal?.aborted) break;
    try {
      const asset = await ctx.assets.resolve(ref);
      if (total + asset.bytes.byteLength > maxBytes) {
        ctx.warn(`Asset ${ref} was not embedded: the page exceeds ${maxBytes} bytes of assets.`);
        continue;
      }
      total += asset.bytes.byteLength;
      urls.set(ref, toDataUrl(asset.bytes, asset.mimeType));
    } catch {
      ctx.warn(`Asset ${ref} could not be loaded; a placeholder was rendered.`);
    }
  }
  return urls;
}

let staticMarkup: Promise<(element: ReactElement) => string> | undefined;

function loadStaticMarkup(): Promise<(element: ReactElement) => string> {
  staticMarkup ??= import('react-dom/server')
    .then((mod) => {
      const fn = (mod as { renderToStaticMarkup?: (element: ReactElement) => string }).renderToStaticMarkup;
      if (!fn) throw new Error('react-dom/server does not export renderToStaticMarkup.');
      return fn;
    })
    .catch((cause) => {
      staticMarkup = undefined;
      throw new Error(
        'Headless export needs the optional peer dependencies "react" and "react-dom" (^19). Install them or pass `renderToStaticMarkup`.',
        { cause },
      );
    });
  return staticMarkup;
}

/**
 * Exporters for PNG and PDF (spec §12.3) that render the kind's own React renderer in headless
 * Chromium, so files match what users see. For each export: asset references in the content are
 * resolved through `ctx.assets` and inlined as data URLs (the browser has no network), the element is
 * rendered with `ctx.mode = 'print'`, wrapped with the theme variables and the kind CSS, and printed.
 *
 * PDF follows the CSS page size; PNG is one image of the whole page height (multi-page content is
 * stacked vertically in a single PNG). Unresolvable assets become placeholders and a warning.
 */
export function createHeadlessExporters(options: HeadlessExportersOptions): ArtifactExporter[] {
  const { renderer } = options;
  const maxAssetBytes = options.maxAssetBytes ?? 50 * 1024 * 1024;
  const markup = options.renderToStaticMarkup;
  const exporters: ArtifactExporter[] = [];
  for (const config of options.kinds) {
    const page = config.page ?? 'A4';
    pageDimensions(page);
    const css =
      config.css === undefined ? [] : typeof config.css === 'string' ? [config.css] : [...config.css];
    for (const format of new Set(config.formats)) {
      if (format !== 'pdf' && format !== 'png')
        throw new TypeError(`Unsupported headless format "${String(format)}" for kind ${config.kind}.`);
      exporters.push({
        kind: config.kind,
        format,
        mimeType: MIME[format],
        extension: format,
        runtime: 'node',
        async export(content, ctx) {
          const assets = await resolveAssets(content, ctx, maxAssetBytes);
          const renderCtx: RenderContext = {
            theme: ctx.theme,
            locale: ctx.locale,
            mode: 'print',
            resolveAssetUrl: (ref) => assets.get(ref),
          };
          const toMarkup = markup ?? (await loadStaticMarkup());
          const body = toMarkup(config.render(content, renderCtx));
          const html = buildPrintHtml({
            body,
            title: ctx.title,
            locale: ctx.locale,
            theme: ctx.theme,
            page,
            css,
          });
          return renderer.render({
            html,
            format,
            page,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
            ...(format === 'png' && config.scale ? { scale: config.scale } : {}),
          });
        },
      });
    }
  }
  return exporters;
}
