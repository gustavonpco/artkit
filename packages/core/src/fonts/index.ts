import { SORA_UNICODE_RANGE, SORA_WOFF2_BASE64 } from './sora-data.js';

/** Font stack of the Mouts design system (the default artkit typography). */
export const DEFAULT_FONT_STACK = '"Sora", "Segoe UI", system-ui, sans-serif';

/**
 * `@font-face` for the embedded Sora variable font (weights 100–800, latin subset) as a data URL.
 * No network request is made, so it also works in headless export, which blocks the network.
 */
export function soraFontFaceCss(family = 'Sora'): string {
  const name = family.replace(/["'\\;{}<>\n\r]/g, '');
  return `@font-face{font-family:"${name}";font-style:normal;font-weight:100 800;font-display:swap;src:url(data:font/woff2;base64,${SORA_WOFF2_BASE64}) format("woff2-variations"),url(data:font/woff2;base64,${SORA_WOFF2_BASE64}) format("woff2");unicode-range:${SORA_UNICODE_RANGE};}`;
}

/** Raw font bytes, for exporters that embed fonts (e.g. PDF tooling). */
export function soraFontBytes(): Uint8Array {
  const binary = atob(SORA_WOFF2_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
