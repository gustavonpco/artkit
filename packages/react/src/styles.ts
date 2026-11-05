import {
  COLOR_TOKENS,
  defaultDarkTheme,
  defaultTheme,
  normalizeHex,
  type Theme,
  themeCssVariables,
} from '@artkit-ai/core';
import { kitCss } from './kit-css.js';

function channels(hex: string): [number, number, number] {
  const value = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** Linear mix of two hex colors; `amount` is the share of `b`. */
export function mixColors(a: string, b: string, amount: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return toHex([0, 1, 2].map((i) => ca[i]! + (cb[i]! - ca[i]!) * amount) as [number, number, number]);
}

/**
 * Dark variant of a theme (spec §13.5). The default (Mouts) theme has an official dark version; other
 * themes are derived: text and background swap, surfaces sit between them and status colors are
 * lightened so they keep contrast on the dark background.
 */
export function darkTheme(theme: Theme): Theme {
  if (theme.id === defaultTheme.id) return defaultDarkTheme;
  const { text, background } = theme.colors;
  const darkBackground = mixColors(text, '#000000', 0.55);
  const lighten = (color: string) => mixColors(color, '#FFFFFF', 0.3);
  return {
    ...theme,
    id: `${theme.id}-dark`,
    colors: {
      text: mixColors(background, text, 0.08),
      muted: mixColors(theme.colors.muted, background, 0.35),
      accent: lighten(theme.colors.accent),
      background: darkBackground,
      surface: mixColors(darkBackground, background, 0.08),
      info: lighten(theme.colors.info),
      warning: lighten(theme.colors.warning),
      success: lighten(theme.colors.success),
      danger: lighten(theme.colors.danger),
    },
    chartPalette: theme.chartPalette.map(lighten),
    ...(theme.brand
      ? {
          brand: {
            ...theme.brand,
            cardFrom: mixColors(darkBackground, background, 0.04),
            cardTo: mixColors(darkBackground, theme.brand.primaryDeep, 0.2),
            focus: theme.brand.primarySoft,
          },
        }
      : {}),
  };
}

// Theme values end up inside a <style> element. Colors are validated hex and fonts are sanitized by
// the core (safeFontFamily), gradients and radii are built from those values only.
function declarations(theme: Theme): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(themeCssVariables(theme))) parts.push(`${name}:${value};`);
  // Diff highlights used by the version comparison.
  parts.push(`--ak-color-added-bg:${mixColors(theme.colors.background, theme.colors.success, 0.14)};`);
  parts.push(`--ak-color-removed-bg:${mixColors(theme.colors.background, theme.colors.danger, 0.12)};`);
  return parts.join('');
}

function attr(value: string): string {
  return value.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r]/g, ' ');
}

/**
 * Theme variables for every known theme, light and dark. `.ak-root` takes the application theme;
 * `[data-ak-theme="<id>"]` takes an artifact theme. Dark applies with `prefers-color-scheme: dark` unless
 * `data-theme="light"` is set on the root or an ancestor, and always with `data-theme="dark"`.
 */
export function themeStyles(appTheme: Theme, themes: Theme[], dark: Map<string, Theme> = new Map()): string {
  const rules: string[] = [];
  const darkOf = (theme: Theme) => dark.get(theme.id) ?? darkTheme(theme);
  const entries: { selector: string; theme: Theme }[] = [
    { selector: '.ak-root', theme: appTheme },
    ...themes.map((theme) => ({ selector: `.ak-root[data-ak-theme="${attr(theme.id)}"]`, theme })),
  ];
  for (const { selector, theme } of entries)
    rules.push(`${selector}{${declarations(theme)}color-scheme:light;}`);
  const darkRules = entries.map(({ selector, theme }) => ({
    selector,
    body: `${declarations(darkOf(theme))}color-scheme:dark;`,
  }));
  rules.push(
    `@media (prefers-color-scheme: dark){${darkRules
      .map(
        ({ selector, body }) => `${selector}:not([data-theme="light"]):not([data-theme="light"] *){${body}}`,
      )
      .join('')}}`,
  );
  for (const { selector, body } of darkRules) {
    rules.push(`${selector}[data-theme="dark"],[data-theme="dark"] ${selector}{${body}}`);
  }
  return rules.join('\n');
}

