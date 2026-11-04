import { type ArtifactExporter, themeCssText } from '@artkit-ai/core';
import { describeDiagram } from '../describe.js';
import type { DiagramContent } from '../schema.js';
import { escapeXml, renderDiagramSvg } from './svg.js';

/**
 * Static, self-contained HTML page: the diagram as inline SVG (colors resolved from the theme, no script),
 * its text description and a list of nodes and connections for readers that cannot see the drawing.
 */
export function renderDiagramHtml(
  content: DiagramContent,
  options: { title: string; locale: string; theme: Parameters<typeof themeCssText>[0] },
): string {
  const pt = options.locale.toLowerCase().startsWith('pt');
  const svg = renderDiagramSvg(content, {
    theme: options.theme,
    locale: options.locale,
    title: options.title,
  }).replace(/^<\?xml[^>]*>\s*/, '');
  const labels = new Map(content.nodes.map((node) => [node.id, node.label]));
  const groups = new Map(content.groups.map((group) => [group.id, group.label]));
  const nodes = content.nodes
    .map(
      (node) =>
        `<li>${escapeXml(node.label)}${node.group ? ` <span>(${escapeXml(groups.get(node.group) ?? node.group)})</span>` : ''}</li>`,
    )
    .join('');
  const arrow = { end: '→', both: '↔', none: '—' } as const;
  const edges = content.edges
    .map(
      (edge) =>
        `<li>${escapeXml(labels.get(edge.from) ?? edge.from)} ${arrow[edge.arrow]} ${escapeXml(labels.get(edge.to) ?? edge.to)}${edge.label ? ` <span>“${escapeXml(edge.label)}”</span>` : ''}</li>`,
    )
    .join('');
  const css = `${themeCssText(options.theme)}
body { margin: 0; background: var(--ak-color-surface); color: var(--ak-color-text); font-family: var(--ak-font-body, "Sora"), system-ui, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 16px 48px; display: flex; flex-direction: column; gap: 20px; }
h1 { margin: 0; font-family: var(--ak-font-heading, "Sora"), system-ui, sans-serif; font-size: 26px; }
figure { margin: 0; padding: 16px; background: var(--ak-color-background); border: 1px solid var(--ak-color-border); border-radius: var(--ak-radius-md, 8px); overflow: auto; }
figure svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
figcaption { margin-top: 12px; color: var(--ak-color-muted); font-size: 14px; }
details { background: var(--ak-color-background); border: 1px solid var(--ak-color-border); border-radius: var(--ak-radius-md, 8px); padding: 12px 16px; }
summary { cursor: pointer; font-weight: 600; }
.lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 12px; }
h2 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--ak-color-muted); }
ul { margin: 0; padding-left: 18px; } li { margin: 2px 0; } li span { color: var(--ak-color-muted); }
@media print { body { background: none; } figure, details { border: 0; } details { display: none; } }`.replace(
    /<\//g,
    '<\\/',
  );
  return `<!doctype html>
<html lang="${escapeXml(options.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(options.title)}</title>
<style>${css}</style>
</head>
<body>
<main>
<h1>${escapeXml(options.title)}</h1>
<figure>${svg}<figcaption>${escapeXml(describeDiagram(content, options.locale))}</figcaption></figure>
<details><summary>${pt ? 'Elementos do diagrama' : 'Diagram elements'}</summary><div class="lists"><section><h2>${pt ? 'Nós' : 'Nodes'}</h2><ul>${nodes}</ul></section><section><h2>${pt ? 'Conexões' : 'Connections'}</h2><ul>${edges}</ul></section></div></details>
</main>
</body>
</html>
`;
}

export const diagramHtmlExporter: ArtifactExporter<DiagramContent> = {
  kind: 'diagram',
  format: 'html',
  mimeType: 'text/html; charset=utf-8',
  extension: 'html',
  runtime: 'any',
  async export(content, ctx) {
    ctx.signal?.throwIfAborted();
    return new TextEncoder().encode(
      renderDiagramHtml(content, { title: ctx.title, locale: ctx.locale, theme: ctx.theme }),
    );
  },
};
