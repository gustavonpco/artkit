/** Styles of the spreadsheet grid. Colors come from theme tokens (spec §7.3). */
export const sheetCss = `
.ak-sheet { color: var(--ak-color-text, #111); font-family: var(--ak-font-body, system-ui, sans-serif); }
.ak-sheet-scroll { overflow: auto; max-width: 100%; }
.ak-sheet table { border-collapse: collapse; font-size: 0.875rem; }
.ak-sheet th, .ak-sheet td { border: 1px solid var(--ak-color-border, #d0d0d0); padding: 0.25rem 0.5rem; min-width: 6rem; text-align: left; white-space: nowrap; }
.ak-sheet thead th, .ak-sheet tbody th { background: var(--ak-color-surface-muted, #f5f5f5); font-weight: 600; }
.ak-sheet td { text-align: right; }
.ak-sheet-editor input { width: 100%; border: 0; background: transparent; font: inherit; color: inherit; }
.ak-sheet-editor input:focus-visible { outline: 2px solid var(--ak-color-accent, #2563eb); }
.ak-sheet-editor [role="tab"][aria-selected="true"] { font-weight: 600; }
`;
