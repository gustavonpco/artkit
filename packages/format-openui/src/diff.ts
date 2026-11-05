import type { ChangeSummary } from '@artkit-ai/core';
import { parseStatements } from './syntax.js';

/** Changes between two OpenUI documents, targeted by declaration name (`node:capa`). */
export function diffOpenUI(before: string, after: string): ChangeSummary[] {
  if (before === after) return [];
  const a = new Map(parseStatements(before).statements.map((statement) => [statement.name, statement.expr]));
  const b = new Map(parseStatements(after).statements.map((statement) => [statement.name, statement.expr]));
  const changes: ChangeSummary[] = [];
  for (const [name, expr] of b) {
    if (!a.has(name)) changes.push({ type: 'added', target: `node:${name}`, summary: expr.slice(0, 80) });
    else if (a.get(name) !== expr)
      changes.push({
        type: 'changed',
        target: `node:${name}`,
        summary: `${a.get(name)!.slice(0, 40)} → ${expr.slice(0, 40)}`,
      });
  }
  for (const name of a.keys())
    if (!b.has(name)) changes.push({ type: 'removed', target: `node:${name}`, summary: name });
  return changes;
}
