import type { ErrorIssue } from '@artkit-ai/core';
import {
  columnIndex,
  looksLikeReference,
  MAX_ROWS,
  parseCellKey,
  parseRange,
  type Rect,
  rectSize,
  rectsIntersect,
} from './address.js';
import { serialFromIso } from './formula/dates.js';
import { type FormulaEngine, findCircularReferences } from './formula/engine.js';
import { canonicalNameRef } from './operations.js';
import type { SheetContent } from './schema.js';

const MESSAGES = {
  en: {
    duplicateSheet: (name: string) => `Sheet name "${name}" is used more than once.`,
    duplicateSheetHint: 'Sheet names are case-insensitive and must be unique.',
    cellOutside: (key: string) => `Cell ${key} is outside the grid.`,
    gridHint: 'Use rows 1–100000 and columns A–XFD.',
    badColumn: (key: string) => `Column key "${key}" is invalid.`,
    badRow: (key: string) => `Row key "${key}" is invalid.`,
    circular: (cells: string) => `Circular reference: ${cells}.`,
    circularHint: 'A formula cannot depend on itself, directly or through other cells.',
    badMerge: (merge: string) => `Merge "${merge}" is not a valid range of at least two cells.`,
    mergeOverlap: (a: string, b: string) => `Merges ${a} and ${b} overlap.`,
    mergeHint: 'Merged ranges cannot overlap; remove one of them.',
    badValidation: (range: string) => `Validation range "${range}" is invalid.`,
    validationOverlap: (a: string, b: string) => `Validations ${a} and ${b} overlap.`,
    validationHint: 'Each cell can have one validation list.',
    duplicateName: (name: string) => `Name "${name}" is defined more than once.`,
    nameLikeRef: (name: string) => `Name "${name}" looks like a cell reference.`,
    nameHint: 'Use a descriptive name like "valor_hora".',
    badNameRef: (ref: string) => `Name reference "${ref}" is invalid.`,
    nameRefHint: 'Use one reference with an existing sheet name, e.g. "Parametros!$B$2".',
    badDate: (date: string) => `Calculation date "${date}" is not a valid date.`,
  },
  pt: {
    duplicateSheet: (name: string) => `O nome de aba "${name}" aparece mais de uma vez.`,
    duplicateSheetHint: 'Nomes de aba não diferenciam maiúsculas e precisam ser únicos.',
    cellOutside: (key: string) => `A célula ${key} está fora da grade.`,
    gridHint: 'Use linhas de 1 a 100000 e colunas de A a XFD.',
    badColumn: (key: string) => `A chave de coluna "${key}" é inválida.`,
    badRow: (key: string) => `A chave de linha "${key}" é inválida.`,
    circular: (cells: string) => `Referência circular: ${cells}.`,
    circularHint: 'Uma fórmula não pode depender de si mesma, direta ou indiretamente.',
    badMerge: (merge: string) =>
      `A mesclagem "${merge}" não é um intervalo válido com pelo menos duas células.`,
    mergeOverlap: (a: string, b: string) => `As mesclagens ${a} e ${b} se sobrepõem.`,
    mergeHint: 'Mesclagens não podem se sobrepor; remova uma delas.',
    badValidation: (range: string) => `O intervalo de validação "${range}" é inválido.`,
    validationOverlap: (a: string, b: string) => `As validações ${a} e ${b} se sobrepõem.`,
    validationHint: 'Cada célula pode ter uma única lista de validação.',
    duplicateName: (name: string) => `O nome "${name}" está definido mais de uma vez.`,
    nameLikeRef: (name: string) => `O nome "${name}" parece uma referência de célula.`,
    nameHint: 'Use um nome descritivo como "valor_hora".',
    badNameRef: (ref: string) => `A referência do nome "${ref}" é inválida.`,
    nameRefHint: 'Use uma referência com o nome de uma aba existente, por exemplo "Parametros!$B$2".',
    badDate: (date: string) => `A data de cálculo "${date}" não é válida.`,
  },
};

function overlaps(
  ranges: { text: string; rect: Rect | undefined; path: string }[],
  issue: (a: string, b: string, path: string) => ErrorIssue,
): ErrorIssue[] {
  const issues: ErrorIssue[] = [];
  const valid = ranges.filter((range) => range.rect);
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      if (rectsIntersect(valid[i]!.rect!, valid[j]!.rect!))
        issues.push(issue(valid[i]!.text, valid[j]!.text, valid[j]!.path));
    }
  }
  return issues;
}

