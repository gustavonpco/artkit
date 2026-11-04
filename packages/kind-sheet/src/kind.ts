import { type ArtifactKind, defineKind } from '@artkit/core';
import { parseCellKey } from './address.js';
import { diffSheetContent } from './diff.js';
import { createFormulaEngine, type FormulaEngine } from './formula/engine.js';
import { sheetInputs } from './inputs.js';
import { sheetInstructions } from './instructions.js';
import { lintSheetContent } from './lint.js';
import { normalizeSheetContent } from './normalize.js';
import {
  applySheetOperation,
  operationTargets,
  type SheetOperation,
  sheetOperationSchema,
} from './operations.js';
import { parsePartialSheet } from './partial.js';
import { projectSheet } from './projection.js';
import { recalculateContent } from './recalc.js';
import { SHEET_LIMITS, type SheetContent, sheetContentSchema } from './schema.js';
import { validateSheetContent } from './validate.js';

export interface SheetKindOptions {
  /** Formula engine used for validation and recalculation (default: the built-in engine). */
  formulaEngine?: FormulaEngine;
  /**
   * Language of validation messages and diff summaries, and locale used to format values in diffs.
   * Used when the core does not pass a locale to `validate` and `diff` (the call's locale wins).
   */
  locale?: string;
}

export function createSheetKind(options: SheetKindOptions = {}): ArtifactKind<SheetContent, SheetOperation> {
  const locale = options.locale ?? 'en';
  const engine = options.formulaEngine ?? createFormulaEngine({ locale });
  return defineKind<SheetContent, SheetOperation>({
    kind: 'sheet',
    version: 1,
    label: locale.toLowerCase().startsWith('pt') ? 'Planilha' : 'Sheet',
    contentSchema: sheetContentSchema,
    operationSchema: sheetOperationSchema,
    empty: () => ({ sheets: [{ id: 'sheet1', name: 'Sheet1', cells: {} }] }),
    normalize: normalizeSheetContent,
    apply: applySheetOperation,
    ids: (content) => content.sheets.map((sheet) => sheet.id),
    validate: (content, callLocale) => validateSheetContent(content, engine, callLocale ?? locale),
    measure(content) {
      let cells = 0;
      let rows = 0;
      let columns = 0;
      for (const sheet of content.sheets) {
        for (const key of Object.keys(sheet.cells)) {
          cells++;
          const pos = parseCellKey(key);
          if (!pos) continue;
          rows = Math.max(rows, pos.row + 1);
          columns = Math.max(columns, pos.col + 1);
        }
      }
      return { sheets: content.sheets.length, cells, rows, columns };
    },
    derive: (draft) => recalculateContent(draft, engine),
    targets: operationTargets,
    project: projectSheet,
    lint: lintSheetContent,
    diff: (before, after, callLocale) => diffSheetContent(before, after, callLocale ?? locale),
    parsePartial: (raw) => parsePartialSheet(raw, engine),
    inputs: sheetInputs,
    migrations: [],
    limits: { ...SHEET_LIMITS },
    instructions: sheetInstructions,
  });
}

/** Ready-to-register sheet kind with the built-in formula engine. */
export const sheetKind = createSheetKind();
