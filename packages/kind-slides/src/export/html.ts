import {
  ArtifactError,
  type ArtifactExporter,
  type ExportContext,
  themeCssText,
  toDataUrl,
} from '@artkit-ai/core';
import { slideTitle } from '../compose.js';
import { tr } from '../i18n.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import { slidesBaseCss } from '../react/slide-css.js';
import type { SlidesContent } from '../schema.js';

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Every `asset://` reference in the deck (backgrounds, images, card images). */
export function deckAssetRefs(content: SlidesContent): string[] {
  const refs = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.startsWith('asset://')) refs.add(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(content.slides);
  return [...refs];
}

async function resolveAssetUrls(content: SlidesContent, ctx: ExportContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ref of deckAssetRefs(content)) {
    ctx.signal?.throwIfAborted();
    try {
      const asset = await ctx.assets.resolve(ref);
      out.set(ref, toDataUrl(asset.bytes, asset.mimeType));
    } catch {
      ctx.warn(`Image ${ref} could not be loaded; it was left out.`);
    }
  }
  return out;
}

const PAGE_CSS = `
body { margin: 0; background: var(--ak-color-surface, #f4f7f7); color: var(--ak-color-text, #1d2f3c); font-family: var(--ak-font-body, "Sora"), system-ui, sans-serif; }
.ak-slides-export { max-width: 1100px; margin: 0 auto; padding: 32px 16px 48px; display: flex; flex-direction: column; gap: 28px; }
.ak-slides-export > header h1 { margin: 0; font-family: var(--ak-font-heading, "Sora"), system-ui, sans-serif; font-size: 28px; }
.ak-slides-export > header p { margin: 4px 0 0; color: var(--ak-color-muted, #56636d); font-size: 14px; }
.ak-slides-export-slide { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.ak-slides-export-slide .ak-slides-slide { border-radius: var(--ak-radius-md, 8px); box-shadow: 0 1px 3px rgba(29,47,60,0.12), 0 8px 24px rgba(29,47,60,0.08); overflow: hidden; }
.ak-slides-export-slide figcaption { display: flex; gap: 8px; align-items: baseline; color: var(--ak-color-muted, #56636d); font-size: 13px; }
.ak-slides-export-slide figcaption strong { color: var(--ak-color-text, #1d2f3c); }
.ak-slides-export-notes { font-size: 14px; }
.ak-slides-export-notes summary { cursor: pointer; color: var(--ak-color-muted, #56636d); }
.ak-slides-export-notes p { margin: 8px 0 0; white-space: pre-wrap; }
@media print {
  body { background: none; }
  .ak-slides-export { max-width: none; padding: 0; gap: 0; }
  .ak-slides-export > header, .ak-slides-export-slide figcaption, .ak-slides-export-notes { display: none; }
  .ak-slides-export-slide { break-after: page; page-break-after: always; }
  .ak-slides-export-slide:last-child { break-after: auto; page-break-after: auto; }
  .ak-slides-export-slide .ak-slides-slide { border-radius: 0; box-shadow: none; }
}
`;

/**
 * Static, self-contained HTML deck: every slide drawn by the same React view as the app (server-rendered,
 * no script), theme as CSS variables, images as data URLs and speaker notes in collapsible sections.
 * Prints one slide per landscape page. Needs `react` and `react-dom` (optional peers of this package).
 */
export async function exportSlidesToHtml(
  content: SlidesContent,
  ctx: ExportContext,
  layouts: LayoutRegistry = builtInLayouts,
): Promise<Uint8Array> {
  let modules: [
    typeof import('react'),
    typeof import('react-dom/server'),
    typeof import('../react/SlideView.js'),
  ];
  try {
    modules = await Promise.all([
      import('react'),
      import('react-dom/server'),
      import('../react/SlideView.js'),
    ]);
  } catch (error) {
    throw new ArtifactError('EXPORT_FAILED', 'The slides HTML export needs react and react-dom installed.', {
      cause: error,
    });
  }
  const [{ createElement }, { renderToStaticMarkup }, { SlideView }] = modules;
  const urls = await resolveAssetUrls(content, ctx);
  const renderCtx = {
    theme: ctx.theme,
    locale: ctx.locale,
    mode: 'print' as const,
    resolveAssetUrl: (ref: string) => urls.get(ref),
  };
  const includeHidden = ctx.options?.hidden === true;
  const hiddenCount = content.slides.filter((slide) => slide.hidden).length;
  if (hiddenCount > 0 && !includeHidden)
    ctx.warn(`${hiddenCount} hidden slide(s) were left out; pass options.hidden = true to include them.`);
  const notesLabel = tr(ctx.locale, 'Speaker notes', 'Notas do apresentador');
  const sections = content.slides
    .map((slide, index) => {
      if (slide.hidden && !includeHidden) return '';
      const view = renderToStaticMarkup(
        createElement(SlideView, {
          slide,
          ctx: renderCtx,
          layouts,
          ...(content.footer ? { footer: content.footer } : {}),
          slideNumber: index + 1,
        }),
      );
      const title = slideTitle(slide, layouts).trim();
      const notes = slide.notes
        ? `<details class="ak-slides-export-notes"><summary>${escapeHtml(notesLabel)}</summary><p>${escapeHtml(slide.notes)}</p></details>`
        : '';
      return `<figure class="ak-slides-export-slide" id="${escapeHtml(slide.id)}" aria-label="${escapeHtml(`Slide ${index + 1}`)}">${view}<figcaption><strong>${index + 1}</strong>${title ? `<span>${escapeHtml(title)}</span>` : ''}</figcaption>${notes}</figure>`;
    })
    .filter(Boolean)
    .join('\n');
  const css = [themeCssText(ctx.theme), slidesBaseCss, PAGE_CSS].join('\n').replace(/<\//g, '<\\/');
  const count = content.slides.filter((slide) => includeHidden || !slide.hidden).length;
  const html = `<!doctype html>
<html lang="${escapeHtml(ctx.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)}</title>
<style>${css}</style>
</head>
<body>
<main class="ak-slides ak-slides-export">
<header><h1>${escapeHtml(ctx.title)}</h1><p>${count} slides</p></header>
${sections}
</main>
</body>
</html>
`;
  return new TextEncoder().encode(html);
}

export function createSlidesHtmlExporter(
  layouts: LayoutRegistry = builtInLayouts,
): ArtifactExporter<SlidesContent> {
  return {
    kind: 'slides',
    format: 'html',
    mimeType: 'text/html; charset=utf-8',
    extension: 'html',
    runtime: 'any',
    export: (content, ctx) => exportSlidesToHtml(content, ctx, layouts),
  };
}
