import {
  type ArtifactExporter,
  defaultTheme,
  type ExportContext,
  resolveColor,
  type Theme,
} from '@artkit/core';
import { describeDiagram } from '../describe.js';
import { diagramPaint, nodePaint } from '../draw.js';
import { type DiagramLayout, type LayoutEngine, layoutDiagram } from '../layout/index.js';
import { buildDiagramScene, type PaintRole, type SceneElement } from '../scene.js';
import type { DiagramContent } from '../schema.js';

export interface DiagramSvgOptions {
  theme?: Theme;
  locale?: string;
  /** Accessible title (`<title>`). */
  title?: string;
  /** Precomputed layout (e.g. from an async engine); otherwise computed with `layoutDiagram`. */
  layout?: DiagramLayout;
  engine?: LayoutEngine;
}

export function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}

function fontStack(font: string): string {
  const name = /^[A-Za-z0-9-]+$/.test(font) ? font : `'${font.replace(/['"<>&]/g, '')}'`;
  return `${name}, system-ui, sans-serif`;
}

const ATTR_NAME = /^[a-z][a-z0-9-]*$/i;

function serialize(
  element: SceneElement,
  paint: (role: PaintRole, tone: string) => string,
  tone: string,
  markers: { start: string; end: string },
): string {
  const attrs: string[] = [];
  const nextTone = element.className.match(/ak-diagram-tone-([a-z]+)/)?.[1] ?? tone;
  if (element.className) attrs.push(`class="${escapeXml(element.className)}"`);
  if (element.fill) attrs.push(`fill="${paint(element.fill, nextTone)}"`);
  if (element.stroke) attrs.push(`stroke="${paint(element.stroke, nextTone)}"`);
  if (element.markers?.end) attrs.push(`marker-end="url(#${markers.end})"`);
  if (element.markers?.start) attrs.push(`marker-start="url(#${markers.start})"`);
  for (const [name, value] of Object.entries(element.attrs)) {
    // Scene attributes are generated internally; the guard keeps any future mistake from emitting handlers.
    if (!ATTR_NAME.test(name) || name.startsWith('on')) continue;
    attrs.push(`${name}="${escapeXml(String(value))}"`);
  }
  const open = `<${element.tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}`;
  const inner = `${element.text !== undefined ? escapeXml(element.text) : ''}${(element.children ?? []).map((child) => serialize(child, paint, nextTone, markers)).join('')}`;
  return inner ? `${open}>${inner}</${element.tag}>` : `${open}/>`;
}

/**
 * Standalone static SVG: no scripts, no event handlers, no external references; colors are resolved to hex
 * from the theme and fonts are referenced by name only.
 */
export function renderDiagramSvg(content: DiagramContent, options: DiagramSvgOptions = {}): string {
  const theme = options.theme ?? defaultTheme;
  const locale = options.locale ?? 'en';
  const layout = options.layout ?? layoutDiagram(content, options.engine ? { engine: options.engine } : {});
  const scene = buildDiagramScene(content, layout);
  const colors = diagramPaint(theme);
  const paint = (role: PaintRole, tone: string): string => {
    const node = nodePaint(theme, tone === 'neutral' ? undefined : (tone as Parameters<typeof nodePaint>[1]));
    switch (role) {
      case 'none':
        return 'none';
      case 'nodeFill':
        return node.fill;
      case 'nodeStroke':
        return node.stroke;
      case 'nodeText':
        return node.text;
      case 'labelBg':
        return colors.background;
      default:
        return colors[role];
    }
  };
  const markers = { start: 'ak-diagram-arrow-start', end: 'ak-diagram-arrow-end' };
  const { x, y, width, height } = layout.bounds;
  const title = options.title ?? (locale.toLowerCase().startsWith('pt') ? 'Diagrama' : 'Diagram');
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" role="img" aria-labelledby="ak-diagram-title ak-diagram-desc" font-family="${escapeXml(fontStack(theme.fonts.body))}">`,
    `<title id="ak-diagram-title">${escapeXml(title)}</title>`,
    `<desc id="ak-diagram-desc">${escapeXml(describeDiagram(content, locale))}</desc>`,
    '<defs>',
    `<marker id="${markers.end}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="${colors.edge}"/></marker>`,
    `<marker id="${markers.start}" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M10 0L0 5L10 10z" fill="${colors.edge}"/></marker>`,
    '</defs>',
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${resolveColor(theme, 'background')}"/>`,
    `<g class="ak-diagram-groups">${scene.groups.map((element) => serialize(element, paint, 'neutral', markers)).join('')}</g>`,
    `<g class="ak-diagram-edges">${scene.edges.map((element) => serialize(element, paint, 'neutral', markers)).join('')}</g>`,
    `<g class="ak-diagram-group-labels">${scene.groupLabels.map((element) => serialize(element, paint, 'neutral', markers)).join('')}</g>`,
    `<g class="ak-diagram-nodes">${scene.nodes.map((element) => serialize(element, paint, 'neutral', markers)).join('')}</g>`,
    '</svg>',
  ];
  return parts.join('\n');
}

export const diagramSvgExporter: ArtifactExporter<DiagramContent> = {
  kind: 'diagram',
  format: 'svg',
  mimeType: 'image/svg+xml',
  extension: 'svg',
  runtime: 'any',
  async export(content: DiagramContent, ctx: ExportContext): Promise<Uint8Array> {
    ctx.signal?.throwIfAborted();
    const svg = renderDiagramSvg(content, { theme: ctx.theme, locale: ctx.locale, title: ctx.title });
    return new TextEncoder().encode(svg);
  },
};
