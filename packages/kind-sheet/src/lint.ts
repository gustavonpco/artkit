import type { LintContext, LintIssue } from '@artkit/core';
import { cellKey, columnLetter, parseCellKey, parseRange, rectContains } from './address.js';
import { formatCellValue, resolveCurrency } from './display.js';
import { parseCached, walk } from './formula/parser.js';
import { FormulaSyntaxError } from './formula/tokenizer.js';
import { parseNumericText } from './formula/values.js';
import { type Cell, isErrorValue, type Sheet, type SheetContent } from './schema.js';

/** Default column width in characters (spreadsheet default ≈ 8.43, rounded up for padding). */
export const DEFAULT_COLUMN_WIDTH = 10;

const MAX_ISSUES = 200;

const TOTAL_LABEL =
  /^\s*(?:sub-?)?totais?\b|^\s*(?:sub-?)?totals?\b|^\s*(?:grand\s+total|total\s+geral|soma)\b/i;

const ERROR_EXPLANATIONS = {
  en: {
    '#DIV/0!': 'division by zero',
    '#REF!': 'a reference points to deleted cells or a removed sheet',
    '#NAME?': 'unknown function or name',
    '#VALUE!': 'wrong value type (e.g. text in arithmetic or a multi-cell range where one value is expected)',
    '#N/A': 'value not available (lookup without a match, or TODAY() without a calculation date)',
    '#NUM!': 'invalid numeric result',
    '#NULL!': 'empty intersection',
  },
  pt: {
    '#DIV/0!': 'divisão por zero',
    '#REF!': 'uma referência aponta para células excluídas ou uma aba removida',
    '#NAME?': 'função ou nome desconhecido',
    '#VALUE!':
      'tipo de valor errado (texto em conta ou intervalo com várias células onde se espera um valor)',
    '#N/A': 'valor indisponível (busca sem correspondência ou TODAY() sem data de cálculo)',
    '#NUM!': 'resultado numérico inválido',
    '#NULL!': 'interseção vazia',
  },
} as const;

/** Plain-language explanation of a formula error code (used by lint and the editor). */
export function explainError(code: string, locale: string): string {
  const table = locale.toLowerCase().startsWith('pt') ? ERROR_EXPLANATIONS.pt : ERROR_EXPLANATIONS.en;
  return (table as Record<string, string>)[code] ?? code;
}

const M = {
  en: {
    emptyRef: (cell: string, ref: string) => `${cell} references the empty cell ${ref}.`,
    emptyRefHint: 'Fill the referenced cell or fix the reference.',
    numberAsText: (cell: string, text: string) =>
      `${cell} stores the number ${JSON.stringify(text)} as text.`,
    numberAsTextHint:
      'Write it as a number (without quotes) so formulas can use it, or set fmt "text" if it is a code.',
    narrow: (col: string, cell: string, needed: number, width: number) =>
      `Column ${col} (width ${width}) is too narrow for ${cell}, which needs about ${needed} characters.`,
    narrowHint: (col: string, needed: number) =>
      `Use set_column_width on ${col} with width ${Math.min(80, needed + 1)}, or wrap the text.`,
    total: (cell: string, label: string) => `${cell} is a total ("${label}") typed as a literal number.`,
    totalHint: 'Use a formula such as SUM or SUMIF so the total follows the data.',
    today: (cell: string) =>
      `${cell} uses TODAY() but the workbook has no calculation date, so it shows #N/A.`,
    todayHint: 'Set it with set_settings { calculationDate: "YYYY-MM-DD" }.',
    error: (cell: string, code: string, why: string) => `${cell} results in ${code}: ${why}.`,
    errorHint: 'Fix the formula or the cells it references.',
    validation: (cell: string, value: string) => `${cell} has ${value}, which is not in its validation list.`,
    validationHint: 'Use one of the allowed values or change the list with set_validation.',
  },
  pt: {
    emptyRef: (cell: string, ref: string) => `${cell} referencia a célula vazia ${ref}.`,
    emptyRefHint: 'Preencha a célula referenciada ou corrija a referência.',
    numberAsText: (cell: string, text: string) =>
      `${cell} guarda o número ${JSON.stringify(text)} como texto.`,
    numberAsTextHint:
      'Grave como número (sem aspas) para que as fórmulas o usem, ou use fmt "text" se for um código.',
    narrow: (col: string, cell: string, needed: number, width: number) =>
      `A coluna ${col} (largura ${width}) é estreita para ${cell}, que precisa de cerca de ${needed} caracteres.`,
    narrowHint: (col: string, needed: number) =>
      `Use set_column_width em ${col} com largura ${Math.min(80, needed + 1)} ou quebre o texto.`,
    total: (cell: string, label: string) => `${cell} é um total ("${label}") digitado como número literal.`,
    totalHint: 'Use uma fórmula como SUM ou SUMIF para o total acompanhar os dados.',
    today: (cell: string) => `${cell} usa TODAY(), mas a pasta não tem data de cálculo e mostra #N/A.`,
    todayHint: 'Defina com set_settings { calculationDate: "AAAA-MM-DD" }.',
    error: (cell: string, code: string, why: string) => `${cell} resulta em ${code}: ${why}.`,
    errorHint: 'Corrija a fórmula ou as células que ela referencia.',
    validation: (cell: string, value: string) => `${cell} tem ${value}, que não está na lista de validação.`,
    validationHint: 'Use um dos valores permitidos ou altere a lista com set_validation.',
  },
};

