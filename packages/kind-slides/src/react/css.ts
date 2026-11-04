import { kitCss } from '@artkit/react';
import { slidesBaseCss } from './slide-css.js';

/**
 * Renderer styles as a string (no CSS imports, so it works without a bundler and in headless export):
 * the shared toolbar and control styles plus the `ak-slides-` rules. Colors and fonts come from theme variables.
 */
export const slidesCss = `${kitCss}${slidesBaseCss}`;