/** Integrity rules a schema cannot express (spec §10.1). Paths are relative to the content. */
export function validateSheetContent(
  content: SheetContent,
  engine: FormulaEngine,
  locale: string,
): ErrorIssue[] {
  const m = locale.toLowerCase().startsWith('pt') ? MESSAGES.pt : MESSAGES.en;
  const issues: ErrorIssue[] = [];
  const seenSheets = new Map<string, number>();
  content.sheets.forEach((sheet, s) => {
    const base = `sheets[${s}]`;
    const upper = sheet.name.toUpperCase();
    if (seenSheets.has(upper))
      issues.push({
        path: `${base}.name`,
        message: m.duplicateSheet(sheet.name),
        hint: m.duplicateSheetHint,
      });
    seenSheets.set(upper, s);
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (!parseCellKey(key)) {
        issues.push({ path: `${base}.cells.${key}`, message: m.cellOutside(key), hint: m.gridHint });
        continue;
      }
      if (cell.f === undefined) continue;
      for (const issue of engine.validate(cell.f, { content, sheetId: sheet.id })) {
        issues.push({
          path: `${base}.cells.${key}.f`,
          message: `${key}: ${issue.message}`,
          ...(issue.hint ? { hint: issue.hint } : {}),
        });
      }
    }
    for (const key of Object.keys(sheet.columns ?? {})) {
      if (columnIndex(key) < 0)
        issues.push({ path: `${base}.columns.${key}`, message: m.badColumn(key), hint: m.gridHint });
    }
    for (const key of Object.keys(sheet.rows ?? {})) {
      if (Number(key) > MAX_ROWS)
        issues.push({ path: `${base}.rows.${key}`, message: m.badRow(key), hint: m.gridHint });
    }
    const merges = (sheet.merges ?? []).map((text, i) => ({
      text,
      rect: parseRange(text),
      path: `${base}.merges[${i}]`,
    }));
    for (const merge of merges) {
      if (!merge.rect || rectSize(merge.rect) < 2)
        issues.push({ path: merge.path, message: m.badMerge(merge.text), hint: m.mergeHint });
    }
    issues.push(
      ...overlaps(merges, (a, b, path) => ({ path, message: m.mergeOverlap(a, b), hint: m.mergeHint })),
    );
    const validations = (sheet.validations ?? []).map((validation, i) => ({
      text: validation.range,
      rect: parseRange(validation.range),
      path: `${base}.validations[${i}].range`,
    }));
    for (const validation of validations) {
      if (!validation.rect)
        issues.push({ path: validation.path, message: m.badValidation(validation.text), hint: m.gridHint });
    }
    issues.push(
      ...overlaps(validations, (a, b, path) => ({
        path,
        message: m.validationOverlap(a, b),
        hint: m.validationHint,
      })),
    );
  });

  if (issues.length === 0) {
    for (const group of findCircularReferences(content)) {
      const first = group[0]!;
      const s = content.sheets.findIndex((sheet) => sheet.id === first.sheetId);
      const names = group.map(
        (ref) =>
          `${content.sheets.find((sheet) => sheet.id === ref.sheetId)?.name ?? ref.sheetId}!${ref.address}`,
      );
      const chain = group.length === 1 ? `${names[0]} → ${names[0]}` : [...names, names[0]].join(' → ');
      issues.push({
        path: `sheets[${s}].cells.${first.address}.f`,
        message: m.circular(chain),
        hint: m.circularHint,
      });
    }
  }

  const seenNames = new Set<string>();
  (content.names ?? []).forEach((name, i) => {
    const path = `names[${i}]`;
    if (seenNames.has(name.name.toUpperCase()))
      issues.push({ path: `${path}.name`, message: m.duplicateName(name.name), hint: m.nameHint });
    seenNames.add(name.name.toUpperCase());
    if (looksLikeReference(name.name) || ['TRUE', 'FALSE'].includes(name.name.toUpperCase())) {
      issues.push({ path: `${path}.name`, message: m.nameLikeRef(name.name), hint: m.nameHint });
    }
    const canonical = canonicalNameRef(name.ref);
    const sheetName = /^(?:'((?:[^']|'')+)'|([^!]+))!/.exec(name.ref.trim().replace(/^=/, ''));
    const target = sheetName ? (sheetName[1]?.replace(/''/g, "'") ?? sheetName[2]!) : undefined;
    const sheetExists =
      target !== undefined &&
      content.sheets.some((sheet) => sheet.name.toUpperCase() === target.toUpperCase());
    if (canonical === undefined || (canonical !== '#REF!' && !sheetExists)) {
      issues.push({ path: `${path}.ref`, message: m.badNameRef(name.ref), hint: m.nameRefHint });
    }
  });

  const date = content.settings?.calculationDate;
  if (date !== undefined && serialFromIso(date) === undefined) {
    issues.push({ path: 'settings.calculationDate', message: m.badDate(date), hint: 'YYYY-MM-DD' });
  }
  return issues;
}
