import { z } from 'zod';

/** Color tokens shared by every kind (spec §6.4). Tokens are preferred over hex values. */
export const COLOR_TOKENS = [
  'text',
  'muted',
  'accent',
  'background',
  'surface',
  'info',
  'warning',
  'success',
  'danger',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const colorTokenSchema = z.enum(COLOR_TOKENS);
export const hexColorSchema = z.string().regex(HEX, 'Use a theme token or a hex color like #14AB83.');
export const colorSchema = z
  .union([colorTokenSchema, hexColorSchema])
  .describe(`Theme token (${COLOR_TOKENS.join(', ')}) or hex color "#RRGGBB". Prefer tokens.`);

export type Color = z.infer<typeof colorSchema>;

// Font names end up in CSS and in Office files; quotes, escapes and CSS syntax characters are refused.
const FONT_FAMILY = /^[^"'`\\;:{}()<>[\]\n\r@]{1,80}$/u;

export const fontFamilySchema = z
  .string()
  .trim()
  .regex(FONT_FAMILY, 'Use a plain font family name such as "Calibri" or "Noto Sans".');

/** Removes characters that could break out of a CSS string, for fonts that bypassed the schema. */
export function safeFontFamily(name: string): string {
  return name.replace(/["'`\\;:{}()<>[\]\n\r@]/g, '').trim() || 'sans-serif';
}

/** Brand tokens beyond the semantic colors: primary fills, gradients and the focus ring. */
export const brandSchema = z.object({
  /** Fill of the primary action (start of the button gradient). Never used as text on light surfaces. */
  primary: hexColorSchema,
  /** End of the button gradient. */
  primaryDeep: hexColorSchema,
  /** Light brand tone for hover and fine highlights. */
  primarySoft: hexColorSchema,
  /** Text and icons placed on `primary`. */
  onPrimary: hexColorSchema,
  /** Brand gradient (decorative surfaces such as covers and sidebars). */
  gradientFrom: hexColorSchema,
  gradientTo: hexColorSchema,
  /** Card gradient (cards, stat panels, steps). */
  cardFrom: hexColorSchema,
  cardTo: hexColorSchema,
  /** Focus ring color (2px with a 2px offset). */
  focus: hexColorSchema,
});

export const shapeSchema = z.object({
  /** Corner radius of cards and panels, in px. */
  radius: z.number().min(0).max(48),
  /** Radius of pill buttons, in px. */
  radiusPill: z.number().min(0).max(64),
});

export const themeSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(80).optional(),
  colors: z.object(
    Object.fromEntries(COLOR_TOKENS.map((token) => [token, hexColorSchema])) as Record<
      ColorToken,
      typeof hexColorSchema
    >,
  ),
  fonts: z.object({ heading: fontFamilySchema, body: fontFamilySchema, mono: fontFamilySchema }),
  chartPalette: z.array(hexColorSchema).min(1).max(24),
  /** Optional brand tokens; derived from `colors` when absent. */
  brand: brandSchema.optional(),
  /** Optional shape tokens; 12px cards and pill buttons when absent. */
  shape: shapeSchema.optional(),
});

export type Theme = z.infer<typeof themeSchema>;
export type ThemeBrand = z.infer<typeof brandSchema>;
export type ThemeShape = z.infer<typeof shapeSchema>;

/**
 * The default theme is the Mouts design system (light): graphite text on white, the institutional green
 * darkened to #0F7A5A wherever it is text (5.3:1 on white), Sora typography, 12px cards, pill buttons with
 * the green gradient. Colors that the design system derives with color-mix are resolved to hex here.
 */
export const defaultTheme: Theme = {
  id: 'default',
  label: 'Mouts',
  colors: {
    text: '#1D2F3C',
    muted: '#56636D',
    accent: '#0F7A5A',
    background: '#FFFFFF',
    surface: '#F4F7F7',
    info: '#1D2F3C',
    warning: '#73692F',
    success: '#0F7A5A',
    danger: '#9F343A',
  },
  fonts: { heading: 'Sora', body: 'Sora', mono: 'Consolas' },
  chartPalette: ['#179A7C', '#1D2F3C', '#0F7A5A', '#73692F', '#56636D'],
  brand: {
    primary: '#00DD80',
    primaryDeep: '#16A683',
    primarySoft: '#5AFAB4',
    onPrimary: '#1D2F3C',
    gradientFrom: '#14AB83',
    gradientTo: '#1D2F3C',
    cardFrom: '#F4F7F7',
    cardTo: '#E7EFEE',
    focus: '#0F7A5A',
  },
  shape: { radius: 12, radiusPill: 24 },
};

/** Dark variant of the Mouts design system (its brand theme): graphite background, white text, bright green. */
export const defaultDarkTheme: Theme = {
  id: 'default-dark',
  label: 'Mouts (escuro)',
  colors: {
    text: '#FFFFFF',
    muted: '#C6CBCE',
    accent: '#00DD80',
    background: '#1D2F3C',
    surface: '#1A313D',
    info: '#FFFFFF',
    warning: '#F3C11B',
    success: '#00DD80',
    danger: '#FA9C9C',
  },
  fonts: { heading: 'Sora', body: 'Sora', mono: 'Consolas' },
  chartPalette: ['#16A683', '#FFFFFF', '#5AFAB4', '#F3C11B', '#C6CBCE'],
  brand: {
    primary: '#00DD80',
    primaryDeep: '#16A683',
    primarySoft: '#5AFAB4',
    onPrimary: '#1D2F3C',
    gradientFrom: '#14AB83',
    gradientTo: '#1D2F3C',
    cardFrom: '#1A313D',
    cardTo: '#0C3E40',
    focus: '#5AFAB4',
  },
  shape: { radius: 12, radiusPill: 24 },
};

/** Brand tokens of a theme, derived from its colors when the theme does not declare them. */
export function themeBrand(theme: Theme): ThemeBrand {
  return (
    theme.brand ?? {
      primary: theme.colors.accent,
      primaryDeep: theme.colors.accent,
      primarySoft: theme.colors.accent,
      onPrimary: theme.colors.background,
      gradientFrom: theme.colors.accent,
      gradientTo: theme.colors.text,
      cardFrom: theme.colors.surface,
      cardTo: theme.colors.surface,
      focus: theme.colors.accent,
    }
  );
}

export function themeShape(theme: Theme): ThemeShape {
  return theme.shape ?? { radius: 12, radiusPill: 24 };
}

/** Linear mix of two hex colors in sRGB; `amount` is the share of `b` (0 to 1). */
export function mixHex(a: string, b: string, amount: number): string {
  const ca = normalizeHex(a).slice(1);
  const cb = normalizeHex(b).slice(1);
  let out = '#';
  for (const i of [0, 2, 4]) {
    const x = Number.parseInt(ca.slice(i, i + 2), 16);
    const y = Number.parseInt(cb.slice(i, i + 2), 16);
    out += Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, '0');
  }
  return out.toUpperCase();
}

export function isColorToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

/** Resolves a token or hex color to a normalized `#RRGGBB` value. */
export function resolveColor(theme: Theme, color: Color | undefined, fallback: ColorToken = 'text'): string {
  const raw =
    color === undefined ? theme.colors[fallback] : isColorToken(color) ? theme.colors[color] : color;
  return normalizeHex(raw);
}

export function normalizeHex(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return `#${full.toUpperCase()}`;
}

/** CSS variable name for a token (`--ak-color-accent`), used by renderers (spec §13.5). */
export function cssVar(token: ColorToken): string {
  return `--ak-color-${token}`;
}

/** Relative luminance per WCAG 2.1. */
export function luminance(hex: string): number {
  const value = normalizeHex(hex).slice(1);
  const channels = [0, 2, 4].map((i) => {
    const c = Number.parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
