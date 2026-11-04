import type { LintIssue } from './kind.js';
import { COLOR_TOKENS, mixHex, safeFontFamily, type Theme, themeBrand, themeShape } from './theme.js';

/**
 * Framework-neutral contracts shared by every kind's `/react` renderer and `/edit` editor and by
 * `@artkit-ai/react`. They live in the core so kinds and the host agree without importing React here.
 */
export interface RenderContext {
  theme: Theme;
  locale: string;
  /** `print` renders page breaks and fixed sizes for headless PDF/PNG export. */
  mode: 'screen' | 'print';
  /** True while showing a streaming preview that is not committed yet (spec §13.4). */
  provisional?: boolean;
  /** Synchronous asset lookup; returns a URL (or data URL) for `asset://` references. */
  resolveAssetUrl?(ref: string): string | undefined;
}

export interface EmitOptions {
  /**
   * `continuous` marks the end of a gesture (drag, resize) that produced a single operation;
   * `typing` lets the host batch keystrokes inside the grouping window (spec §13.6).
   */
  kind?: 'discrete' | 'continuous' | 'typing';
}

/**
 * What a kind editor receives. Editors are controlled: they render `content` and turn every interaction
 * into kind operations through `emit`, never writing whole content (spec §13.6). Batching, optimistic
 * apply, undo/redo, conflicts and locks are handled by the host (`@artkit-ai/react`).
 */
export interface EditorBindings<Content = unknown, Operation = unknown> {
  content: Content;
  ctx: RenderContext;
  emit(operations: Operation[], options?: EmitOptions): void;
  readOnly: boolean;
  /** Lint issues of the current version, for inline indicators. */
  lint?: LintIssue[];
}

/** Default CSS class prefix for every artkit component (spec §13.5). */
export const CSS_PREFIX = 'ak';

/** CSS font stacks for a theme (Mouts fallbacks: Segoe UI, then the system font). */
export function themeFontStacks(theme: Theme): { heading: string; body: string; mono: string } {
  const sans = (name: string) => `"${safeFontFamily(name)}", "Segoe UI", system-ui, sans-serif`;
  return {
    heading: sans(theme.fonts.heading),
    body: sans(theme.fonts.body),
    mono: `"${safeFontFamily(theme.fonts.mono)}", ui-monospace, SFMono-Regular, Menlo, monospace`,
  };
}

/**
 * CSS custom properties for a theme. Besides the semantic colors (`--ak-color-accent`…), it emits the
 * design-system tokens every component uses: hairline borders, hover/active tones, focus ring, brand
 * gradients, radii and font stacks. Values are plain hex/px (no color-mix), so they also work in
 * headless rendering and older engines.
 */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  const { colors } = theme;
  const brand = themeBrand(theme);
  const shape = themeShape(theme);
  const fonts = themeFontStacks(theme);
  for (const token of COLOR_TOKENS) vars[`--ak-color-${token}`] = colors[token];
  // Hairline tones: the design system draws every boundary with a 1px line of the text color.
  vars['--ak-color-border'] = mixHex(colors.background, colors.text, 0.15);
  vars['--ak-color-border-strong'] = mixHex(colors.background, colors.text, 0.5);
  vars['--ak-color-hover'] = mixHex(colors.background, colors.text, 0.06);
  vars['--ak-color-active'] = mixHex(colors.background, colors.text, 0.1);
  vars['--ak-color-selected'] = mixHex(colors.background, brand.primary, 0.12);
  vars['--ak-color-fill-accent'] = mixHex(colors.background, colors.success, 0.1);
  vars['--ak-color-fill-warning'] = mixHex(colors.background, colors.warning, 0.12);
  vars['--ak-color-fill-danger'] = mixHex(colors.background, colors.danger, 0.1);
  vars['--ak-color-fill-info'] = mixHex(colors.background, colors.info, 0.08);
  vars['--ak-color-primary'] = brand.primary;
  vars['--ak-color-primary-deep'] = brand.primaryDeep;
  vars['--ak-color-primary-soft'] = brand.primarySoft;
  vars['--ak-color-on-primary'] = brand.onPrimary;
  vars['--ak-color-focus'] = brand.focus;
  vars['--ak-brand-from'] = brand.gradientFrom;
  vars['--ak-brand-to'] = brand.gradientTo;
  vars['--ak-color-card-from'] = brand.cardFrom;
  vars['--ak-color-card-to'] = brand.cardTo;
  vars['--ak-gradient-button'] = `linear-gradient(180deg, ${brand.primary}, ${brand.primaryDeep})`;
  vars['--ak-gradient-button-hover'] = `linear-gradient(180deg, ${brand.primarySoft}, ${brand.primary})`;
  vars['--ak-gradient-button-active'] = `linear-gradient(180deg, ${brand.primaryDeep}, ${brand.primary})`;
  vars['--ak-gradient-brand'] = `linear-gradient(135deg, ${brand.gradientFrom}, ${brand.gradientTo})`;
  vars['--ak-gradient-card'] = `linear-gradient(135deg, ${brand.cardFrom}, ${brand.cardTo})`;
  vars['--ak-radius'] = `${shape.radius}px`;
  vars['--ak-radius-md'] = `${Math.round((shape.radius * 2) / 3)}px`;
  vars['--ak-radius-sm'] = `${Math.round(shape.radius / 2)}px`;
  vars['--ak-radius-pill'] = `${shape.radiusPill}px`;
  vars['--ak-font-heading'] = fonts.heading;
  vars['--ak-font-body'] = fonts.body;
  vars['--ak-font-mono'] = fonts.mono;
  theme.chartPalette.forEach((color, index) => {
    vars[`--ak-chart-${index + 1}`] = color;
  });
  return vars;
}

/** Same variables as a CSS declaration block, for server-rendered pages and headless export. */
export function themeCssText(theme: Theme, selector = ':root'): string {
  const body = Object.entries(themeCssVariables(theme))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}
