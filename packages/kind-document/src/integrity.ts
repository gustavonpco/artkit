import type { ErrorIssue } from '@artkit/core';
import type { Block, DocumentContent, ListItem } from './schema.js';

const pt = (locale: string | undefined) => locale?.toLowerCase().startsWith('pt') ?? false;

/** Integrity rules a schema cannot express. Paths are relative to the block. */
export function blockIssues(block: Block, locale?: string): ErrorIssue[] {
  const issues: ErrorIssue[] = [];
  const isPt = pt(locale);
  if (block.type === 'table') {
    const width = block.header.length;
    block.rows.forEach((row, index) => {
      if (row.length !== width) {
        issues.push({
          path: `rows[${index}]`,
          message: isPt
            ? `A linha tem ${row.length} células e o cabeçalho tem ${width}.`
            : `The row has ${row.length} cells and the header has ${width}.`,
          hint: isPt
            ? `Informe ${width} células na linha ou ajuste o cabeçalho.`
            : `Give the row ${width} cells or change the header.`,
        });
      }
    });
    if (block.footer && block.footer.length !== width) {
      issues.push({
        path: 'footer',
        message: isPt
          ? `O rodapé tem ${block.footer.length} células e o cabeçalho tem ${width}.`
          : `The footer has ${block.footer.length} cells and the header has ${width}.`,
        hint: isPt ? `Informe ${width} células no rodapé.` : `Give the footer ${width} cells.`,
      });
    }
    for (const key of ['align', 'widths'] as const) {
      const list = block[key];
      if (list && list.length !== width) {
        issues.push({
          path: key,
          message: isPt
            ? `"${key}" tem ${list.length} valores e a tabela tem ${width} colunas.`
            : `"${key}" has ${list.length} values and the table has ${width} columns.`,
          hint: isPt
            ? `Informe um valor por coluna (${width}) ou omita "${key}".`
            : `Give one value per column (${width}) or omit "${key}".`,
        });
      }
    }
  }
  if (block.type === 'list') {
    const depth = listDepth(block.items);
    if (depth > 3) {
      issues.push({
        path: 'items',
        message: isPt
          ? `A lista tem ${depth} níveis; o máximo é 3.`
          : `The list has ${depth} levels; the maximum is 3.`,
        hint: isPt ? 'Reduza o aninhamento para no máximo 3 níveis.' : 'Reduce nesting to at most 3 levels.',
      });
    }
  }
  return issues;
}

export function listDepth(items: readonly ListItem[]): number {
  let max = 0;
  for (const item of items) max = Math.max(max, 1 + (item.children ? listDepth(item.children) : 0));
  return max;
}

export function validateDocument(content: DocumentContent, locale?: string): ErrorIssue[] {
  const issues: ErrorIssue[] = [];
  content.blocks.forEach((block, index) => {
    for (const issue of blockIssues(block, locale))
      issues.push({ ...issue, path: `blocks[${index}].${issue.path}` });
  });
  return issues;
}

export function measureDocument(content: DocumentContent): Record<string, number> {
  let tableRows = 0;
  for (const block of content.blocks)
    if (block.type === 'table') tableRows = Math.max(tableRows, block.rows.length);
  return { blocks: content.blocks.length, tableRows };
}

export const DOCUMENT_LIMITS = { blocks: 2_000, tableRows: 200 } as const;
