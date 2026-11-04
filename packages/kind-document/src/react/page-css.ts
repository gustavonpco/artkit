import { type PageSetup, pageGeometry } from '../schema.js';

/** Escapes text for a CSS string literal; `<` is escaped so the rule can live inside a `<style>` element. */
export function cssString(text: string): string {
  return `"${text.replace(/[\\"<>\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()} `)}"`;
}

/** CSS custom properties with the page geometry, for the `.ak-document` container. */
export function pageVariables(page: PageSetup | undefined): Record<string, string> {
  const { width, margins } = pageGeometry(page);
  return {
    '--ak-doc-page-width': `${width}mm`,
    '--ak-doc-margin-top': `${margins.top}mm`,
    '--ak-doc-margin-right': `${margins.right}mm`,
    '--ak-doc-margin-bottom': `${margins.bottom}mm`,
    '--ak-doc-margin-left': `${margins.left}mm`,
  };
}

/**
 * `@page` rule for print: size, margins and running header/footer with page numbers in the page margin
 * boxes (supported by Chromium, which headless PDF export uses).
 */
export function pageRuleCss(page: PageSetup | undefined): string {
  const { width, height, margins } = pageGeometry(page);
  const boxes: string[] = [];
  const muted = 'font-size: 9pt; color: var(--ak-color-muted, #5b6b78);';
  if (page?.header) boxes.push(`@top-center { content: ${cssString(page.header)}; ${muted} }`);
  if (page?.footer) boxes.push(`@bottom-left { content: ${cssString(page.footer)}; ${muted} }`);
  if (page?.pageNumbers)
    boxes.push(`@bottom-right { content: counter(page) " / " counter(pages); ${muted} }`);
  return `@page { size: ${width}mm ${height}mm; margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm; ${boxes.join(' ')} }`;
}
