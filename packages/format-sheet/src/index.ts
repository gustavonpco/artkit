import {
  type AdapterContext,
  type ApplyResult,
  type ChangeSummary,
  defineFormat,
  type FormatAdapter,
  type FormatInstructions,
  type LintIssue,
  type ReadRequest,
  type ReadResult,
  type ValidationResult,
} from '@artkit-ai/core';
import { formatAddress, formatRange, parseRange } from './a1.js';
import { diffWorkbook } from './diff.js';
import type { SheetEngine } from './engine.js';
import { lintWorkbook } from './lint.js';
import {
  emptyWorkbook,
  filledCells,
  orderedSheets,
  validateWorkbook,
  type WorkbookContent,
} from './model.js';
import {
  type ResolvedOperation,
  resolveOperation,
  type SheetOperation,
  sheetOperationSchema,
} from './operations.js';
import { readWorkbook } from './read.js';
import { offendingValue, parseRules, serializeRules, shiftRules, upsertRule } from './validation.js';

export * from './a1.js';
export { diffWorkbook } from './diff.js';
export * from './engine.js';
export { lintWorkbook } from './lint.js';
export * from './model.js';
export * from './operations.js';
export { displayCell, readWorkbook } from './read.js';
export {
  offendingValue,
  parseRules,
  serializeRules,
  shiftRange,
  shiftRules,
  upsertRule,
} from './validation.js';

export const SHEET_LIMITS = { sheets: 20, cells: 50_000 };
/** Univer packages pinned by this adapter (spec §6.4). */
export const SHEET_FORMAT_VERSION = 'univer-sheet@1.3.1';

export const SHEET_INSTRUCTIONS: FormatInstructions = {
  summary:
    'Univer workbook for calculations, totals and comparisons. Read the outline, write inputs as values and totals as formulas, and check the computed values in the next read.',
  rules: [
    'Address cells by sheet name and A1 address; read the outline before writing.',
    'Write totals as formulas (=SUM, =B2*C2) so they recalculate when inputs change.',
    'Keep inputs and assumptions in their own sheet and reference them from calculations.',
    'Do not use TODAY(), NOW(), RAND() or RANDBETWEEN(): store dates as fixed values in an assumptions sheet.',
    'Do not use functions with external effects (WEBSERVICE, IMPORTDATA, INDIRECT, OFFSET).',
    'Use set_format for money (currency), percentages and dates; never type a computed total as a number.',
  ],
  examples: [
    {
      title: 'Estimate with a total',
      operations: [
        { op: 'add_sheet', name: 'Estimativa' },
        {
          op: 'set_values',
          sheet: 'Estimativa',
          at: 'A1',
          values: [['Perfil', 'Horas', 'Valor hora', 'Total']],
        },
        { op: 'set_values', sheet: 'Estimativa', at: 'A2', values: [['Tech Lead', 120, 165, '=B2*C2']] },
        { op: 'set_format', sheet: 'Estimativa', range: 'D2', format: 'currency' },
      ],
    },
  ],
};

