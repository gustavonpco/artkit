import type { DiagramNode, NodeShape } from './schema.js';

/** Typography shared by the layout, the renderer, the editor and the SVG exporter so sizes always agree. */
export const NODE_FONT_SIZE = 13;
export const NODE_LINE_HEIGHT = 17;
export const EDGE_FONT_SIZE = 12;
export const EDGE_LINE_HEIGHT = 15;
export const GROUP_FONT_SIZE = 12;
export const ICON_SIZE = 18;
export const ACTOR_FIGURE_HEIGHT = 40;

const PAD_X = 14;
const PAD_Y = 10;
const ICON_GAP = 8;

/** Maximum text width (px) before a label wraps, per shape. Narrow shapes wrap earlier. */
export const MAX_TEXT_WIDTH: Record<NodeShape, number> = {
  box: 168,
  round: 168,
  document: 168,
  cylinder: 160,
  diamond: 112,
  ellipse: 136,
  actor: 112,
};

/** Labels longer than this read badly in the shape (lint `label-too-long`). */
export const COMFORTABLE_LABEL_LENGTH: Record<NodeShape, number> = {
  box: 60,
  round: 60,
  document: 60,
  cylinder: 48,
  diamond: 32,
  ellipse: 40,
  actor: 28,
};

const NARROW = new Set([...'iljtfr.,;:!|\'"()[]{} ']);
const WIDE = new Set([...'mwMW@%&']);

/**
 * Deterministic text width estimate (no DOM measurement, so the server, the browser and the exporter agree).
 * Per-character classes are close enough for sans-serif UI fonts.
 */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) {
    if (NARROW.has(char)) em += 0.3;
    else if (WIDE.has(char)) em += 0.86;
    else if (char >= 'A' && char <= 'Z') em += 0.66;
    else if (char >= '0' && char <= '9') em += 0.56;
    else if (char.charCodeAt(0) > 0x2e80) em += 1;
    else em += 0.53;
  }
  return em * fontSize;
}

/** Greedy word wrap by estimated width; words longer than a line are broken by characters. */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    if (textWidth(word, fontSize) <= maxWidth) {
      current = word;
      return;
    }
    let chunk = '';
    for (const char of word) {
      if (chunk && textWidth(chunk + char, fontSize) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else chunk += char;
    }
    current = chunk;
  };
  for (const word of words) {
    if (!current) {
      pushWord(word);
      continue;
    }
    const candidate = `${current} ${word}`;
    if (textWidth(candidate, fontSize) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      pushWord(word);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function nodeLabelLines(node: Pick<DiagramNode, 'label' | 'shape'>): string[] {
  return wrapText(node.label, MAX_TEXT_WIDTH[node.shape], NODE_FONT_SIZE);
}

export function edgeLabelLines(label: string): string[] {
  return wrapText(label, 140, EDGE_FONT_SIZE);
}

export interface Size {
  width: number;
  height: number;
}

export function edgeLabelSize(label: string | undefined): Size {
  if (!label) return { width: 0, height: 0 };
  const lines = edgeLabelLines(label);
  const width = Math.max(...lines.map((line) => textWidth(line, EDGE_FONT_SIZE)));
  return { width: Math.ceil(width + 10), height: lines.length * EDGE_LINE_HEIGHT + 4 };
}

export function groupLabelWidth(label: string): number {
  return Math.ceil(textWidth(label.toUpperCase(), GROUP_FONT_SIZE) * 1.08 + 16);
}

const even = (value: number) => Math.ceil(value / 2) * 2;

/** Estimated node size from label length, shape and icon. */
export function estimateNodeSize(node: Pick<DiagramNode, 'label' | 'shape' | 'icon'>): Size {
  const lines = nodeLabelLines(node);
  const textW = Math.max(...lines.map((line) => textWidth(line, NODE_FONT_SIZE)));
  const textH = lines.length * NODE_LINE_HEIGHT;
  const hasIcon = node.icon !== undefined;
  switch (node.shape) {
    case 'diamond': {
      const iconH = hasIcon ? ICON_SIZE + 4 : 0;
      const height = Math.max(64, textH + iconH + 34);
      // Keeps the text rectangle inside the rhombus: w/W + h/H <= 1.
      const width = Math.max(104, (textW * height) / (height - textH - iconH) + 18);
      return { width: even(width), height: even(height) };
    }
    case 'ellipse': {
      const iconH = hasIcon ? ICON_SIZE + 4 : 0;
      return {
        width: even(Math.max(104, textW * 1.42 + 24)),
        height: even(Math.max(48, (textH + iconH) * 1.42 + 14)),
      };
    }
    case 'actor':
      return { width: even(Math.max(72, textW + 12)), height: even(ACTOR_FIGURE_HEIGHT + 8 + textH) };
    default: {
      const iconW = hasIcon ? ICON_SIZE + ICON_GAP : 0;
      const extra = node.shape === 'cylinder' ? 14 : node.shape === 'document' ? 8 : 0;
      return {
        width: even(Math.max(112, textW + iconW + PAD_X * 2)),
        height: even(Math.max(44, textH + PAD_Y * 2) + extra),
      };
    }
  }
}