/** Stable short hash used to key style resources (React 19 dedupes `<style href>` by key). */
export function hashString(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export const COLOR_VARIABLES = COLOR_TOKENS.map((token) => `--ak-color-${token}`);

/**
 * Base CSS of the host components, following the Mouts design system: Sora typography, 1px hairlines,
 * no shadows, 32px controls with 6px corners, a single filled (gradient) action per area, 2px focus
 * ring with a 2px offset, underlined tabs and pill badges. Every value comes from theme variables.
 */
export const artkitCss = `
.ak-root{color:var(--ak-color-text);background:var(--ak-color-background);font-family:var(--ak-font-body);font-size:14px;line-height:1.36;-webkit-font-smoothing:antialiased;box-sizing:border-box}
.ak-root *,.ak-root *::before,.ak-root *::after{box-sizing:inherit}
.ak-root :focus-visible{outline:2px solid var(--ak-color-focus);outline-offset:2px}
.ak-root svg.lucide{width:16px;height:16px;flex-shrink:0}
.ak-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ak-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:32px;padding:0 12px;font:inherit;font-weight:600;font-size:14px;white-space:nowrap;border:1px solid var(--ak-color-border);border-radius:var(--ak-radius-sm);background:var(--ak-color-background);color:var(--ak-color-text);cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}
.ak-button:hover:not(:disabled){background:var(--ak-color-hover);border-color:var(--ak-color-border-strong)}
.ak-button:active:not(:disabled){background:var(--ak-color-active)}
.ak-button:disabled{opacity:.4;cursor:not-allowed}
.ak-button[data-variant="primary"]{border-color:transparent;background:var(--ak-gradient-button);color:var(--ak-color-on-primary);border-radius:var(--ak-radius-pill)}
.ak-button[data-variant="primary"]:hover:not(:disabled){background:var(--ak-gradient-button-hover);border-color:transparent}
.ak-button[data-variant="primary"]:active:not(:disabled){background:var(--ak-gradient-button-active)}
.ak-button[data-variant="quiet"]{border-color:transparent;background:transparent;color:var(--ak-color-muted)}
.ak-button[data-variant="quiet"]:hover:not(:disabled){color:var(--ak-color-text);border-color:transparent}
.ak-button[data-variant="danger"]{border-color:transparent;background:transparent;color:var(--ak-color-danger)}
.ak-button[data-variant="danger"]:hover:not(:disabled){background:var(--ak-color-fill-danger);border-color:transparent}
.ak-button[data-size="sm"]{height:28px;padding:0 10px;font-size:12px}
.ak-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;line-height:16px;border:1px solid var(--ak-color-border);background:var(--ak-color-hover);color:var(--ak-color-muted);white-space:nowrap}
.ak-badge::before{content:"";display:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.ak-badge[data-status]::before{display:inline-block}
.ak-badge[data-status="pending_approval"]{color:var(--ak-color-warning);border-color:var(--ak-color-warning);background:var(--ak-color-fill-warning)}
.ak-badge[data-status="published"]{color:var(--ak-color-success);border-color:var(--ak-color-success);background:var(--ak-color-fill-accent)}
.ak-badge[data-status="archived"]{border-style:dashed;background:transparent}
.ak-badge[data-variant="provisional"]{color:var(--ak-color-accent);border-color:var(--ak-color-accent);background:var(--ak-color-fill-accent)}
.ak-alert{display:flex;gap:8px;align-items:flex-start;padding:12px;border-radius:var(--ak-radius-sm);border:1px solid var(--ak-color-danger);color:var(--ak-color-danger);background:var(--ak-color-fill-danger)}
.ak-notice{display:flex;gap:8px;align-items:flex-start;padding:12px;border-radius:var(--ak-radius-sm);border:1px solid var(--ak-color-border);color:var(--ak-color-text);background:var(--ak-color-surface)}
.ak-loading{display:flex;align-items:center;gap:8px;padding:16px;color:var(--ak-color-muted)}
.ak-loading::before{content:"";width:16px;height:16px;border-radius:50%;border:2px solid var(--ak-color-border);border-top-color:var(--ak-color-accent);animation:ak-spin .8s linear infinite}
@keyframes ak-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ak-loading::before{animation:none}}
.ak-code{margin:0;padding:16px;overflow:auto;font-family:var(--ak-font-mono);font-size:12px;line-height:1.5;background:var(--ak-color-surface);border:1px solid var(--ak-color-border);border-radius:var(--ak-radius-md);white-space:pre}
.ak-view{position:relative}
.ak-view[data-provisional="true"] .ak-view-body{opacity:.85}
.ak-view-badge{position:absolute;top:8px;right:8px;z-index:1}
.ak-card{display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--ak-color-border);border-radius:var(--ak-radius);background:var(--ak-gradient-card);max-width:480px;transition:border-color .15s}
.ak-card:hover{border-color:var(--ak-color-border-strong)}
.ak-card-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;flex-shrink:0;border-radius:var(--ak-radius-md);background:var(--ak-color-fill-accent);color:var(--ak-color-accent)}
.ak-card-icon svg{width:18px;height:18px}
.ak-card-body{flex:1;min-width:0}
.ak-card-title{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 4px;font-size:14px;font-family:var(--ak-font-heading)}
.ak-card-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;color:var(--ak-color-muted);font-size:12px}
.ak-panel{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--ak-color-background);border:1px solid var(--ak-color-border);border-radius:var(--ak-radius);overflow:hidden}
.ak-panel-header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:16px;border-bottom:1px solid var(--ak-color-border-soft)}
.ak-panel-title{flex:1;min-width:120px;margin:0;font-size:16px;line-height:22px;font-weight:700;font-family:var(--ak-font-heading)}
.ak-panel-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--ak-color-border-soft)}
.ak-panel-body{flex:1;min-height:0;overflow:auto;padding:16px}
.ak-tabs{display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--ak-color-border-soft);overflow-x:auto;scrollbar-width:none}
.ak-tab{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;font:inherit;font-size:14px;font-weight:600;border:0;border-bottom:2px solid transparent;background:none;color:var(--ak-color-muted);cursor:pointer;white-space:nowrap}
.ak-tab:hover{color:var(--ak-color-text)}
.ak-tab[aria-selected="true"]{color:var(--ak-color-text);border-bottom-color:var(--ak-color-primary)}
.ak-select{height:32px;font:inherit;font-size:14px;padding:0 10px;border:1px solid var(--ak-color-border-strong);border-radius:var(--ak-radius-sm);background:var(--ak-color-background);color:var(--ak-color-text);cursor:pointer}
.ak-select:hover{border-color:var(--ak-color-muted)}
.ak-menu{position:relative;display:inline-block}
.ak-menu-list{position:absolute;right:0;z-index:10;min-width:180px;margin:4px 0 0;padding:4px;list-style:none;background:var(--ak-color-background);border:1px solid var(--ak-color-border-strong);border-radius:var(--ak-radius-md)}
.ak-menu-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;padding:8px 10px;border:0;border-radius:var(--ak-radius-sm);background:none;color:var(--ak-color-text);cursor:pointer}
.ak-menu-item:hover,.ak-menu-item:focus{background:var(--ak-color-hover)}
.ak-history{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ak-history-entry{padding:12px;border:1px solid var(--ak-color-border);border-radius:var(--ak-radius-md);background:var(--ak-color-background)}
.ak-history-entry[aria-current="true"]{border-color:var(--ak-color-accent);background:var(--ak-color-fill-accent)}
.ak-history-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-weight:600}
.ak-history-meta{color:var(--ak-color-muted);font-size:12px;font-weight:400}
.ak-history-actions{display:flex;gap:6px;margin-left:auto}
.ak-changes{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.ak-change{display:flex;gap:8px;align-items:baseline;font-size:13px}
.ak-change-type{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;min-width:72px}
.ak-change[data-type="added"] .ak-change-type{color:var(--ak-color-success)}
.ak-change[data-type="removed"] .ak-change-type{color:var(--ak-color-danger)}
.ak-change[data-type="changed"] .ak-change-type{color:var(--ak-color-warning)}
.ak-change[data-type="moved"] .ak-change-type{color:var(--ak-color-info)}
.ak-change-target{font-family:var(--ak-font-mono);font-size:12px;color:var(--ak-color-muted)}
.ak-diff{display:flex;flex-direction:column;gap:12px}
.ak-diff-toolbar{display:flex;gap:4px;border:0;margin:0;padding:0;min-inline-size:0}
.ak-diff-lines{width:100%;border-collapse:collapse;font-family:var(--ak-font-mono);font-size:12px;table-layout:fixed;border:1px solid var(--ak-color-border);border-radius:var(--ak-radius-md)}
.ak-diff-lines td,.ak-diff-lines th{padding:2px 8px;vertical-align:top;white-space:pre-wrap;word-break:break-word}
.ak-diff-lines th{font-weight:normal;color:var(--ak-color-muted);text-align:right;width:3.5em;user-select:none}
.ak-diff-marker{width:1.5em;user-select:none;color:var(--ak-color-muted)}
.ak-diff-line[data-type="insert"],.ak-diff-cell[data-type="insert"]{background:var(--ak-color-added-bg)}
.ak-diff-line[data-type="delete"],.ak-diff-cell[data-type="delete"]{background:var(--ak-color-removed-bg)}
.ak-approval{display:flex;flex-direction:column;gap:16px}
.ak-approval-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
.ak-textarea{font:inherit;font-size:14px;width:100%;min-height:72px;padding:8px 12px;border:1px solid var(--ak-color-border-strong);border-radius:var(--ak-radius-sm);background:var(--ak-color-background);color:var(--ak-color-text);resize:vertical}
.ak-textarea:hover{border-color:var(--ak-color-muted)}
.ak-form{display:flex;flex-direction:column;gap:8px;width:100%}
.ak-editor{display:flex;flex-direction:column;gap:12px}
.ak-editor-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ak-editor-status{display:inline-flex;align-items:center;gap:6px;margin-left:auto;color:var(--ak-color-muted);font-size:12px}
.ak-conflict{padding:12px 16px;border:1px solid var(--ak-color-warning);border-radius:var(--ak-radius-md);background:var(--ak-color-fill-warning);display:flex;flex-direction:column;gap:8px}
.ak-conflict-title{margin:0;font-size:14px;font-weight:700}
${kitCss}
`;