const hasValue = (cell: Cell | undefined) =>
  cell !== undefined && (cell.f !== undefined || (cell.v !== undefined && cell.v !== ''));

function analyzeFormula(
  formula: string,
): { refs: ReturnType<typeof parseCached>['tokens']; usesToday: boolean } | undefined {
  try {
    const parsed = parseCached(formula);
    let usesToday = false;
    walk(parsed.ast, (node) => {
      if (node.type === 'call' && node.name === 'TODAY') usesToday = true;
    });
    return { refs: parsed.tokens.filter((token) => token.type === 'ref'), usesToday };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return undefined;
    throw error;
  }
}

/** Non-blocking checks (spec §10.2). Targets use `cell:<sheetId>!A1`. */
export function lintSheetContent(content: SheetContent, ctx: LintContext): LintIssue[] {
  const pt = ctx.locale.toLowerCase().startsWith('pt');
  const m = pt ? M.pt : M.en;
  const issues: LintIssue[] = [];
  const add = (issue: LintIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };
  const display = { locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) };
  const byName = new Map(content.sheets.map((sheet) => [sheet.name.toUpperCase(), sheet]));

  for (const sheet of content.sheets) {
    const target = (key: string) => `cell:${sheet.id}!${key}`;
    const label = (key: string) => `${sheet.name}!${key}`;
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (cell.f !== undefined) {
        const analysis = analyzeFormula(cell.f);
        if (analysis?.usesToday && !content.settings?.calculationDate) {
          add({
            code: 'today-without-date',
            severity: 'warning',
            target: target(key),
            message: m.today(label(key)),
            hint: m.todayHint,
          });
        }
        if (
          isErrorValue(cell.v) &&
          !(analysis?.usesToday && cell.v.error === '#N/A' && !content.settings?.calculationDate)
        ) {
          add({
            code: 'formula-error',
            severity: 'warning',
            target: target(key),
            message: m.error(label(key), cell.v.error, explainError(cell.v.error, ctx.locale)),
            hint: m.errorHint,
          });
        }
        for (const token of analysis?.refs ?? []) {
          const ref = token.ref!;
          if (ref.kind !== 'cell') continue;
          const refSheet = ref.sheet === undefined ? sheet : byName.get(ref.sheet.toUpperCase());
          if (!refSheet) continue;
          const refKey = cellKey(ref.a.row!, ref.a.col!);
          if (!hasValue(refSheet.cells[refKey])) {
            const shown = refSheet === sheet ? refKey : `${refSheet.name}!${refKey}`;
            add({
              code: 'formula-empty-ref',
              severity: 'warning',
              target: target(key),
              message: m.emptyRef(label(key), shown),
              hint: m.emptyRefHint,
            });
            break;
          }
        }
      } else if (
        typeof cell.v === 'string' &&
        cell.fmt !== 'text' &&
        !/^0\d/.test(cell.v.trim()) &&
        parseNumericText(cell.v) !== undefined &&
        !/^\d{4}-\d{2}-\d{2}/.test(cell.v.trim())
      ) {
        add({
          code: 'number-as-text',
          severity: 'warning',
          target: target(key),
          message: m.numberAsText(label(key), cell.v),
          hint: m.numberAsTextHint,
        });
      }
    }
    lintTotals(sheet, (key, text) =>
      add({
        code: 'total-without-formula',
        severity: 'warning',
        target: target(key),
        message: m.total(label(key), text),
        hint: m.totalHint,
      }),
    );
    lintWidths(sheet, display, (col, key, needed, width) =>
      add({
        code: 'column-too-narrow',
        severity: 'info',
        target: target(key),
        message: m.narrow(col, label(key), needed, width),
        hint: m.narrowHint(col, needed),
      }),
    );
    for (const validation of sheet.validations ?? []) {
      const rect = parseRange(validation.range);
      if (!rect) continue;
      const allowed = new Set(validation.values.map((value) => String(value).toUpperCase()));
      for (const [key, cell] of Object.entries(sheet.cells)) {
        const pos = parseCellKey(key);
        if (
          !pos ||
          !rectContains(rect, pos.row, pos.col) ||
          cell.v === undefined ||
          cell.v === '' ||
          isErrorValue(cell.v)
        )
          continue;
        if (!allowed.has(String(cell.v).toUpperCase())) {
          add({
            code: 'validation-mismatch',
            severity: 'warning',
            target: target(key),
            message: m.validation(label(key), JSON.stringify(cell.v)),
            hint: m.validationHint,
          });
        }
      }
    }
  }
  return issues;
}

