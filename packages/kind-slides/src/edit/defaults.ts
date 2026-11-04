import { CANVAS, type Rect } from '../geometry.js';
import type { ElementInput, SlotContent, SlotContentKind } from '../schema.js';

export type InsertKind = 'text' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'arrow' | 'table' | 'chart';

function centered(w: number, h: number, offset = 0): Rect {
  return { x: (CANVAS.width - w) / 2 + offset, y: (CANVAS.height - h) / 2 + offset, w, h };
}

/**
 * New element for an insert action. `offset` staggers repeated inserts so new elements do not stack exactly.
 * Labels are passed in so they follow the editor locale.
 */
export function newElement(
  kind: InsertKind,
  labels: { text: string; series: string },
  offset = 0,
): ElementInput {
  switch (kind) {
    case 'text':
      return { type: 'text', ...centered(5, 1, offset), paragraphs: [labels.text] };
    case 'rect':
    case 'roundRect':
    case 'ellipse':
      return {
        type: 'shape',
        shape: kind,
        ...centered(3, 2, offset),
        fill: 'surface',
        line: { color: 'muted', width: 1 },
      };
    case 'line':
    case 'arrow':
      return { type: 'shape', shape: kind, ...centered(3, 0, offset), line: { color: 'text', width: 2 } };
    case 'table':
      return {
        type: 'table',
        ...centered(8, 2.4, offset),
        header: ['A', 'B', 'C'],
        rows: [
          ['', '', ''],
          ['', '', ''],
        ],
      };
    case 'chart':
      return {
        type: 'chart',
        ...centered(7, 4, offset),
        chartType: 'column',
        categories: ['Q1', 'Q2', 'Q3'],
        series: [{ name: labels.series, values: [1, 2, 3] }],
      };
  }
}

export function newImageElement(asset: string, alt: string, offset = 0): ElementInput {
  return { type: 'image', ...centered(5, 3.5, offset), asset, alt, fit: 'contain' };
}

/** Starter content when the user switches a slot to another content kind. */
export function defaultSlotContent(
  kind: SlotContentKind,
  labels: { text: string; series: string },
): SlotContent | undefined {
  switch (kind) {
    case 'text':
      return labels.text;
    case 'bullets':
      return { type: 'bullets', items: [labels.text] };
    case 'table':
      return { type: 'table', header: ['A', 'B'], rows: [['', '']] };
    case 'chart':
      return {
        type: 'chart',
        chartType: 'column',
        categories: ['Q1', 'Q2', 'Q3'],
        series: [{ name: labels.series, values: [1, 2, 3] }],
      };
    case 'stats':
      return { type: 'stats', items: [{ value: '0%', label: labels.text }] };
    case 'steps':
      return { type: 'steps', items: [{ title: labels.text }] };
    case 'cards':
      return { type: 'cards', items: [{ title: labels.text }] };
    case 'quote':
      return { type: 'quote', text: labels.text };
    case 'image':
      // Images need an uploaded asset first.
      return undefined;
  }
}
