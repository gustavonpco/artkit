import { createLibrary } from '@openuidev/lang-core';
import { uiComponents, VISUAL_ROOTS } from './catalog.js';

export * from './catalog.js';

/** The artkit OpenUI library. The root of a visual artifact is one of `VISUAL_ROOTS`. */
export const uiLibrary = createLibrary({ components: [...uiComponents], root: 'Deck' });

export { createLibrary };
export const DEFAULT_VISUAL_ROOT = 'Deck';
export const visualRoots: readonly string[] = VISUAL_ROOTS;
