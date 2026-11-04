import type { NormalizedParagraph } from './text.js';

/**
 * Text layout constants shared by the renderer (CSS), the pptx exporter and the overflow estimate, so the
 * estimate describes what is actually drawn.
 */
export const TEXT_BOX = {
  /** Horizontal inner padding, inches (PowerPoint's default 0.1"). */
  padX: 0.1,
  /** Vertical inner padding, inches (PowerPoint's default 0.05"). */
  padY: 0.05,
  /** Line height as a multiple of the font size ("single" spacing). */
  lineHeight: 1.2,
  /** Space after each paragraph, as a multiple of the font size. */
  paragraphSpacing: 0.3,
  /** Hanging indent per list level, points. */
  bulletIndentPt: 20,
} as const;

/** Average glyph width as a fraction of the em, per font family (regular weight, mixed-case text). */
const FONT_WIDTHS: [RegExp, number][] = [
  [/consolas|courier|mono|menlo|monaco/i, 0.6],
  [/calibri|carlito/i, 0.48],
  [/aptos/i, 0.51],
  [/segoe/i, 0.51],
  [/roboto|lato/i, 0.5],
  [/inter/i, 0.55],
  [/open sans|noto sans/i, 0.54],
  [/montserrat|poppins/i, 0.6],
  [/verdana|tahoma/i, 0.58],
  [/georgia/i, 0.54],
  [/times|tinos|garamond|serif/i, 0.46],
  [/arial|helvetica|liberation sans|arimo|system-ui|sans/i, 0.52],
];

const DEFAULT_WIDTH = 0.52;
const BOLD_FACTOR = 1.07;

export function averageCharWidth(fontFamily: string, bold = false): number {
  const match = FONT_WIDTHS.find(([pattern]) => pattern.test(fontFamily));
  return (match ? match[1] : DEFAULT_WIDTH) * (bold ? BOLD_FACTOR : 1);
}

/** Lines a text takes when wrapped greedily at word boundaries into `maxChars` per line. */
export function wrapLineCount(text: string, maxChars: number): number {
  const limit = Math.max(1, Math.floor(maxChars));
  let lines = 0;
  for (const hardLine of text.split(/\r?\n/)) {
    const words = hardLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let current = 0;
    let count = 1;
    for (const word of words) {
      const length = [...word].length;
      if (current === 0) {
        if (length > limit) {
          count += Math.ceil(length / limit) - 1;
          current = length % limit || limit;
        } else current = length;
      } else if (current + 1 + length <= limit) {
        current += 1 + length;
      } else {
        count += 1;
        if (length > limit) {
          count += Math.ceil(length / limit) - 1;
          current = length % limit || limit;
        } else current = length;
      }
    }
    lines += count;
  }
  return lines;
}

export interface TextFitInput {
  paragraphs: readonly NormalizedParagraph[];
  fontSize: number;
  fontFamily: string;
  bold?: boolean;
  /** Box size in inches. */
  width: number;
  height: number;
}

export interface TextFit {
  lines: number;
  /** Estimated height of the text including padding, inches. */
  height: number;
  /** Height available in the box, inches. */
  available: number;
  fits: boolean;
  /** Estimated height divided by the box height (>1 means overflow). */
  ratio: number;
}

/** Tolerance before reporting overflow: the estimate is approximate by design. */
export const OVERFLOW_TOLERANCE = 1.04;

/** Estimates how much vertical space a text takes in a box (spec §11.3: average character width per font). */
export function estimateTextFit(input: TextFitInput): TextFit {
  const sizePt = input.fontSize;
  const widthPt = Math.max(0, input.width - 2 * TEXT_BOX.padX) * 72;
  let lines = 0;
  for (const paragraph of input.paragraphs) {
    const indentPt = paragraph.list ? TEXT_BOX.bulletIndentPt * (paragraph.level + 1) : 0;
    const bold = input.bold || paragraph.runs.every((run) => run.bold);
    const charWidthPt = sizePt * averageCharWidth(input.fontFamily, bold);
    const maxChars = Math.max(1, (widthPt - indentPt) / charWidthPt);
    lines += wrapLineCount(paragraph.runs.map((run) => run.text).join(''), maxChars);
  }
  const spacing = Math.max(0, input.paragraphs.length - 1) * sizePt * TEXT_BOX.paragraphSpacing;
  const textHeight = (lines * sizePt * TEXT_BOX.lineHeight + spacing) / 72 + 2 * TEXT_BOX.padY;
  const available = input.height;
  const ratio = available > 0 ? textHeight / available : Number.POSITIVE_INFINITY;
  return { lines, height: textHeight, available, fits: ratio <= OVERFLOW_TOLERANCE, ratio };
}

/** Estimated height of a table, inches: each row is as tall as its tallest wrapped cell. */
export function estimateTableHeight(options: {
  rows: readonly (readonly string[])[];
  widths: readonly number[];
  fontSize: number;
  fontFamily: string;
  headerRows: number;
}): number {
  const cellPadX = 0.08;
  const cellPadY = 0.05;
  let total = 0;
  options.rows.forEach((row, rowIndex) => {
    let maxLines = 1;
    row.forEach((cell, col) => {
      const widthPt = Math.max(0.1, (options.widths[col] ?? 1) - 2 * cellPadX) * 72;
      const bold = rowIndex < options.headerRows;
      const maxChars = widthPt / (options.fontSize * averageCharWidth(options.fontFamily, bold));
      maxLines = Math.max(maxLines, wrapLineCount(cell, maxChars));
    });
    total += (maxLines * options.fontSize * TEXT_BOX.lineHeight) / 72 + 2 * cellPadY;
  });
  return total;
}
