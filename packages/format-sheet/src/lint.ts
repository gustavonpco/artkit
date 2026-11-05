import type { LintIssue } from '@artkit-ai/core';
import { formatAddress } from './a1.js';
import { orderedSheets, type WorkbookContent } from './model.js';
import { offendingValue, parseRules } from './validation.js';

const FORMULA_ERRORS = ['#REF!', '#DIV/0!', '#NAME?', '#VALUE!', '#N/A', '#NUM!', '#NULL!'];
const NUMBER_TEXT = /^\s*[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*$|^\s*[-+]?\d+(?:[.,]\d+)?\s*$/;

/** Lint (spec §11.5): formula errors, numbers stored as text, and formulas with no result yet. */
export function lintWorkbook(content: WorkbookContent): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const sheet of orderedSheets(content)) {
    for (const [row, cells] of Object.entries(sheet.cellData)) {
      for (const [column, cell] of Object.entries(cells)) {
        const target = `cell:${sheet.name}!${formatAddress(Number(row), Number(column))}`;
        if (typeof cell.v === 'string' && FORMULA_ERRORS.includes(cell.v)) {
          issues.push({
            code: 'formula-error',
            severity: 'warning',
            target,
            message: `${target} mostra ${cell.v}${cell.f ? ` (fórmula ${cell.f})` : ''}.`,
            hint: 'Corrija a referência ou o intervalo da fórmula.',
          });
        } else if (!cell.f && typeof cell.v === 'string' && NUMBER_TEXT.test(cell.v)) {
          issues.push({
            code: 'number-as-text',
            severity: 'info',
            target,
            message: `${target} guarda "${cell.v}" como texto, e cálculos não o usarão.`,
            hint: 'Grave o número como valor numérico.',
          });
        } else if (cell.f && (cell.v === undefined || cell.v === null)) {
          issues.push({
            code: 'formula-pending',
            severity: 'info',
            target,
            message: `${target} ainda não tem resultado calculado.`,
          });
        }
      }
    }
  }
  for (const rule of parseRules(content.validations)) {
    const sheet = content.sheets[rule.sheetId];
    if (!sheet) continue;
    for (let row = rule.range.startRow; row <= rule.range.endRow; row++) {
      for (let column = rule.range.startColumn; column <= rule.range.endColumn; column++) {
        const cell = sheet.cellData[String(row)]?.[String(column)];
        if (!cell || cell.f || cell.v === undefined || cell.v === null) continue;
        if (!offendingValue([rule], rule.sheetId, row, column, cell.v)) continue;
        const target = `cell:${sheet.name}!${formatAddress(row, column)}`;
        issues.push({
          code: 'validation-violated',
          severity: 'warning',
          target,
          message: `${target} tem "${String(cell.v)}", fora da lista permitida.`,
          hint: 'Troque o valor por um da lista.',
        });
      }
    }
  }
  return issues;
}
