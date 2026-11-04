import { COLOR_TOKENS } from '@artkit/core';
import { kitCss } from '@artkit/react';
import { NEUTRAL_STROKE, NODE_TINT } from '../draw.js';

const tint = Math.round(NODE_TINT * 100);
const neutral = Math.round(NEUTRAL_STROKE * 100);

const tones = COLOR_TOKENS.map(
  (token) =>
    `.ak-diagram-tone-${token} { --ak-diagram-tone: var(--ak-color-${token}); --ak-diagram-tone-fill: color-mix(in srgb, var(--ak-color-${token}) ${tint}%, var(--ak-color-background)); }`,
).join('\n');

/** Styles of `DiagramRenderer`. Colors come from the theme variables (`--ak-color-*`) set by the host or the renderer. */
export const diagramCss = `${kitCss}
.ak-diagram {
  --ak-diagram-tone: color-mix(in srgb, var(--ak-color-text) ${neutral}%, var(--ak-color-background));
  --ak-diagram-tone-fill: var(--ak-color-surface);
  position: relative;
  margin: 0;
  color: var(--ak-color-text);
  font-family: var(--ak-font-body, "Sora", "Segoe UI", system-ui, sans-serif);
}
.ak-diagram-viewport {
  overflow: hidden;
  border: 1px solid var(--ak-color-border);
  border-radius: var(--ak-radius-md, 8px);
  background: var(--ak-color-background);
  touch-action: none;
  cursor: grab;
}
.ak-diagram-viewport:focus-visible { outline: 2px solid var(--ak-color-focus); outline-offset: 2px; }
.ak-diagram-viewport[data-panning="true"] { cursor: grabbing; }
.ak-diagram-svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.ak-diagram--print .ak-diagram-viewport { cursor: default; overflow: visible; }
.ak-diagram--print { break-inside: avoid; page-break-inside: avoid; }
.ak-diagram--provisional { opacity: 0.85; }
.ak-diagram { display: flex; flex-direction: column; gap: 8px; }
.ak-diagram-search { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px; border: 1px solid var(--ak-color-border-strong, #8e979d); border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-background, #fff); color: var(--ak-color-muted, #56636d); }
.ak-diagram-search:focus-within { border-color: var(--ak-color-accent, #0f7a5a); box-shadow: 0 0 0 1px var(--ak-color-accent, #0f7a5a); }
.ak-diagram-search svg { width: 16px; height: 16px; flex-shrink: 0; }
.ak-diagram-search input { width: 160px; border: 0; outline: none; background: transparent; color: var(--ak-color-text, #1d2f3c); font: inherit; font-size: 13px; }
.ak-diagram-search input::-webkit-search-cancel-button { display: none; }
.ak-diagram-search input:focus, .ak-diagram-search input:focus-visible { outline: none; box-shadow: none; }
.ak-diagram-search-count { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ak-diagram-zoom { min-width: 44px; text-align: center; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ak-color-muted, #56636d); }
.ak-diagram-match { fill: none; stroke: var(--ak-color-primary, #00dd80); stroke-width: 2; stroke-dasharray: 5 4; }
.ak-diagram-match.is-current { stroke-width: 3; stroke-dasharray: none; fill: color-mix(in srgb, var(--ak-color-primary, #00dd80) 12%, transparent); }
.ak-diagram-tone-neutral { --ak-diagram-tone: color-mix(in srgb, var(--ak-color-text) ${neutral}%, var(--ak-color-background)); --ak-diagram-tone-fill: var(--ak-color-surface); }
${tones}
.ak-diagram-fill-none { fill: none; }
.ak-diagram-fill-nodeFill { fill: var(--ak-diagram-tone-fill); }
.ak-diagram-stroke-nodeStroke { stroke: var(--ak-diagram-tone); }
.ak-diagram-fill-nodeText { fill: var(--ak-color-text); }
.ak-diagram-stroke-edge { stroke: var(--ak-color-muted); }
.ak-diagram-fill-edgeText { fill: var(--ak-color-text); }
.ak-diagram-fill-labelBg { fill: var(--ak-color-background); }
.ak-diagram-fill-bandFill { fill: color-mix(in srgb, var(--ak-color-text) 3%, var(--ak-color-background)); }
.ak-diagram-stroke-bandStroke { stroke: color-mix(in srgb, var(--ak-color-text) 15%, var(--ak-color-background)); }
.ak-diagram-fill-boxFill { fill: var(--ak-color-background); }
.ak-diagram-stroke-boxStroke { stroke: color-mix(in srgb, var(--ak-color-text) 30%, var(--ak-color-background)); }
.ak-diagram-fill-groupText { fill: var(--ak-color-accent); }
.ak-diagram-group-label-text { font-weight: 700; letter-spacing: 0.04em; }
.ak-diagram-marker { fill: var(--ak-color-muted); }
.ak-diagram-node-label, .ak-diagram-edge-label, .ak-diagram-group-label-text { font-family: inherit; }
.ak-diagram-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;
