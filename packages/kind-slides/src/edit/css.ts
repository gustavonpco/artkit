import { slidesCss } from '../react/css.js';

/** Editor styles (includes the renderer styles). Class names use the `ak-slides-` prefix. */
export const slidesEditorCss = `${slidesCss}
.ak-slides-editor { container: ak-slides-editor / inline-size; display: flex; flex-direction: column; gap: 8px; font-family: var(--ak-font-body, "Sora", "Segoe UI", system-ui, sans-serif); color: var(--ak-color-text, #1d2f3c); }
.ak-slides-editor-main { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ak-slides-panel .ak-slides-thumb { width: 100%; }
.ak-slides-canvas:focus-visible { outline: 2px solid var(--ak-color-focus, #0f7a5a); outline-offset: 2px; }
.ak-slides-editor-body { display: grid; grid-template-columns: 200px minmax(0, 1fr) 300px; gap: 12px; align-items: start; }
.ak-slides-panel { display: flex; flex-direction: column; gap: 8px; max-height: 80vh; overflow-y: auto; padding: 8px; border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-md, 8px); background: var(--ak-color-background, #fff); }
.ak-slides-panel li { position: relative; display: flex; flex-direction: column; }
.ak-slides-thumb-actions { position: absolute; top: 4px; right: 4px; display: flex; gap: 0; margin: 0; padding: 2px; border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-background, #fff); box-shadow: 0 2px 8px rgba(29,47,60,0.16); opacity: 0; pointer-events: none; transition: opacity .15s; min-inline-size: 0; }
.ak-slides-panel li:hover .ak-slides-thumb-actions, .ak-slides-panel li:focus-within .ak-slides-thumb-actions { opacity: 1; pointer-events: auto; }
.ak-slides-thumb-actions .ak-ctl-button[data-icon-only][data-size="sm"] { width: 24px; height: 24px; }
.ak-slides-insert { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--ak-color-border, #dde0e2); }
.ak-slides-inspector { position: sticky; top: 56px; }
.ak-slides-inspector .ak-ctl-swatches { gap: 4px; }
.ak-slides-inspector .ak-ctl-swatch { width: 22px; height: 22px; }
.ak-slides-richtext-bar { position: absolute; bottom: 100%; left: 0; margin-bottom: 6px; flex-wrap: nowrap; padding: 4px; gap: 2px; white-space: nowrap; box-shadow: 0 4px 16px rgba(29,47,60,0.18); }
.ak-slides-richtext-bar .ak-tb-button { min-width: 28px; height: 28px; padding: 0 4px; }
.ak-slides-richtext-sep { width: 1px; align-self: stretch; margin: 2px 4px; background: var(--ak-color-border, #dde0e2); }
.ak-slides-richtext-colors { display: inline-flex; gap: 3px; align-items: center; }
.ak-slides-richtext-colors .ak-ctl-swatch { width: 18px; height: 18px; border-radius: 50%; }
.ak-slides-grid input { width: 80px; height: 28px; border: 0; border-radius: 0; padding: 0 6px; background: transparent; color: inherit; font: inherit; font-size: 12px; }
.ak-slides-grid input:focus { outline: 2px solid var(--ak-color-focus, #0f7a5a); outline-offset: -2px; }
.ak-slides-grid th input { font-weight: 700; }
.ak-slides-grid th, .ak-slides-grid td { background: var(--ak-color-background, #fff); }
.ak-slides-grid th { background: var(--ak-color-surface, #f4f7f7); }
.ak-slides-items { display: flex; flex-direction: column; gap: 8px; }
.ak-slides-inline { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; font-weight: 600; color: var(--ak-color-muted, #56636d); }
.ak-slides-inline input { width: 72px; }
.ak-slides-drop-target { box-shadow: 0 -3px 0 var(--ak-color-primary, #00dd80); }
.ak-slides-canvas { position: relative; outline: none; border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-md, 8px); }
.ak-slides-overlay { position: absolute; inset: 0; z-index: 2; }
.ak-slides-hit, .ak-slides-slot-box { position: absolute; cursor: move; }
.ak-slides-slot-box { cursor: pointer; border: 1px dashed transparent; }
.ak-slides-slot-box:hover, .ak-slides-hit:hover { outline: 1px dashed color-mix(in srgb, var(--ak-color-primary, #00dd80) 70%, transparent); outline-offset: 1px; }
.ak-slides-slot-empty { border-color: var(--ak-color-border-strong, #8e979d); display: flex; align-items: center; justify-content: center; }
.ak-slides-slot-placeholder { color: var(--ak-color-muted, #56636d); font-size: 1.4cqw; pointer-events: none; }
.ak-slides-selected { outline: 2px solid var(--ak-color-primary-deep, #16a683) !important; }
.ak-slides-overflow { outline: 2px dashed var(--ak-color-danger, #9f343a); }
.ak-slides-overflow-badge { position: absolute; top: -0.9cqw; right: -0.9cqw; width: 1.8cqw; height: 1.8cqw; border-radius: 50%; background: var(--ak-color-danger, #9f343a); color: #fff; font-size: 1.2cqw; line-height: 1.8cqw; text-align: center; font-weight: 700; pointer-events: none; }
.ak-slides-readonly .ak-slides-hit, .ak-slides-readonly .ak-slides-slot-box { cursor: default; }
.ak-slides-guide { position: absolute; pointer-events: none; background: var(--ak-color-primary, #00dd80); }
.ak-slides-guide-x { width: 1px; margin-left: -0.5px; }
.ak-slides-guide-y { height: 1px; margin-top: -0.5px; }
.ak-slides-grid-lines { position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(to right, color-mix(in srgb, var(--ak-color-primary, #00dd80) 18%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--ak-color-primary, #00dd80) 18%, transparent) 1px, transparent 1px); }
.ak-slides-richtext { position: absolute; z-index: 5; }
.ak-slides-richtext-area { display: flex; flex-direction: column; outline: 2px solid var(--ak-color-primary-deep, #16a683); outline-offset: 1px; background: var(--ak-slides-bg, var(--ak-color-background, #fff)); caret-color: var(--ak-color-primary, #00dd80); white-space: pre-wrap; overflow-wrap: break-word; cursor: text; }
.ak-slides-edit-p { margin: 0 0 0.3em; min-height: 1.2em; }
.ak-slides-edit-p:last-child { margin-bottom: 0; }
.ak-slides-edit-p[data-list="bullet"] { display: list-item; list-style-type: disc; }
.ak-slides-edit-p[data-list="number"] { display: list-item; list-style-type: decimal; }
.ak-slides-grid { display: flex; flex-direction: column; gap: 6px; overflow-x: auto; }
.ak-slides-grid table { border-collapse: collapse; }
.ak-slides-grid td, .ak-slides-grid th { padding: 0; border: 1px solid var(--ak-color-border, #dde0e2); }
.ak-slides-chart-preview { width: 100%; aspect-ratio: 4 / 2.4; border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-sm, 6px); }
.ak-slides-issues { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.ak-slides-issue { font-size: 12px; padding: 4px 6px; border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-fill-warning, #f1f0ea); color: var(--ak-color-warning, #73692f); border: 1px solid var(--ak-color-warning, #73692f); }
.ak-slides-issue-info { background: var(--ak-color-fill-info, #f4f5f5); color: var(--ak-color-text, #1d2f3c); border-color: var(--ak-color-border, #dde0e2); }
@container ak-slides-editor (max-width: 1040px) { .ak-slides-editor-body { grid-template-columns: 160px minmax(0, 1fr); } .ak-slides-inspector { grid-column: 1 / -1; position: static; max-height: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); } .ak-slides-inspector > .ak-ctl-section { border-top: 0; border-left: 1px solid var(--ak-color-border, #dde0e2); } .ak-slides-inspector > .ak-ctl-section:first-child { border-left: 0; } }
@container ak-slides-editor (max-width: 640px) { .ak-slides-editor-body { grid-template-columns: 1fr; } .ak-slides-panel { max-height: none; } .ak-slides-panel .ak-slides-thumbs-vertical { flex-direction: row; overflow-x: auto; } .ak-slides-panel li { width: 140px; flex: 0 0 auto; } }
`;