/** Sheet format adapter (spec §11). The engine decides where the calculation runs (Univer headless on the server). */
export function createSheetFormat(engine: SheetEngine): FormatAdapter<WorkbookContent, SheetOperation> {
  return defineFormat({
    format: 'univer-sheet',
    formatVersion: SHEET_FORMAT_VERSION,
    readableVersions: [SHEET_FORMAT_VERSION],
    label: 'Planilha',
    empty: () => emptyWorkbook(),
    validate(content: unknown, _ctx: AdapterContext): ValidationResult<WorkbookContent> {
      return validateWorkbook(content);
    },
    operationSchema: sheetOperationSchema,
    async apply(
      content: WorkbookContent,
      operations: SheetOperation[],
      ctx: AdapterContext,
    ): Promise<ApplyResult<WorkbookContent>> {
      // Structural operations change the names and tab order that later operations resolve against.
      const shadow: WorkbookContent = structuredClone(content);
      let counter = 0;
      const nextSheetId = () => {
        let candidate: string;
        do {
          counter += 1;
          candidate = `sheet_${counter}`;
        } while (shadow.sheets[candidate]);
        return candidate;
      };
      const resolved: ResolvedOperation[] = [];
      const createdRefs: string[] = [];
      let rules = parseRules(content.validations);
      operations.forEach((op, index) => {
        const next = resolveOperation(shadow, op, index, ctx, nextSheetId);
        if (next.kind === 'set_values') {
          next.values.forEach((line, rowOffset) => {
            line.forEach((value, columnOffset) => {
              const row = next.row + rowOffset;
              const column = next.column + columnOffset;
              const offence = offendingValue(rules, next.sheetId, row, column, value);
              if (offence) {
                ctx.fail(`A célula ${formatAddress(row, column)} aceita apenas os valores da lista.`, {
                  path: 'values',
                  hint: `Use um destes valores: ${offence.list.join(', ')}.`,
                });
              }
            });
          });
        }
        if (next.kind === 'set_validation') {
          rules = upsertRule(rules, { sheetId: next.sheetId, range: next.range, list: next.list });
        }
        rules = shiftRules(rules, next);
        resolved.push(next);
        advanceShadow(shadow, next);
        if (next.kind === 'add_sheet') createdRefs.push(next.name);
        if (next.kind === 'set_values')
          createdRefs.push(
            `${shadow.sheets[next.sheetId]?.name ?? next.sheetId}!${formatRange({ startRow: next.row, endRow: next.row + next.values.length - 1, startColumn: next.column, endColumn: next.column + Math.max(0, ...next.values.map((row) => row.length)) - 1 })}`,
          );
      });
      // The engine gets the cells and sheets only; the dropdown rules travel with the content.
      const { validations: _previous, ...workbook } = content;
      const result = await engine.execute(workbook as WorkbookContent, resolved, { locale: ctx.locale });
      if (rules.length > 0) result.validations = serializeRules(rules);
      else delete result.validations;
      const validation = validateWorkbook(result);
      if (!validation.ok) {
        ctx.fail(validation.issues[0]?.message ?? 'Planilha inválida após o cálculo.', {
          hint: validation.issues[0]?.hint,
        });
      }
      return { content: validation.content, createdRefs, warnings: lintWorkbook(validation.content) };
    },
    read(content: WorkbookContent, request: ReadRequest): ReadResult {
      return readWorkbook(content, request);
    },
    diff: (before, after) => diffWorkbook(before, after) as ChangeSummary[],
    lint(content: WorkbookContent): LintIssue[] {
      return lintWorkbook(content);
    },
    parsePartial(raw: string): WorkbookContent | undefined {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const validation = validateWorkbook(parsed);
        return validation.ok ? validation.content : undefined;
      } catch {
        return undefined;
      }
    },
    migrations: [],
    limits: SHEET_LIMITS,
    measure: (content: WorkbookContent) => ({
      sheets: orderedSheets(content).length,
      cells: filledCells(content),
    }),
    instructions: SHEET_INSTRUCTIONS,
  });
}

/** Applies a structural operation to the shadow copy so later operations resolve against the new layout. */
function advanceShadow(shadow: WorkbookContent, op: ResolvedOperation): void {
  switch (op.kind) {
    case 'add_sheet': {
      shadow.sheets[op.sheetId] = {
        id: op.sheetId,
        name: op.name,
        rowCount: 100,
        columnCount: 26,
        cellData: {},
      };
      const at =
        op.index === undefined ? shadow.sheetOrder.length : Math.min(op.index, shadow.sheetOrder.length);
      shadow.sheetOrder.splice(at, 0, op.sheetId);
      return;
    }
    case 'rename_sheet':
      shadow.sheets[op.sheetId]!.name = op.name;
      return;
    case 'move_sheet': {
      shadow.sheetOrder = shadow.sheetOrder.filter((id) => id !== op.sheetId);
      shadow.sheetOrder.splice(op.index, 0, op.sheetId);
      return;
    }
    case 'remove_sheet':
      shadow.sheetOrder = shadow.sheetOrder.filter((id) => id !== op.sheetId);
      delete shadow.sheets[op.sheetId];
      return;
    default:
      return;
  }
}

export { parseRange };
