import { kitCss } from '@artkit-ai/react';

/** Styles of the sheet renderer (class prefix `ak-sheet-`, colors from theme CSS variables). */
export const sheetCss = `${kitCss}
.ak-sheet { border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-md, 8px); overflow: hidden; display: flex; flex-direction: column; min-height: 0; height: 100%; font-family: var(--ak-font-body, "Sora", "Segoe UI", system-ui, sans-serif); font-size: 13px; color: var(--ak-color-text, #1d2f3c); background: var(--ak-color-background, #FFFFFF); position: relative; }
.ak-sheet-provisional .ak-sheet-grid { opacity: 0.85; }
.ak-sheet-provisional-label { position: absolute; top: 4px; right: 8px; font-size: 11px; color: var(--ak-color-muted, #56636d); }
.ak-sheet-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ak-sheet-formula-bar { margin: 0; border: 0; border-bottom: 1px solid var(--ak-color-border, #dde0e2); display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 2px 8px; background: var(--ak-color-background, #FFFFFF); }
.ak-sheet-address { min-width: 56px; font-family: var(--ak-font-mono, ui-monospace, monospace); color: var(--ak-color-muted, #56636d); }
.ak-sheet-formula-text { flex: 1; font-family: var(--ak-font-mono, ui-monospace, monospace); white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.ak-sheet-panel { flex: 1; min-height: 0; display: flex; }
.ak-sheet-scroller { position: relative; flex: 1; min-height: 240px; height: 480px; overflow: auto; outline: none; }
.ak-sheet-canvas { position: relative; }
.ak-sheet-grid { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; border-spacing: 0; outline: none; }
.ak-sheet-grid thead, .ak-sheet-grid tbody { display: block; }
.ak-sheet-grid:focus-visible { box-shadow: inset 0 0 0 2px var(--ak-color-focus, #0f7a5a); }
.ak-sheet-header-row { position: absolute; display: block; left: 0; height: 24px; z-index: 4; }
.ak-sheet-corner { position: absolute; display: block; padding: 0; top: 0; width: 48px; height: 24px; background: var(--ak-color-surface, #f4f7f7); border-right: 1px solid var(--ak-color-border, #dde0e2); border-bottom: 1px solid var(--ak-color-border, #dde0e2); z-index: 5; }
.ak-sheet-col-header, .ak-sheet-row-header { position: absolute; display: flex; align-items: center; justify-content: center; box-sizing: border-box; background: var(--ak-color-surface, #f4f7f7); color: var(--ak-color-muted, #56636d); font-size: 11px; font-weight: 600; border-right: 1px solid var(--ak-color-border, #dde0e2); border-bottom: 1px solid var(--ak-color-border, #dde0e2); user-select: none; font-weight: 400; padding: 0; }
.ak-sheet-col-header { top: 0; height: 24px; }
.ak-sheet-row-header { top: 0; width: 48px; z-index: 3; }
.ak-sheet-header-selected { background: var(--ak-color-selected, #e0faf0); color: var(--ak-color-accent, #0f7a5a); font-weight: 700; }
.ak-sheet-col-resize { position: absolute; top: 0; right: -3px; width: 6px; height: 100%; cursor: col-resize; z-index: 1; }
.ak-sheet-row-resize { position: absolute; left: 0; bottom: -3px; width: 100%; height: 6px; cursor: row-resize; z-index: 1; }
.ak-sheet-row { position: absolute; display: block; left: 0; }
.ak-sheet-row-frozen { z-index: 3; }
.ak-sheet-cell { position: absolute; display: flex; align-items: flex-end; justify-content: flex-start; box-sizing: border-box; padding: 2px 4px; overflow: hidden; white-space: nowrap; background: var(--ak-color-background, #FFFFFF); border-right: 1px solid var(--ak-color-border, #dde0e2); border-bottom: 1px solid var(--ak-color-border, #dde0e2); line-height: 1.3; }
.ak-sheet-cell-text { overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ak-sheet-cell-error { color: var(--ak-color-danger, #9f343a); }
.ak-sheet-cell-selected { background-image: linear-gradient(var(--ak-color-selected, #e0faf0), var(--ak-color-selected, #e0faf0)); }
.ak-sheet-note-mark { position: absolute; top: 0; right: 0; border-style: solid; border-width: 0 6px 6px 0; border-color: transparent var(--ak-color-warning, #73692f) transparent transparent; }
.ak-sheet-lint-mark { position: absolute; top: 0; left: 0; border-style: solid; border-width: 6px 6px 0 0; border-color: var(--ak-color-accent, #0f7a5a) transparent transparent transparent; }
.ak-sheet-selection { position: absolute; box-sizing: border-box; border: 2px solid var(--ak-color-accent, #0f7a5a); pointer-events: none; z-index: 2; }
.ak-sheet-highlight { position: absolute; box-sizing: border-box; border: 2px dashed; pointer-events: none; z-index: 2; }
.ak-sheet-fill-preview { position: absolute; box-sizing: border-box; border: 1px dashed var(--ak-color-muted, #56636d); pointer-events: none; z-index: 2; }
.ak-sheet-fill-handle { position: absolute; width: 8px; height: 8px; background: var(--ak-color-accent, #0f7a5a); border: 1px solid var(--ak-color-background, #FFFFFF); cursor: crosshair; z-index: 3; }
.ak-sheet-editor-overlay { position: absolute; z-index: 6; }
.ak-sheet-tabs { display: flex; gap: 2px; padding: 4px 8px; border-top: 1px solid var(--ak-color-border, #dde0e2); background: var(--ak-color-surface, #f4f7f7); overflow-x: auto; }
.ak-sheet-tab { height: 28px; border: 1px solid transparent; border-radius: var(--ak-radius-sm, 6px); background: transparent; color: var(--ak-color-muted, #56636d); padding: 0 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ak-sheet-tab:hover { background: var(--ak-color-hover, #f2f3f4); color: var(--ak-color-text, #1d2f3c); }
.ak-sheet-tab[aria-selected="true"] { background: var(--ak-color-background, #FFFFFF); color: var(--ak-color-text, #1d2f3c); border-color: var(--ak-color-border, #dde0e2); box-shadow: inset 0 -2px 0 var(--ak-color-primary, #00dd80); }
.ak-sheet-tab:focus-visible, .ak-sheet button:focus-visible, .ak-sheet select:focus-visible, .ak-sheet input:focus-visible { outline: 2px solid var(--ak-color-focus, #0f7a5a); outline-offset: 2px; }
.ak-sheet-print { display: block; height: auto; }
.ak-sheet-print-sheet { break-after: page; page-break-after: always; }
.ak-sheet-print-sheet:last-child { break-after: auto; page-break-after: auto; }
.ak-sheet-table { border-collapse: collapse; font-size: 11px; }
.ak-sheet-table caption { text-align: left; font-weight: 700; padding: 4px 0; }
.ak-sheet-table td, .ak-sheet-table th { border: 1px solid var(--ak-color-border, #dde0e2); padding: 2px 6px; white-space: nowrap; text-align: left; font-weight: 400; vertical-align: bottom; }

.ak-sheet-reading { border: 0; border-bottom: 1px solid var(--ak-color-border, #dde0e2); border-radius: 0; }
.ak-sheet-search { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px; border: 1px solid var(--ak-color-border-strong, #8e979d); border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-background, #FFFFFF); color: var(--ak-color-muted, #56636d); }
.ak-sheet-search:focus-within { border-color: var(--ak-color-accent, #0f7a5a); box-shadow: 0 0 0 1px var(--ak-color-accent, #0f7a5a); }
.ak-sheet-search svg { width: 16px; height: 16px; }
.ak-sheet-search input { width: 180px; border: 0; outline: none; background: transparent; font: inherit; font-size: 13px; color: var(--ak-color-text, #1d2f3c); }
.ak-sheet-search input:focus, .ak-sheet-search input:focus-visible { outline: none; box-shadow: none; }
.ak-sheet-search-count { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ak-sheet-statusbar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 16px; min-height: 28px; align-items: center; padding: 4px 12px; border-top: 1px solid var(--ak-color-border, #dde0e2); font-size: 12px; color: var(--ak-color-muted, #56636d); font-variant-numeric: tabular-nums; }
`;
