import type { ArtifactExporter } from '@artkit/core';
import { describeDiagram } from '../describe.js';
import type { DiagramContent, DiagramEdge, DiagramNode, NodeShape } from '../schema.js';

/*
 * Content → Mermaid flowchart (the subset `parseMermaid` reads back): groups become subgraphs, shapes map to
 * Mermaid brackets and edges keep label, style and arrows. Tones, icons and pinned positions have no Mermaid
 * form and are left out.
 */

const RESERVED = new Set(['end', 'subgraph', 'graph', 'flowchart', 'style', 'class', 'classDef', 'click']);

/** Labels are always quoted; quotes and pipes become Mermaid entity codes. */
function text(label: string): string {
  return label.replace(/"/g, '#quot;').replace(/\|/g, '#124;');
}

const BRACKETS: Record<NodeShape, [string, string]> = {
  box: ['[', ']'],
  round: ['(', ')'],
  diamond: ['{', '}'],
  ellipse: ['((', '))'],
  cylinder: ['[(', ')]'],
  document: ['[', ']'],
  actor: ['[', ']'],
};

function link(edge: DiagramEdge): string {
  const dashed = edge.style === 'dashed';
  const body = dashed ? '-.-' : '---';
  if (edge.arrow === 'none') return body;
  const end = dashed ? '-.->' : '-->';
  return edge.arrow === 'both' ? `<${end}` : end;
}

export interface MermaidExportResult {
  source: string;
  /** What the Mermaid form could not keep (shapes approximated, tones, icons, positions). */
  notes: string[];
}

export function contentToMermaid(content: DiagramContent): MermaidExportResult {
  const notes = new Set<string>();
  const ids = new Map<string, string>();
  const used = new Set([...content.nodes.map((node) => node.id), ...content.groups.map((group) => group.id)]);
  const safe = (id: string) => {
    let value = ids.get(id);
    if (value) return value;
    value = id;
    if (RESERVED.has(id)) {
      let n = 1;
      while (used.has(`${id}_${n}`)) n++;
      value = `${id}_${n}`;
      used.add(value);
    }
    ids.set(id, value);
    return value;
  };
  const nodeLine = (node: DiagramNode, indent: string) => {
    const [open, close] = BRACKETS[node.shape];
    if (node.shape === 'document' || node.shape === 'actor')
      notes.add(`Shape "${node.shape}" has no Mermaid flowchart form; written as a box.`);
    if (node.tone) notes.add('Node tones are not kept.');
    if (node.icon) notes.add('Node icons are not kept.');
    if (node.position) notes.add('Pinned positions are not kept.');
    return `${indent}${safe(node.id)}${open}"${text(node.label)}"${close}`;
  };
  const lines = [`flowchart ${content.direction}`];
  const grouped = new Set<string>();
  for (const group of content.groups) {
    const members = content.nodes.filter((node) => node.group === group.id);
    lines.push(`  subgraph ${safe(group.id)}["${text(group.label)}"]`);
    for (const node of members) {
      lines.push(nodeLine(node, '    '));
      grouped.add(node.id);
    }
    lines.push('  end');
  }
  for (const node of content.nodes) if (!grouped.has(node.id)) lines.push(nodeLine(node, '  '));
  for (const edge of content.edges) {
    const label = edge.label ? `|"${text(edge.label)}"|` : '';
    lines.push(`  ${safe(edge.from)} ${link(edge)}${label} ${safe(edge.to)}`);
  }
  return { source: `${lines.join('\n')}\n`, notes: [...notes] };
}

/** Markdown with the diagram as a ```mermaid fence (GitHub, GitLab, Notion and others render it). */
export const diagramMarkdownExporter: ArtifactExporter<DiagramContent> = {
  kind: 'diagram',
  format: 'md',
  mimeType: 'text/markdown; charset=utf-8',
  extension: 'md',
  runtime: 'any',
  async export(content, ctx) {
    ctx.signal?.throwIfAborted();
    const { source, notes } = contentToMermaid(content);
    for (const note of notes) ctx.warn(note);
    const markdown = `# ${ctx.title}\n\n${describeDiagram(content, ctx.locale)}\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
    return new TextEncoder().encode(markdown);
  },
};
