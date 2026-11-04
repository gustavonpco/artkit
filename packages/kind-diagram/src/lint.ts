import type { LintContext, LintIssue } from '@artkit/core';
import type { DiagramContent } from './schema.js';
import {
  COMFORTABLE_LABEL_LENGTH,
  MAX_TEXT_WIDTH,
  NODE_FONT_SIZE,
  nodeLabelLines,
  textWidth,
} from './size.js';
import { msg } from './text.js';

/** Non-blocking checks (spec §10.2): isolated nodes, duplicate edges, labels too long for the shape, empty groups. */
export function lintDiagram(content: DiagramContent, ctx: Pick<LintContext, 'locale'>): LintIssue[] {
  const t = (en: string, pt: string) => msg(ctx.locale, en, pt);
  const issues: LintIssue[] = [];

  if (content.nodes.length > 1) {
    const connected = new Set<string>();
    for (const edge of content.edges) {
      connected.add(edge.from);
      connected.add(edge.to);
    }
    for (const node of content.nodes) {
      if (connected.has(node.id)) continue;
      issues.push({
        code: 'isolated-node',
        severity: 'warning',
        target: `node:${node.id}`,
        message: t(`Node "${node.label}" has no connections.`, `O nó "${node.label}" não tem conexões.`),
        hint: t('Connect it with add_edge or remove it.', 'Conecte-o com add_edge ou remova-o.'),
      });
    }
  }

  const seen = new Map<string, string>();
  for (const edge of content.edges) {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ''}`;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate-edge',
        severity: 'warning',
        target: `edge:${edge.id}`,
        message: t(
          `Edge "${edge.id}" repeats "${first}" (${edge.from} -> ${edge.to}).`,
          `A aresta "${edge.id}" repete "${first}" (${edge.from} -> ${edge.to}).`,
        ),
        hint: t(`Remove it with remove_edge "${edge.id}".`, `Remova-a com remove_edge "${edge.id}".`),
      });
    } else seen.set(key, edge.id);
  }

  for (const node of content.nodes) {
    const limit = COMFORTABLE_LABEL_LENGTH[node.shape];
    const longWord = node.label
      .split(/\s+/)
      .some((word) => textWidth(word, NODE_FONT_SIZE) > MAX_TEXT_WIDTH[node.shape]);
    const lines = nodeLabelLines(node).length;
    if (node.label.length > limit || longWord || lines > 3) {
      issues.push({
        code: 'label-too-long',
        severity: 'warning',
        target: `node:${node.id}`,
        message: t(
          `The label of "${node.id}" (${node.label.length} characters) is too long for a ${node.shape}.`,
          `O rótulo de "${node.id}" (${node.label.length} caracteres) é longo demais para a forma ${node.shape}.`,
        ),
        hint: longWord
          ? t(
              'Break very long words or shorten the label.',
              'Quebre palavras muito longas ou encurte o rótulo.',
            )
          : t(
              `Keep ${node.shape} labels under ${limit} characters, or use shape "box".`,
              `Mantenha rótulos de ${node.shape} abaixo de ${limit} caracteres, ou use a forma "box".`,
            ),
      });
    }
  }

  const used = new Set(content.nodes.map((node) => node.group).filter((group) => group !== undefined));
  for (const group of content.groups) {
    if (used.has(group.id)) continue;
    issues.push({
      code: 'empty-group',
      severity: 'warning',
      target: `group:${group.id}`,
      message: t(`Group "${group.label}" has no nodes.`, `O grupo "${group.label}" não tem nós.`),
      hint: t(
        `Move nodes into it (update_node with group "${group.id}") or remove it.`,
        `Mova nós para ele (update_node com group "${group.id}") ou remova-o.`,
      ),
    });
  }

  if (content.layout !== 'manual' && content.nodes.some((node) => node.position !== undefined)) {
    issues.push({
      code: 'pins-ignored',
      severity: 'info',
      target: 'diagram:layout',
      message: t(
        `Pinned positions are ignored with layout "${content.layout}".`,
        `Posições fixadas são ignoradas com o layout "${content.layout}".`,
      ),
      hint: t(
        'Use set_layout "manual" to honor them, or unpin_node.',
        'Use set_layout "manual" para respeitá-las, ou unpin_node.',
      ),
    });
  }
  return issues;
}
