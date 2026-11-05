import { ellipsis, type ProjectionItem, paginate, type ReadRequest, type ReadResult } from '@artkit-ai/core';
import { childrenOf, componentOf, formatStatement, parseStatements, type Statement } from './syntax.js';

function labelOf(expr: string): string {
  const match = /"((?:[^"\\]|\\.)*)"/.exec(expr);
  return match ? ellipsis(match[1]!, 60) : '';
}

function outlineLine(statement: Statement): string {
  const component = componentOf(statement.expr) ?? '?';
  const children = childrenOf(statement.expr);
  const parts = [`- ${statement.name}: ${component}`];
  const label = labelOf(statement.expr);
  if (label) parts.push(`"${label}"`);
  if (children.length > 0) parts.push(`(${children.length} filhos: ${children.join(', ')})`);
  return parts.join(' ');
}

/** Compact reading (spec §12.4): `outline` from the root, `statements` by name, and `full`. */
export function readOpenUI(content: string, request: ReadRequest): ReadResult {
  const { statements } = parseStatements(content);
  const budget = {
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    ...(request.charsPerToken === undefined ? {} : { charsPerToken: request.charsPerToken }),
  };
  if (request.mode === 'outline') {
    const items: ProjectionItem[] = statements.map((statement) => {
      const line = outlineLine(statement);
      return { id: statement.name, text: line, outline: line };
    });
    const projection = paginate(items, {
      header: 'Declarações (raiz primeiro):',
      ...budget,
      outlineOnly: true,
    });
    return {
      text: projection.text,
      truncated: projection.truncated,
      ...(projection.cursor ? { cursor: projection.cursor } : {}),
    };
  }
  const wanted =
    request.mode === 'statements' && request.range
      ? new Set(request.range.split(',').map((part) => part.trim()))
      : undefined;
  const items: ProjectionItem[] = statements
    .filter((statement) => !wanted || wanted.has(statement.name))
    .map((statement) => {
      const line = formatStatement(statement);
      return { id: statement.name, text: line, outline: ellipsis(line, 80) };
    });
  const projection = paginate(items, budget);
  return {
    text: projection.text,
    truncated: projection.truncated,
    ...(projection.cursor ? { cursor: projection.cursor } : {}),
  };
}
