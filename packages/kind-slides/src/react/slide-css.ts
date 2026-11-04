import { CANVAS } from '../geometry.js';

/**
 * Slide styles without the shared toolbar/control styles (used by the HTML export). Renderer styles as a string (no CSS imports, so it works without a bundler and in headless export).
 * Class names use the `ak-slides-` prefix; colors and fonts come from the theme variables.
 */
export const slidesBaseCss = `
.ak-slides { display: flex; flex-direction: column; gap: 12px; font-family: var(--ak-font-body, "Sora", "Segoe UI", system-ui, sans-serif); color: var(--ak-color-text, #1d2f3c); }
.ak-slides-slide { position: relative; width: 100%; aspect-ratio: ${CANVAS.width} / ${CANVAS.height}; container-type: inline-size; overflow: hidden; background: var(--ak-color-background, #fff); box-sizing: border-box; }
.ak-slides-slide *, .ak-slides-slide *::before, .ak-slides-slide *::after { box-sizing: border-box; }
.ak-slides-el { position: absolute; margin: 0; }
.ak-slides-text, .ak-slides-shape { display: flex; flex-direction: column; overflow: visible; overflow-wrap: break-word; white-space: pre-wrap; }
.ak-slides-heading { font-size: inherit; }
.ak-slides-heading .ak-slides-p { display: block; }
.ak-slides-p { margin: 0 0 0.3em; }
.ak-slides-p:last-child { margin-bottom: 0; }
.ak-slides-list { margin: 0 0 0.3em; padding: 0; list-style-position: outside; }
.ak-slides-list:last-child { margin-bottom: 0; }
.ak-slides-li { margin: 0 0 0.3em; padding-left: 0.15em; }
.ak-slides-li:last-child { margin-bottom: 0; }
ul.ak-slides-list > .ak-slides-li { list-style-type: disc; }
ul.ak-slides-list > .ak-slides-li[data-level="1"], ul.ak-slides-list > .ak-slides-li[data-level="3"] { list-style-type: circle; }
.ak-slides-line { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.ak-slides-image img { display: block; width: 100%; height: 100%; }
.ak-slides-image-missing { display: flex; align-items: center; justify-content: center; text-align: center; padding: 1cqw; background: repeating-linear-gradient(45deg, var(--ak-color-surface, #f4f7f7) 0 1cqw, transparent 1cqw 2cqw); border: 0.1cqw dashed var(--ak-color-muted, #56636d); color: var(--ak-color-muted, #56636d); font-size: 1.2cqw; }
.ak-slides-table table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; line-height: 1.2; }
.ak-slides-table th, .ak-slides-table td { border: 0.08cqw solid; text-align: left; vertical-align: middle; overflow-wrap: break-word; }
.ak-slides-table th { font-weight: 700; }
.ak-slides-chart { display: block; width: 100%; height: 100%; overflow: visible; }
.ak-slides-hidden { opacity: 0.55; }
.ak-slides-provisional { outline: 2px dashed var(--ak-color-muted, #56636d); outline-offset: -2px; }
.ak-slides-stage { position: relative; }
.ak-slides-thumb { font: inherit; cursor: pointer; }
.ak-slides-counter { padding: 0 6px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ak-color-muted, #56636d); }
.ak-slides-viewer { display: block; width: 100%; max-width: min(100%, calc((100vh - 240px) * ${CANVAS.width} / ${CANVAS.height}), 1200px); margin: 0 auto; border-radius: var(--ak-radius-md, 8px); }
.ak-slides-viewer .ak-slides-slide, .ak-slides-thumb .ak-slides-slide, .ak-slides-overview-item .ak-slides-slide { box-shadow: 0 0 0 1px var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-sm, 6px); }
.ak-slides-thumbs { display: flex; gap: 8px; overflow-x: auto; padding: 4px; margin: 0; list-style: none; }
.ak-slides-thumbs-vertical { flex-direction: column; overflow-x: visible; overflow-y: auto; }
.ak-slides-thumb { position: relative; flex: 0 0 auto; width: 160px; padding: 0; border: 2px solid transparent; border-radius: var(--ak-radius-sm, 6px); background: none; text-align: left; overflow: hidden; }
.ak-slides-thumb[aria-current="true"] { border-color: var(--ak-color-primary, #00dd80); }
.ak-slides-thumb .ak-slides-slide { outline: 1px solid var(--ak-color-border, #dde0e2); outline-offset: -1px; pointer-events: none; }
.ak-slides-thumb-number { position: absolute; left: 6px; bottom: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700; background: var(--ak-brand-to, #1d2f3c); color: #fff; }
.ak-slides-notes { padding: 12px 16px; border: 1px solid var(--ak-color-border, #dde0e2); border-left: 3px solid var(--ak-color-primary, #00dd80); border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-surface, #f4f7f7); white-space: pre-wrap; }
.ak-slides-overview { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin: 0; padding: 4px; list-style: none; }
.ak-slides-overview-item { position: relative; display: block; width: 100%; padding: 0; border: 2px solid transparent; border-radius: var(--ak-radius-sm, 6px); background: none; font: inherit; cursor: pointer; overflow: hidden; }
.ak-slides-overview-item:hover { border-color: var(--ak-color-border-strong, #8e979d); }
.ak-slides-overview-item[aria-current="true"] { border-color: var(--ak-color-primary, #00dd80); }
.ak-slides-overview-item .ak-slides-slide { outline: 1px solid var(--ak-color-border, #dde0e2); outline-offset: -1px; pointer-events: none; }
.ak-slides-notes-empty { color: var(--ak-color-muted, #56636d); font-style: italic; }
.ak-slides-viewer:focus-visible, .ak-slides-thumb:focus-visible, .ak-slides-overview-item:focus-visible { outline: 2px solid var(--ak-color-focus, #0f7a5a); outline-offset: 2px; }
.ak-slides-presentation { position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--ak-brand-to, #1d2f3c); color: #fff; }
.ak-slides-presentation-stage { width: min(100vw, calc(100vh * ${CANVAS.width} / ${CANVAS.height})); }
.ak-slides-presentation-bar { position: absolute; bottom: 8px; right: 12px; display: flex; gap: 12px; align-items: center; font-size: 13px; opacity: 0.75; }
.ak-slides-presentation-bar button { display: inline-flex; align-items: center; gap: 6px; font: inherit; color: inherit; background: rgba(255,255,255,0.12); border: 0; border-radius: var(--ak-radius-sm, 6px); padding: 4px 10px; cursor: pointer; }
.ak-slides-presentation-notes { position: absolute; left: 0; right: 0; bottom: 40px; max-height: 30vh; overflow: auto; margin: 0 auto; width: min(900px, 90vw); padding: 12px 16px; background: rgba(29,47,60,0.94); border-radius: var(--ak-radius-md, 8px); white-space: pre-wrap; }
.ak-slides-presenter { flex-direction: row; gap: 24px; padding: 24px 24px 56px; align-items: stretch; }
.ak-slides-presenter .ak-slides-presentation-stage { flex: 1 1 auto; width: auto; max-width: calc((100vh - 80px) * ${CANVAS.width} / ${CANVAS.height}); align-self: center; }
.ak-slides-presenter-side { flex: 0 0 min(34vw, 420px); display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: auto; }
.ak-slides-presenter-side > h2 { margin: 4px 0 0; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ak-color-primary-soft, #5afab4); }
.ak-slides-presenter-timer { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 40px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ak-slides-presenter-timer button { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; color: inherit; background: rgba(255,255,255,0.12); border: 0; border-radius: var(--ak-radius-sm, 6px); padding: 6px 10px; cursor: pointer; }
.ak-slides-presenter-timer svg, .ak-slides-presentation-bar svg { width: 16px; height: 16px; }
.ak-slides-presenter-next .ak-slides-slide, .ak-slides-presenter .ak-slides-presentation-stage .ak-slides-slide { outline: 1px solid rgba(255,255,255,0.24); border-radius: var(--ak-radius-sm, 6px); }
.ak-slides-presenter-notes { margin: 0; padding: 12px 14px; font-size: 18px; line-height: 1.5; white-space: pre-wrap; background: rgba(255,255,255,0.08); border-radius: var(--ak-radius-md, 8px); }
.ak-slides-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.ak-slides-print { display: block; }
.ak-slides-print .ak-slides-page { width: ${CANVAS.width}in; height: ${CANVAS.height}in; overflow: hidden; break-after: page; page-break-after: always; }
.ak-slides-print .ak-slides-page:last-child { break-after: auto; page-break-after: auto; }
.ak-slides-print .ak-slides-slide { width: ${CANVAS.width}in; }
@media print {
  @page { size: ${CANVAS.width}in ${CANVAS.height}in; margin: 0; }
  .ak-slides-print .ak-slides-slide { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;
