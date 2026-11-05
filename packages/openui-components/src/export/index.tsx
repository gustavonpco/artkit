import { type ArtifactExporter, type ExportContext, themeCssText } from '@artkit-ai/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentsCss } from '../react/css.js';
import { OpenUIRenderer } from '../react/index.js';

const encoder = new TextEncoder();

/** `html` export of a visual: the rendered components with the theme and the artkit component styles, no scripts. */
export const openuiHtmlExporter: ArtifactExporter<string> = {
  format: 'openui',
  target: 'html',
  mimeType: 'text/html; charset=utf-8',
  extension: 'html',
  runtime: 'any',
  async export(content: string, ctx: ExportContext): Promise<Uint8Array> {
    const body = renderToStaticMarkup(
      <OpenUIRenderer content={content} ctx={{ theme: ctx.theme, locale: ctx.locale, mode: 'print' }} />,
    );
    const title = ctx.title.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
    const page = `<!doctype html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${themeCssText(ctx.theme)}
body { margin: 0; background: var(--ak-color-surface-muted, #f5f5f5); padding: 1.5rem; }
${componentsCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
    return encoder.encode(page);
  },
};

/**
 * Headless source for PDF and PNG (`createHeadlessExporters` in `@artkit-ai/node/headless`): decks use a 16:9 page,
 * the other visuals A4 by default; the renderer is the same one the application shows.
 */
export const openuiHeadlessSource = {
  format: 'openui',
  render: (
    content: string,
    ctx: { mode: 'screen' | 'print'; theme: ExportContext['theme']; locale: string },
  ) => <OpenUIRenderer content={content} ctx={ctx} />,
  css: componentsCss,
  targets: ['pdf', 'png'] as const,
  page: { width: 1280, height: 720 },
};

export const openuiExporters = [openuiHtmlExporter];