/** Rows or columns labelled Total/Subtotal whose numbers are literals instead of formulas. */
function lintTotals(sheet: Sheet, report: (key: string, label: string) => void): void {
  const rows = new Map<number, [number, string, Cell][]>();
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    const list = rows.get(pos.row) ?? [];
    list.push([pos.col, key, cell]);
    rows.set(pos.row, list);
  }
  const reported = new Set<string>();
  for (const cells of rows.values()) {
    cells.sort((a, b) => a[0] - b[0]);
    const labelIndex = cells.findIndex(
      ([, , cell]) => typeof cell.v === 'string' && cell.f === undefined && TOTAL_LABEL.test(cell.v),
    );
    if (labelIndex < 0) continue;
    const text = cells[labelIndex]![2].v as string;
    for (const [, key, cell] of cells.slice(labelIndex + 1)) {
      if (cell.f === undefined && typeof cell.v === 'number' && !reported.has(key)) {
        reported.add(key);
        report(key, text);
      }
    }
  }
  // Column headers (first filled row of a column) labelled as totals.
  if (rows.size === 0) return;
  const headerRow = [...rows.keys()].reduce((a, b) => Math.min(a, b));
  for (const [col, , cell] of rows.get(headerRow) ?? []) {
    if (typeof cell.v !== 'string' || cell.f !== undefined || !TOTAL_LABEL.test(cell.v)) continue;
    for (const [row, cells] of rows) {
      if (row === headerRow) continue;
      const found = cells.find(([c]) => c === col);
      if (found && found[2].f === undefined && typeof found[2].v === 'number' && !reported.has(found[1])) {
        reported.add(found[1]);
        report(found[1], cell.v);
      }
    }
  }
}

/** Estimates displayed width; numbers do not overflow (they show ###), text overflows into empty neighbors. */
function lintWidths(
  sheet: Sheet,
  display: { locale: string; currency: string },
  report: (col: string, key: string, needed: number, width: number) => void,
): void {
  const merged = (sheet.merges ?? []).map(parseRange).filter((rect) => rect !== undefined);
  const worst = new Map<number, { key: string; needed: number }>();
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos || cell.v === undefined || cell.s?.wrap) continue;
    if (merged.some((rect) => rectContains(rect, pos.row, pos.col))) continue;
    const width = sheet.columns?.[columnLetter(pos.col)]?.width ?? DEFAULT_COLUMN_WIDTH;
    // Cheap upper bound first: formatting every number through Intl is the slow part on big sheets.
    if (typeof cell.v === 'number' && String(Math.round(Math.abs(cell.v))).length * 1.4 + 8 <= width)
      continue;
    if (typeof cell.v === 'string' && cell.v.length <= width) continue;
    const text = formatCellValue(cell.v, cell.fmt, display);
    const needed = [...text].length;
    if (needed <= width) continue;
    if (typeof cell.v === 'string' && !hasValue(sheet.cells[cellKey(pos.row, pos.col + 1)])) continue;
    const current = worst.get(pos.col);
    if (!current || needed > current.needed) worst.set(pos.col, { key, needed });
  }
  for (const [col, { key, needed }] of [...worst.entries()].sort((a, b) => a[0] - b[0])) {
    report(columnLetter(col), key, needed, sheet.columns?.[columnLetter(col)]?.width ?? DEFAULT_COLUMN_WIDTH);
  }
}
