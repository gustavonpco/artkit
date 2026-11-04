import { runsText } from './runs.js';
import type { Block, HeadingBlock } from './schema.js';

export interface TocEntry {
  id: string;
  level: number;
  text: string;
}

export const DEFAULT_TOC_LEVEL = 3;

/** Headings listed by a table of contents (computed, never stored). */
export function tocEntries(blocks: readonly Block[], maxLevel: number = DEFAULT_TOC_LEVEL): TocEntry[] {
  return blocks
    .filter((block): block is HeadingBlock => block.type === 'heading' && block.level <= maxLevel)
    .map((block) => ({
      id: block.id,
      level: block.level,
      text: runsText(block.runs).replace(/\s+/g, ' ').trim(),
    }))
    .filter((entry) => entry.text !== '');
}
