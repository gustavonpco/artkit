import type { ArtifactExporter } from '@artkit-ai/core';
import type { DiagramContent } from '../schema.js';
import { diagramHtmlExporter } from './html.js';
import { diagramMarkdownExporter } from './mermaid.js';
import { diagramSvgExporter } from './svg.js';

export { diagramHtmlExporter, renderDiagramHtml } from './html.js';
export { contentToMermaid, diagramMarkdownExporter, type MermaidExportResult } from './mermaid.js';
export { type DiagramSvgOptions, diagramSvgExporter, escapeXml, renderDiagramSvg } from './svg.js';

/** Exporters of the diagram kind. PNG and PDF come from headless rendering in `@artkit-ai/node`. */
export const diagramExporters: ArtifactExporter<DiagramContent>[] = [
  diagramSvgExporter,
  diagramHtmlExporter,
  diagramMarkdownExporter,
];
