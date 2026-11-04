import type { ArtifactExporter } from '@artkit-ai/core';
import type { SlidesContent } from '../schema.js';
import { createSlidesExporters } from './pptx.js';

export { createSlidesHtmlExporter, deckAssetRefs, exportSlidesToHtml } from './html.js';
export { containRect, imageSize } from './image-size.js';
export { createSlidesMarkdownExporter, type SlidesMarkdownOptions, slidesToMarkdown } from './md.js';
export { createSlidesExporters, exportSlidesToPptx, type SlidesExporterOptions } from './pptx.js';

/** Exporters for the built-in layouts. Use `createSlidesExporters({ layouts: kind.layouts })` for custom ones. */
export const slidesExporters: ArtifactExporter<SlidesContent>[] = createSlidesExporters();
