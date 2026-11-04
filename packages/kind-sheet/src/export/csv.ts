import { ArtifactError, type ArtifactExporter, type ExportContext } from '@artkit-ai/core';
import { cellKey, parseCellKey } from '../address.js';
import { csvField } from '../csv.js';
import { isoFromSerial } from '../formula/dates.js';
import { numberToText } from '../formula/values.js';
import { type Cell, isErrorValue, type Sheet, type SheetContent } from '../schema.js';

/** Characters that make spreadsheet applications treat a text field as a formula (spec §16). */
const INJECTION = /^[=+\-@\t\r]/;
const BOM = String.fromCharCode(0xfeff);

/** Picks the sheet by `options.sheet` (id or name); defaults to the first visible sheet. */
export function pickSheet(content: SheetContent, ctx: Pick<ExportContext, 'options' | 'locale'>): Sheet {
  const wanted = ctx.options?.sheet;
  if (wanted === undefined) return content.sheets.find((sheet) => !sheet.hidden) ?? content.sheets[0]!;
  const key = String(wanted);
  const found =
    content.sheets.find((sheet) => sheet.id === key) ??
    content.sheets.find((sheet) => sheet.name.toUpperCase() === key.toUpperCase());
  if (!found) {
    const available = content.sheets.map((sheet) => `${sheet.id} ("${sheet.name}")`).join(', ');
    const pt = ctx.locale.toLowerCase().startsWith('pt');
    const message = pt ? `A aba "${key}" não existe.` : `Sheet "${key}" does not exist.`;
    throw new ArtifactError('EXPORT_FAILED', message, {
      issues: [
        {
          path: 'options.sheet',
          message,
          hint: pt ? `Use uma destas abas: ${available}.` : `Use one of: ${available}.`,
        },
      ],
    });
  }
  return found;
}

/** Plain value for CSV: invariant numbers, ISO dates, TRUE/FALSE, error codes; text is protected. */
export function csvValue(cell: Cell | undefined): string {
  const value = cell?.v;
  if (value === undefined) return '';
  if (isErrorValue(value)) return value.error;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if ((cell!.fmt === 'date' || cell!.fmt === 'datetime') && value >= 1 && value <= 2_958_465) {
      return isoFromSerial(value, cell!.fmt === 'datetime');
    }
    return numberToText(value);
  }
  return INJECTION.test(value) ? `'${value}` : value;
}

export function sheetToCsv(sheet: Sheet, delimiter = ','): string {
  let bottom = -1;
  let right = -1;
  for (const key of Object.keys(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    bottom = Math.max(bottom, pos.row);
    right = Math.max(right, pos.col);
  }
  const lines: string[] = [];
  for (let row = 0; row <= bottom; row++) {
    const fields: string[] = [];
    for (let col = 0; col <= right; col++)
      fields.push(csvField(csvValue(sheet.cells[cellKey(row, col)]), delimiter));
    lines.push(fields.join(delimiter));
  }
  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : '';
}

export const sheetCsvExporter: ArtifactExporter<SheetContent> = {
  kind: 'sheet',
  format: 'csv',
  mimeType: 'text/csv',
  extension: 'csv',
  runtime: 'any',
  async export(content, ctx) {
    const sheet = pickSheet(content, ctx);
    const delimiter = ctx.options?.delimiter;
    const chosen = delimiter === ';' || delimiter === '\t' ? delimiter : ',';
    if (delimiter !== undefined && delimiter !== chosen)
      ctx.warn(`Unsupported delimiter ${JSON.stringify(delimiter)}; used ",".`);
    if (content.sheets.length > 1) ctx.warn(`CSV holds one sheet: exported "${sheet.name}".`);
    const text = sheetToCsv(sheet, chosen);
    return new TextEncoder().encode(ctx.options?.bom ? `${BOM}${text}` : text);
  },
};
