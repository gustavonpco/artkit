import type { LintIssue } from '@artkit-ai/core';
import { argsOf, callsOf, childrenOf, componentOf, parseStatements, references, tokenize } from './syntax.js';

const MAX_BULLETS = 6;
const MAX_TEXT_CHARS = 400;

function stringArgs(expr: string): string[] {
  return tokenize(expr)
    .filter((token) => token.kind === 'string')
    .map((token) => token.text.slice(1, -1));
}

/** Lint (spec §12.6): slides without title, long bullet lists, long text, images without alt, unused declarations. */
export function lintOpenUI(content: string): LintIssue[] {
  const { statements } = parseStatements(content);
  const byName = new Map(statements.map((statement) => [statement.name, statement]));
  const referenced = new Set(statements.flatMap((statement) => references(statement.expr)));
  const issues: LintIssue[] = [];
  for (const statement of statements) {
    const target = `node:${statement.name}`;
    if (statement.name !== 'root' && !referenced.has(statement.name)) {
      issues.push({
        code: 'unused-declaration',
        severity: 'info',
        target,
        message: `"${statement.name}" não é usada por nenhuma outra declaração.`,
        hint: 'Remova a declaração ou inclua-a na lista de filhos.',
      });
    }
    for (const call of callsOf(statement.expr)) {
      const args = argsOf(call.inner);
      if (call.component === 'Slide') {
        const children = childrenOf(`X(${call.inner})`);
        const hasTitle = children.some(
          (child) => componentOf(child) === 'Title' || componentOf(byName.get(child)?.expr ?? '') === 'Title',
        );
        if (!hasTitle) {
          issues.push({
            code: 'slide-no-title',
            severity: 'warning',
            target,
            message: `O slide "${statement.name}" não tem título.`,
            hint: 'Inclua um Title como primeiro filho.',
          });
        }
      }
      if (call.component === 'Bullets') {
        const count = stringArgs(args.join(', ')).length;
        if (count > MAX_BULLETS) {
          issues.push({
            code: 'bullets-overflow',
            severity: 'warning',
            target,
            message: `"${statement.name}" tem ${count} marcadores; o limite é ${MAX_BULLETS}.`,
            hint: 'Divida em dois slides ou dois blocos.',
          });
        }
      }
      if (call.component === 'Text' || call.component === 'Title' || call.component === 'Subtitle') {
        const longest = Math.max(0, ...stringArgs(call.inner).map((text) => text.length));
        if (longest > MAX_TEXT_CHARS) {
          issues.push({
            code: 'text-overflow',
            severity: 'warning',
            target,
            message: `"${statement.name}" tem ${longest} caracteres; o provável limite é ${MAX_TEXT_CHARS}.`,
            hint: 'Encurte o texto ou use Bullets.',
          });
        }
      }
      if (call.component === 'Image') {
        const hasAlt = stringArgs(call.inner).length >= 2;
        if (!hasAlt) {
          issues.push({
            code: 'image-alt',
            severity: 'warning',
            target,
            message: `A imagem "${statement.name}" não tem texto alternativo.`,
            hint: 'Escreva Image("asset://id", "descrição").',
          });
        }
      }
    }
  }
  return issues;
}
