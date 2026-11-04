import type { ArtifactExporter } from '@artkit/core';
import type { DocumentContent } from '../schema.js';
import { documentDocxExporter } from './docx.js';
import { documentHtmlExporter } from './html.js';
import { documentMarkdownExporter } from './md.js';

export { buildDocx, documentDocxExporter } from './docx.js';
export { blockHtml, documentBodyHtml, documentHtmlExporter, escapeHtml, runsHtml } from './html.js';
export { imageSize } from './image-size.js';
export { documentMarkdownExporter } from './md.js';

/** docx, md and html exporters (all run in Node and browsers). PDF comes from `@artkit/node/headless`. */
export const documentExporters: ArtifactExporter<DocumentContent>[] = [
  documentDocxExporter,
  documentMarkdownExporter,
  documentHtmlExporter,
];
