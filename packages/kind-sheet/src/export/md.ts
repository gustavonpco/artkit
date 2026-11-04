import type { ArtifactExporter } from '@artkit-ai/core';
import { cellKey, columnLetter } from '../address.js';
import { formatCellValue, isNumericDisplay, resolveCurrency } from '../display.js';
import { usedRange } from '../projection.js';
import type { Sheet, SheetContent } from '../schema.js';

function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/**
 * One GFM table per visible sheet with the values as displayed (locale formats). The first row of the used
 * range is the header; numeric columns are right-aligned.
 */
export function sheetToMarkdown(content: SheetContent, locale: string): string {
  const display = { locale, currency: resolveCurrency(content, locale) };
  const parts: string[] = [];
  for (const sheet of content.sheets.filter((s: Sheet) => !s.hidden)) {
    parts.push(`## ${sheet.name}`, '');
    const range = usedRange(sheet);
    if (!range) {
      parts.push('_(empty)_', '');
      continue;
    }
    const rows: string[][] = [];
    const numeric: boolean[] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      const line: string[] = [];
      for (let col = range.left; col <= range.right; col++) {
        const cell = sheet.cells[cellKey(row, col)];
        const text = formatCellValue(cell?.v, cell?.fmt, display);
        line.push(escapeCell(cell?.s?.bold && text ? `**${text}**` : text));
        if (row > range.top && cell && isNumericDisplay(cell.v, cell.fmt)) numeric[col - range.left] = true;
      }
      rows.push(line);
    }
    const header = rows[0]!.map((text, index) => text || columnLetter(range.left + index));
    parts.push(`| ${header.join(' | ')} |`);
    parts.push(`| ${header.map((_, index) => (numeric[index] ? '---:' : '---')).join(' | ')} |`);
    for (const line of rows.slice(1)) parts.push(`| ${line.join(' | ')} |`);
    parts.push('');
  }
  return parts.join('\n');
}

export const sheetMarkdownExporter: ArtifactExporter<SheetContent> = {
  kind: 'sheet',
  format: 'md',
  mimeType: 'text/markdown',
  extension: 'md',
  runtime: 'any',
  async export(content, ctx) {
    if (content.sheets.some((sheet) => Object.values(sheet.cells).some((cell) => cell.f !== undefined))) {
      ctx.warn(
        ctx.locale.toLowerCase().startsWith('pt')
          ? 'Fórmulas viram os valores calculados no Markdown.'
          : 'Formulas become their computed values in Markdown.',
      );
    }
    return new TextEncoder().encode(`# ${ctx.title}\n\n${sheetToMarkdown(content, ctx.locale)}`);
  },
};
