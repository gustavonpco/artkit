/** Styles of the visual components. Colors come from theme tokens (spec §7.3); charts read chart tokens. */
export const componentsCss = `
.ak-visual, .ak-deck, .ak-dashboard, .ak-report { color: var(--ak-color-text, #111); font-family: var(--ak-font-body, system-ui, sans-serif); }
.ak-slide { aspect-ratio: 16 / 9; width: 100%; box-sizing: border-box; padding: 3%; margin-bottom: 1rem; background: var(--ak-color-surface, #fff); border: 1px solid var(--ak-color-border, #d0d0d0); display: flex; flex-direction: column; justify-content: center; gap: 0.5rem; }
.ak-slide-title { align-items: center; text-align: center; }
.ak-slide .ak-title { font-size: clamp(1.5rem, 4vw, 2.5rem); font-family: var(--ak-font-heading, system-ui, sans-serif); }
.ak-notes { display: none; }
.ak-card { border: 1px solid var(--ak-color-border, #d0d0d0); border-radius: 8px; padding: 1rem; }
.ak-callout { border-left: 4px solid var(--ak-color-accent, #2563eb); padding: 0.5rem 1rem; background: var(--ak-color-surface-muted, #f5f5f5); }
.ak-callout-warning { border-color: var(--ak-color-warning, #d97706); }
.ak-callout-tip { border-color: var(--ak-color-success, #15803d); }
.ak-stat { display: flex; flex-direction: column; }
.ak-stat strong { font-size: 1.75rem; }
.ak-table { border-collapse: collapse; width: 100%; }
.ak-table th, .ak-table td { border: 1px solid var(--ak-color-border, #d0d0d0); padding: 0.4rem 0.6rem; text-align: left; }
.ak-chart-bars { display: flex; align-items: flex-end; gap: 0.5rem; height: 160px; }
.ak-chart-bar { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
.ak-chart-bar span { width: 100%; background: var(--ak-color-accent, #2563eb); min-height: 2px; }
.ak-chart-line { width: 100%; height: 160px; }
.ak-chart-pie { display: flex; gap: 1rem; align-items: center; }
.ak-chart-pie svg { width: 160px; height: 160px; }
.ak-badge { border-radius: 999px; padding: 0.1rem 0.6rem; background: var(--ak-color-surface-muted, #eee); }
.ak-badge-good { background: var(--ak-color-success, #15803d); color: #fff; }
.ak-badge-bad { background: var(--ak-color-danger, #b91c1c); color: #fff; }
.ak-badge-warning { background: var(--ak-color-warning, #d97706); color: #fff; }
.ak-prototype-nav button[aria-pressed="true"] { font-weight: 600; text-decoration: underline; }
.ak-modal { border: 1px solid var(--ak-color-border, #d0d0d0); padding: 1rem; border-radius: 8px; background: var(--ak-color-surface, #fff); }
`;
