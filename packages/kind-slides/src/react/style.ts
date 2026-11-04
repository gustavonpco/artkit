import { type Color, isColorToken, resolveColor, type Theme } from '@artkit/core';

/** CSS color for a token (theme variable with the resolved value as fallback) or a hex value. */
export function colorCss(theme: Theme, color: Color): string {
  if (isColorToken(color)) return `var(--ak-color-${color}, ${resolveColor(theme, color)})`;
  return resolveColor(theme, color);
}

export function fontCss(theme: Theme, font: 'heading' | 'body' | 'mono'): string {
  return `var(--ak-font-${font}, "${theme.fonts[font]}"), system-ui, sans-serif`;
}

/** Palette color for the n-th series or slice. */
export function paletteColor(theme: Theme, index: number): string {
  const palette = theme.chartPalette;
  const hex = palette[index % palette.length] ?? theme.colors.accent;
  return `var(--ak-chart-${(index % palette.length) + 1}, ${hex})`;
}
