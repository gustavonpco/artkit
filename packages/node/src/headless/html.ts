import { type Theme, themeCssText } from '@artkit-ai/core';
import { soraFontFaceCss } from '@artkit-ai/core/fonts';

/** Page size: a paper name, or a fixed size in CSS pixels (e.g. 1280×720 for 16:9 slides). */
export type PageSize = 'A4' | 'Letter' | { width: number; height: number };

/** Paper sizes in CSS pixels at 96 dpi, used for the viewport. */
const PAPER: Record<'A4' | 'Letter', { width: number; height: number; css: string }> = {
  A4: { width: 794, height: 1123, css: 'A4' },
  Letter: { width: 816, height: 1056, css: 'letter' },
};

export function pageDimensions(page: PageSize): { width: number; height: number } {
  if (typeof page === 'string') {
    const paper = PAPER[page];
    if (!paper)
      throw new TypeError(`Unknown page size "${String(page)}"; use "A4", "Letter" or { width, height }.`);
    return { width: paper.width, height: paper.height };
  }
  const { width, height } = page;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 20_000 ||
    height > 20_000
  ) {
    throw new TypeError('Page width and height must be numbers of CSS pixels between 1 and 20000.');
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function pageCss(page: PageSize): string {
  if (typeof page === 'string') return PAPER[page].css;
  const { width, height } = pageDimensions(page);
  return `${width}px ${height}px`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/** Keeps CSS text inside its <style> element: a `</style` sequence would otherwise end it early. */
export function escapeStyleText(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/**
 * The page is static markup: no scripts, and every resource must be inline or a data URL. The CSP
 * enforces this even if a renderer emitted an external URL (the network is also blocked at the browser).
 */
export const PRINT_CSP =
  "default-src 'none'; img-src data:; font-src data:; media-src data:; style-src 'unsafe-inline'";

export interface PrintPageOptions {
  /** Server-rendered markup of the renderer (already escaped by React). */
  body: string;
  title: string;
  locale: string;
  theme: Theme;
  page: PageSize;
  /** CSS strings exported by the kind (`documentCss`…), appended after the theme variables. */
  css?: readonly string[];
}

/** Builds the self-contained HTML document rendered by the headless browser. */
export function buildPrintHtml(options: PrintPageOptions): string {
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(options.locale) ? options.locale : 'en';
  // The network is blocked during render, so the design-system font travels inside the page.
  const usesSora = [options.theme.fonts.heading, options.theme.fonts.body].some(
    (font) => font.trim().toLowerCase() === 'sora',
  );
  const base = [
    ...(usesSora ? [soraFontFaceCss()] : []),
    themeCssText(options.theme),
    `@page { size: ${pageCss(options.page)}; margin: 0; }`,
    'html, body { margin: 0; padding: 0; }',
    'body { background: var(--ak-color-background); color: var(--ak-color-text); font-family: var(--ak-font-body);',
    '  -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  ].join('\n');
  const styles = [base, ...(options.css ?? [])].map(escapeStyleText).join('\n');
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_CSP)}">`,
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>\n${styles}\n</style>`,
    '</head>',
    `<body class="ak-print">${options.body}</body>`,
    '</html>',
  ].join('\n');
}
