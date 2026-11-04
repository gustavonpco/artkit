import { sheetCss } from '../react/css.js';

/** Renderer styles plus the editor chrome (toolbar, formula bar, suggestions, dialogs). */
export const sheetEditorCss = `${sheetCss}
.ak-sheet-bar-input { flex: 1; min-width: 0; font-family: var(--ak-font-mono, ui-monospace, monospace); font-size: 13px; border: 1px solid transparent; padding: 2px 4px; background: transparent; color: inherit; }
.ak-sheet-bar-input:focus { border-color: var(--ak-color-accent, #0f7a5a); outline: none; }
.ak-sheet-preview { color: var(--ak-color-muted, #56636d); font-family: var(--ak-font-mono, ui-monospace, monospace); white-space: nowrap; }
.ak-sheet-formula-tokens { padding: 2px 72px; font-family: var(--ak-font-mono, ui-monospace, monospace); font-size: 12px; white-space: pre; overflow: hidden; color: var(--ak-color-muted, #56636d); }
.ak-sheet-assist { position: relative; z-index: 10; }
.ak-sheet-suggestion span { color: var(--ak-color-muted, #56636d); }
.ak-sheet-signature { margin: 0; padding: 2px 72px; font-size: 12px; color: var(--ak-color-muted, #56636d); }
.ak-sheet-editor-overlay { pointer-events: none; }
.ak-sheet-editor-overlay > * { pointer-events: auto; }
.ak-sheet-cell-input { box-sizing: border-box; width: 100%; height: 100%; min-width: 120px; border: 2px solid var(--ak-color-accent, #0f7a5a); padding: 1px 3px; font: inherit; background: var(--ak-color-background, #FFFFFF); color: inherit; outline: none; }
.ak-sheet-dropdown { position: absolute; top: 0; right: 0; width: 20px; height: 100%; opacity: 0.6; border: none; background: transparent; cursor: pointer; }
.ak-sheet-dropdown:focus, .ak-sheet-dropdown-open { opacity: 1; width: auto; min-width: 100%; background: var(--ak-color-background, #FFFFFF); }
.ak-sheet-status { min-height: 18px; padding: 0 8px; font-size: 12px; color: var(--ak-color-muted, #56636d); }
.ak-sheet-tablist { display: flex; gap: 2px; overflow-x: auto; }
.ak-sheet-editor > .ak-tb { border-width: 0 0 1px; border-radius: 0; }
.ak-sheet-suggestions { position: absolute; left: 72px; top: 0; margin: 0; padding: 4px; list-style: none; background: var(--ak-color-background, #FFFFFF); border: 1px solid var(--ak-color-border-strong, #8e979d); border-radius: var(--ak-radius-md, 8px); box-shadow: 0 8px 24px rgba(29,47,60,0.18); max-width: 560px; }
.ak-sheet-suggestion { padding: 6px 10px; border-radius: var(--ak-radius-sm, 6px); cursor: pointer; font-size: 12px; }
.ak-sheet-suggestion[aria-selected="true"] { background: var(--ak-color-fill-accent, #e7f2ef); color: var(--ak-color-accent, #0f7a5a); }
.ak-sheet-tabs { display: flex; align-items: center; gap: 8px; }
.ak-sheet-tab-input { width: 140px; height: 28px; padding: 0 8px; font: inherit; font-size: 13px; color: var(--ak-color-text, #1d2f3c); background: var(--ak-color-background, #fff); border: 1px solid var(--ak-color-accent, #0f7a5a); border-radius: var(--ak-radius-sm, 6px); outline: none; box-shadow: 0 0 0 1px var(--ak-color-accent, #0f7a5a); }
.ak-sheet-tab-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.ak-sheet-tab-actions .ak-ctl-select { width: auto; }
.ak-sheet-dialog { position: absolute; top: 48px; left: 50%; transform: translateX(-50%); z-index: 20; display: flex; flex-direction: column; gap: 12px; min-width: 340px; max-width: min(520px, 92%); padding: 20px; background: var(--ak-color-background, #FFFFFF); color: var(--ak-color-text, #1d2f3c); border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius, 12px); box-shadow: 0 16px 48px rgba(29,47,60,0.24); }
.ak-sheet-dialog h2 { margin: 0; font-family: var(--ak-font-heading, "Sora", system-ui, sans-serif); font-size: 16px; font-weight: 700; }
.ak-sheet-dialog p { margin: 0; }
.ak-sheet-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.ak-sheet-names-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
.ak-sheet-names-form .ak-ctl-button { grid-column: 1 / -1; justify-self: start; }
.ak-sheet-names { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.ak-sheet-names li { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-surface, #f4f7f7); }
.ak-sheet-names li .ak-ctl-button { margin-left: auto; }
.ak-sheet-names code { font-family: var(--ak-font-mono, ui-monospace, monospace); font-size: 12px; }
`;
