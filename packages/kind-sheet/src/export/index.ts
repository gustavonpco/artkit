import type { ArtifactExporter } from '@artkit/core';
import type { SheetContent } from '../schema.js';
import { sheetCsvExporter } from './csv.js';
import { sheetHtmlExporter } from './html.js';
import { sheetMarkdownExporter } from './md.js';
import { sheetXlsxExporter } from './xlsx.js';
import { sheetZipExporter } from './zip.js';

export { csvValue, pickSheet, sheetCsvExporter, sheetToCsv } from './csv.js';
export { escapeHtml, sheetHtmlExporter, sheetToHtml } from './html.js';
export { sheetMarkdownExporter, sheetToMarkdown } from './md.js';
export { buildWorkbook, sheetXlsxExporter } from './xlsx.js';
export { sheetZipExporter } from './zip.js';

/** xlsx, csv, zip (all sheets as CSV), md and html exporters for the sheet kind (PDF/PNG come from headless rendering in @artkit/node). */
export const sheetExporters: ArtifactExporter<SheetContent>[] = [
  sheetXlsxExporter,
  sheetCsvExporter,
  sheetZipExporter,
  sheetMarkdownExporter,
  sheetHtmlExporter,
];
