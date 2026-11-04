import type { DiagramContent } from './schema.js';
import { isPt } from './text.js';

/**
 * Plain-language description for screen readers (`<desc>` in the SVG, `aria-describedby` in the renderer):
 * counts, groups with their nodes, then every connection.
 */
export function describeDiagram(content: DiagramContent, locale: string): string {
  const pt = isPt(locale);
  const label = new Map(content.nodes.map((node) => [node.id, node.label]));
  const flow =
    content.direction === 'TB'
      ? pt
        ? 'de cima para baixo'
        : 'top to bottom'
      : pt
        ? 'da esquerda para a direita'
        : 'left to right';
  const parts: string[] = [
    pt
      ? `Diagrama (${flow}) com ${content.nodes.length} ${content.nodes.length === 1 ? 'nó' : 'nós'} e ${content.edges.length} ${content.edges.length === 1 ? 'conexão' : 'conexões'}.`
      : `Diagram (${flow}) with ${content.nodes.length} ${content.nodes.length === 1 ? 'node' : 'nodes'} and ${content.edges.length} ${content.edges.length === 1 ? 'connection' : 'connections'}.`,
  ];
  const groupIds = new Set(content.groups.map((group) => group.id));
  for (const group of content.groups) {
    const members = content.nodes.filter((node) => node.group === group.id).map((node) => node.label);
    parts.push(
      `${pt ? 'Grupo' : 'Group'} ${group.label}: ${members.length > 0 ? members.join(', ') : pt ? 'vazio' : 'empty'}.`,
    );
  }
  const loose = content.nodes
    .filter((node) => node.group === undefined || !groupIds.has(node.group))
    .map((node) => node.label);
  if (loose.length > 0)
    parts.push(
      `${content.groups.length > 0 ? (pt ? 'Outros nós' : 'Other nodes') : pt ? 'Nós' : 'Nodes'}: ${loose.join(', ')}.`,
    );
  if (content.edges.length > 0) {
    const connections = content.edges.map((edge) => {
      const from = label.get(edge.from) ?? edge.from;
      const to = label.get(edge.to) ?? edge.to;
      const joiner =
        edge.arrow === 'both'
          ? pt
            ? ' e '
            : ' and '
          : edge.arrow === 'none'
            ? pt
              ? ' ligado a '
              : ' linked to '
            : pt
              ? ' para '
              : ' to ';
      const both = edge.arrow === 'both' ? (pt ? ' (nos dois sentidos)' : ' (both ways)') : '';
      return `${from}${joiner}${to}${both}${edge.label ? ` (${edge.label})` : ''}`;
    });
    parts.push(`${pt ? 'Conexões' : 'Connections'}: ${connections.join('; ')}.`);
  }
  return parts.join(' ');
}
