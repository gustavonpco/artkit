import { type ArtifactExporter, createZip } from '@artkit/core';
import type { SheetContent } from '../schema.js';
import { sheetToCsv } from './csv.js';

function safeName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'sheet';
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Every sheet (hidden included) as its own CSV inside a ZIP; csv alone exports one sheet. */
export const sheetZipExporter: ArtifactExporter<SheetContent> = {
  kind: 'sheet',
  format: 'zip',
  mimeType: 'application/zip',
  extension: 'zip',
  runtime: 'any',
  async export(content, ctx) {
    const delimiter =
      ctx.options?.delimiter === ';' || ctx.options?.delimiter === '\t' ? ctx.options.delimiter : ',';
    const used = new Set<string>();
    const bom = String.fromCharCode(0xfeff);
    return createZip(
      content.sheets.map((sheet) => ({
        path: `${safeName(sheet.name, used)}.csv`,
        data: `${bom}${sheetToCsv(sheet, delimiter as string)}`,
      })),
    );
  },
};
