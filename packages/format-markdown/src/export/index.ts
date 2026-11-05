import { type ArtifactExporter, type ExportContext, themeCssText } from '@artkit-ai/core';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { stripRawHtml } from '../dialect.js';

const encoder = new TextEncoder();

/** `md` export: the stored Markdown itself, with raw HTML removed as on validation. */
export const markdownMdExporter: ArtifactExporter<string> = {
  format: 'markdown',
  target: 'md',
  mimeType: 'text/markdown; charset=utf-8',
  extension: 'md',
  runtime: 'any',
  async export(content: string): Promise<Uint8Array> {
    return encoder.encode(stripRawHtml(content).text);
  },
};

/**
 * `html` export: a self-contained page. micromark escapes raw HTML (`allowDangerousHtml` stays off), so the output
 * never carries scripts from the document.
 */
export const markdownHtmlExporter: ArtifactExporter<string> = {
  format: 'markdown',
  target: 'html',
  mimeType: 'text/html; charset=utf-8',
  extension: 'html',
  runtime: 'any',
  async export(content: string, ctx: ExportContext): Promise<Uint8Array> {
    const body = micromark(stripRawHtml(content).text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
    const title = escapeHtml(ctx.title);
    const page = `<!doctype html>
<html lang="${escapeHtml(ctx.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${themeCssText(ctx.theme)}
body { background: var(--ak-color-surface, #fff); color: var(--ak-color-text, #111); font-family: var(--ak-font-body, system-ui, sans-serif); max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export const markdownExporters = [markdownMdExporter, markdownHtmlExporter];
