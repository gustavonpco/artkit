import { mixHex, type Theme } from '@artkit-ai/core';
import { type Theme as UniverTheme, defaultTheme as univerDefaultTheme } from '@univerjs/presets';

/**
 * Univer theme built from an artkit theme (Mouts design system, spec §7.3): the chrome of the spreadsheet (ribbon,
 * formula bar, tabs, menus, selection) takes the brand green, the graphite greys and the status colors of the artkit
 * theme. Each Univer scale is a ramp from the background to the text color, with the artkit color at the 500 step, so the
 * same function serves the light and the dark themes.
 */
type Scale = Record<string, string>;

function ramp(keys: number[], anchorKey: number, anchor: string, light: string, dark: string): Scale {
  const first = keys[0] ?? 0;
  const last = keys[keys.length - 1] ?? 1000;
  const out: Scale = {};
  for (const key of keys) {
    out[String(key)] =
      key <= anchorKey
        ? mixHex(light, anchor, (key - first) / (anchorKey - first || 1))
        : mixHex(anchor, dark, (key - anchorKey) / (last - anchorKey || 1));
  }
  return out;
}

function keysOf(scale: Record<string, string>): number[] {
  return Object.keys(scale)
    .map(Number)
    .sort((a, b) => a - b);
}

export function univerThemeFrom(theme: Theme): UniverTheme {
  const { background, text, accent, info, danger, warning, success } = theme.colors;
  const neutral = mixHex(background, text, 0.5);
  const scaled = (group: 'blue' | 'red' | 'orange' | 'yellow' | 'green' | 'primary', color: string): Scale =>
    ramp(keysOf(univerDefaultTheme[group]), 500, color, background, text);
  return {
    ...univerDefaultTheme,
    primary: scaled('primary', accent),
    gray: ramp(keysOf(univerDefaultTheme.gray), 500, neutral, background, text),
    blue: scaled('blue', info),
    red: scaled('red', danger),
    orange: scaled('orange', warning),
    yellow: scaled('yellow', warning),
    green: scaled('green', success),
  } as UniverTheme;
}

/** Dark when the background of the artkit theme is darker than mid-grey (relative luminance, sRGB). */
export function isDarkTheme(theme: Theme): boolean {
  const hex = theme.colors.background.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255 < 0.5;
}

/** Applies the artkit theme to a running Univer instance: colors and the dark flag of its interface. */
export function applyUniverTheme(
  api: { setTheme(theme: UniverTheme): void; toggleDarkMode(dark: boolean): void },
  theme: Theme,
): void {
  api.setTheme(univerThemeFrom(theme));
  api.toggleDarkMode(isDarkTheme(theme));
}
