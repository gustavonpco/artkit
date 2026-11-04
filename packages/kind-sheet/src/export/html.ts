import { type ArtifactExporter, type ExportContext, resolveColor, themeCssText } from '@artkit/core';
import { cellKey, columnLetter, parseCellKey, parseRange } from '../address.js';
import { type DisplayOptions, formatCellValue, isNumericDisplay, resolveCurrency } from '../display.js';
import { DEFAULT_COLUMN_WIDTH } from '../lint.js';
import type { Cell, Sheet, SheetContent } from '../schema.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

const BORDER_CSS: Record<string, string> = {
  thin: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
  dashed: '1px dashed',
  dotted: '1px dotted',
  double: '3px double',
};

function cellStyle(cell: Cell, ctx: ExportContext, numeric: boolean): string {
  const s = cell.s ?? {};
  const rules: string[] = [];
  if (s.bold) rules.push('font-weight:700');
  if (s.italic) rules.push('font-style:italic');
  const decoration = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  if (decoration) rules.push(`text-decoration:${decoration}`);
  if (s.fontSize) rules.push(`font-size:${s.fontSize}pt`);
  if (s.color) rules.push(`color:${resolveColor(ctx.theme, s.color)}`);
  if (s.background) rules.push(`background:${resolveColor(ctx.theme, s.background)}`);
  const align = s.align ?? (numeric ? 'right' : undefined);
  if (align) rules.push(`text-align:${align}`);
  if (s.valign) rules.push(`vertical-align:${s.valign}`);
  if (s.wrap) rules.push('white-space:pre-wrap');
  if (s.border) {
    const color = s.border.color ? resolveColor(ctx.theme, s.border.color) : resolveColor(ctx.theme, 'text');
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const kind = s.border[side];
      if (kind) rules.push(`border-${side}:${BORDER_CSS[kind]} ${color}`);
    }
  }
  return rules.join(';');
}

function sheetTable(sheet: Sheet, ctx: ExportContext, display: DisplayOptions): string {
  let bottom = -1;
  let right = -1;
  for (const key of Object.keys(sheet.cells)) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    bottom = Math.max(bottom, pos.row);
    right = Math.max(right, pos.col);
  }
  const anchors = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const merge of sheet.merges ?? []) {
    const rect = parseRange(merge);
    if (!rect) continue;
    bottom = Math.max(bottom, rect.bottom);
    right = Math.max(right, rect.right);
    anchors.set(cellKey(rect.top, rect.left), {
      rows: rect.bottom - rect.top + 1,
      cols: rect.right - rect.left + 1,
    });
    for (let row = rect.top; row <= rect.bottom; row++) {
      for (let col = rect.left; col <= rect.right; col++)
        if (row !== rect.top || col !== rect.left) covered.add(cellKey(row, col));
    }
  }
  const caption = `<caption>${escapeHtml(sheet.name)}</caption>`;
  if (bottom < 0) return `<table class="ak-sheet-table">${caption}</table>`;
  const cols: string[] = [];
  for (let col = 0; col <= right; col++) {
    const width = sheet.columns?.[columnLetter(col)]?.width ?? DEFAULT_COLUMN_WIDTH;
    cols.push(`<col style="width:${Math.round(width * 7 + 10)}px">`);
  }
  const headerRows = Math.max(sheet.frozen?.rows ?? 0, 0);
  const rows: string[] = [];
  for (let row = 0; row <= bottom; row++) {
    const cells: string[] = [];
    for (let col = 0; col <= right; col++) {
      const key = cellKey(row, col);
      if (covered.has(key)) continue;
      const cell = sheet.cells[key] ?? {};
      const numeric = isNumericDisplay(cell.v, cell.fmt);
      const text = formatCellValue(cell.v, cell.fmt, display);
      const span = anchors.get(key);
      const attrs = [
        span && span.rows > 1 ? ` rowspan="${span.rows}"` : '',
        span && span.cols > 1 ? ` colspan="${span.cols}"` : '',
        (() => {
          const style = cellStyle(cell, ctx, numeric);
          return style ? ` style="${escapeHtml(style)}"` : '';
        })(),
        cell.note ? ` title="${escapeHtml(cell.note)}"` : '',
      ].join('');
      const tag = row < headerRows ? 'th' : 'td';
      const scope = tag === 'th' ? ' scope="col"' : '';
      cells.push(`<${tag}${scope}${attrs}>${escapeHtml(text)}</${tag}>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  const head = headerRows > 0 ? `<thead>${rows.slice(0, headerRows).join('')}</thead>` : '';
  const body = `<tbody>${rows.slice(headerRows).join('')}</tbody>`;
  return `<table class="ak-sheet-table">${caption}<colgroup>${cols.join('')}</colgroup>${head}${body}</table>`;
}

/** Static HTML document with one table per visible sheet (values formatted by locale). */
export function sheetToHtml(content: SheetContent, ctx: ExportContext): string {
  const display = { locale: ctx.locale, currency: resolveCurrency(content, ctx.locale) };
  const tables = content.sheets
    .filter((sheet) => !sheet.hidden)
    .map((sheet) => sheetTable(sheet, ctx, display));
  const style = `${themeCssText(ctx.theme)}
body { font-family: var(--ak-font-body); color: var(--ak-color-text); background: var(--ak-color-background); margin: 24px; }
.ak-sheet-table { border-collapse: collapse; table-layout: fixed; margin-bottom: 32px; font-size: 13px; }
.ak-sheet-table caption { text-align: left; font-weight: 700; padding: 4px 0; }
.ak-sheet-table td, .ak-sheet-table th { border: 1px solid #D9DEE3; padding: 2px 6px; overflow: hidden; white-space: nowrap; vertical-align: bottom; text-align: left; font-weight: 400; }
.ak-sheet-table th { background: var(--ak-color-surface); }`;
  return `<!doctype html>
<html lang="${escapeHtml(ctx.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)}</title>
<style>
${style}
</style>
</head>
<body>
${tables.join('\n')}
</body>
</html>
`;
}

export const sheetHtmlExporter: ArtifactExporter<SheetContent> = {
  kind: 'sheet',
  format: 'html',
  mimeType: 'text/html',
  extension: 'html',
  runtime: 'any',
  async export(content, ctx) {
    if (content.sheets.some((sheet) => sheet.hidden))
      ctx.warn('Hidden sheets are not included in the HTML export.');
    return new TextEncoder().encode(sheetToHtml(content, ctx));
  },
};
