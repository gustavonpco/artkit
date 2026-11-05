import type { AdapterContext } from '@artkit-ai/core';
import { z } from 'zod';
import {
  childrenOf,
  componentOf,
  formatStatement,
  references,
  removeReferences,
  renameReferences,
  type Statement,
  setChildren,
} from './syntax.js';

const name = z
  .string()
  .regex(/^[a-z][A-Za-z0-9_]{0,63}$/, 'Declaration names start with a lowercase letter (e.g. "capa").');
const expr = z
  .string()
  .min(3)
  .max(4000)
  .refine((text) => !text.includes('\n'), 'One declaration per line.')
  .describe('Right-hand side, e.g. Slide("title", [Title("Portal")]).');

export const openuiOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_statement'), name, expr }).strict(),
  z.object({ op: z.literal('remove_statement'), name, cascade: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('rename_statement'), name, to: name }).strict(),
  z
    .object({
      op: z.literal('insert_child'),
      name,
      child: name,
      position: z.number().int().min(0).optional().describe('0-based position; omit to append.'),
      after: name.optional().describe('Insert after this child name.'),
    })
    .strict(),
  z.object({ op: z.literal('remove_child'), name, child: name }).strict(),
  z.object({ op: z.literal('move_child'), name, child: name, position: z.number().int().min(0) }).strict(),
]);

export type OpenUIOperation = z.infer<typeof openuiOperationSchema>;

export const OPENUI_OPERATION_NAMES = [
  'set_statement',
  'remove_statement',
  'rename_statement',
  'insert_child',
  'remove_child',
  'move_child',
] as const;

export interface OpenUIApplyState {
  statements: Statement[];
  createdRefs: string[];
}

function indexOfStatement(
  statements: readonly Statement[],
  target: string,
  ctx: AdapterContext,
  path: string,
): number {
  const index = statements.findIndex((statement) => statement.name === target);
  if (index < 0) {
    ctx.fail(`A declaração "${target}" não existe.`, {
      path,
      hint: 'Leia o outline e use um nome declarado nele.',
    });
  }
  return index;
}

function referrersOf(statements: readonly Statement[], target: string): string[] {
  return statements
    .filter((statement) => statement.name !== target && references(statement.expr).includes(target))
    .map((statement) => statement.name);
}

/** Applies one declaration operation on the list of statements. Order is kept; new statements are appended. */
export function applyOpenUIOperation(
  state: OpenUIApplyState,
  op: OpenUIOperation,
  ctx: AdapterContext,
): void {
  const statements = state.statements;
  switch (op.op) {
    case 'set_statement': {
      if (!componentOf(op.expr) || !op.expr.includes('(')) {
        ctx.fail(`A declaração "${op.name}" precisa chamar um componente, como Title("texto").`, {
          path: 'expr',
          hint: 'Escreva o componente com seus argumentos entre parênteses.',
        });
      }
      const at = statements.findIndex((statement) => statement.name === op.name);
      if (at >= 0) statements[at] = { name: op.name, expr: op.expr };
      else {
        statements.push({ name: op.name, expr: op.expr });
        state.createdRefs.push(op.name);
      }
      return;
    }
    case 'remove_statement': {
      const at = indexOfStatement(statements, op.name, ctx, 'name');
      const referrers = referrersOf(statements, op.name);
      if (referrers.length > 0 && !op.cascade) {
        ctx.fail(`"${op.name}" ainda é usada por ${referrers.join(', ')}.`, {
          path: 'cascade',
          hint: 'Remova ou troque a referência antes, ou envie cascade: true para remover as referências junto.',
        });
      }
      statements.splice(at, 1);
      for (const statement of statements) statement.expr = removeReferences(statement.expr, op.name);
      return;
    }
    case 'rename_statement': {
      const at = indexOfStatement(statements, op.name, ctx, 'name');
      if (statements.some((statement) => statement.name === op.to)) {
        ctx.fail(`Já existe uma declaração chamada "${op.to}".`, { path: 'to', hint: 'Escolha outro nome.' });
      }
      statements[at]!.name = op.to;
      for (const statement of statements) statement.expr = renameReferences(statement.expr, op.name, op.to);
      state.createdRefs.push(op.to);
      return;
    }
    case 'insert_child': {
      const at = indexOfStatement(statements, op.name, ctx, 'name');
      indexOfStatement(statements, op.child, ctx, 'child');
      const current = childrenOf(statements[at]!.expr);
      if (!/\[/.test(statements[at]!.expr)) {
        ctx.fail(`A declaração "${op.name}" não tem lista de filhos.`, {
          path: 'name',
          hint: 'Escolha um componente que aceite filhos, como Slide ou Card.',
        });
      }
      const items = current.filter((item) => item !== op.child);
      let position = op.position ?? items.length;
      if (op.after !== undefined) {
        const index = items.indexOf(op.after);
        if (index < 0)
          ctx.fail(`"${op.after}" não está na lista de filhos de "${op.name}".`, { path: 'after' });
        position = index + 1;
      }
      items.splice(Math.min(position, items.length), 0, op.child);
      statements[at]!.expr = setChildren(statements[at]!.expr, items)!;
      return;
    }
    case 'remove_child': {
      const at = indexOfStatement(statements, op.name, ctx, 'name');
      const items = childrenOf(statements[at]!.expr);
      if (!items.includes(op.child)) {
        ctx.fail(`"${op.child}" não está na lista de filhos de "${op.name}".`, { path: 'child' });
      }
      statements[at]!.expr = setChildren(
        statements[at]!.expr,
        items.filter((item) => item !== op.child),
      )!;
      return;
    }
    case 'move_child': {
      const at = indexOfStatement(statements, op.name, ctx, 'name');
      const items = childrenOf(statements[at]!.expr);
      if (!items.includes(op.child))
        ctx.fail(`"${op.child}" não está na lista de filhos de "${op.name}".`, { path: 'child' });
      const rest = items.filter((item) => item !== op.child);
      rest.splice(Math.min(op.position, rest.length), 0, op.child);
      statements[at]!.expr = setChildren(statements[at]!.expr, rest)!;
      return;
    }
  }
}

export { formatStatement };
