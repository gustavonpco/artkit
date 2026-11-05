/**
 * Styles of the Markdown view and editor, laid out like a word processor: a command ribbon above a page on a neutral
 * canvas. Every value comes from theme variables (`--ak-*`), so the page follows the light and dark themes (Mouts
 * design system: 1px hairlines, no shadows, 6px controls, 12px cards).
 */
export const markdownCss = `
.ak-markdown { color: var(--ak-color-text); font-family: var(--ak-font-body); font-size: 14px; line-height: 1.5; }
.ak-word { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--ak-color-border-soft); border-radius: var(--ak-radius-card, 12px); background: var(--ak-color-surface); overflow: hidden; }
.ak-word-ribbon { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 12px; background: var(--ak-color-background); border-bottom: 1px solid var(--ak-color-border-soft); }
.ak-word-group { display: inline-flex; align-items: center; gap: 2px; padding-right: 12px; border-right: 1px solid var(--ak-color-border-soft); }
.ak-word-group:last-child { border-right: 0; padding-right: 0; }
fieldset.ak-word-group { margin: 0; min-width: 0; border: 0; border-right: 1px solid var(--ak-color-border-soft); border-radius: 0; }
fieldset.ak-word-group:last-child { border-right: 0; padding-right: 0; }
.ak-word-command { min-width: 32px; padding: 0 8px; font-size: 14px; }
.ak-word-command[aria-pressed="true"] { background: var(--ak-color-fill-accent); color: var(--ak-color-accent); border-color: transparent; }
.ak-word-style { min-width: 150px; height: 32px; }
.ak-word-draft { margin-left: auto; padding-right: 0; border-right: 0; }
.ak-word-status { font-size: 12px; color: var(--ak-color-muted); white-space: nowrap; padding: 0 8px; }
.ak-word-save { height: 32px; }
.ak-word-command svg { width: 16px; height: 16px; }
.ak-word-alert { min-width: 120px; height: 32px; }
.ak-word-link { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex-basis: 100%; padding: 4px 0 8px; }
.ak-word-link-input { flex: 1; min-width: 220px; height: 32px; padding: 0 10px; font: inherit; font-size: 14px; color: var(--ak-color-text); background: var(--ak-color-background); border: 1px solid var(--ak-color-border); border-radius: var(--ak-radius-sm, 6px); }
.ak-word-link-input:focus-visible { outline: 2px solid var(--ak-color-focus); outline-offset: 2px; }
.ak-word-canvas { flex: 1; min-height: 0; overflow: auto; padding: 32px 16px; }
.ak-word-page { position: relative; box-sizing: border-box; max-width: 794px; min-height: 1123px; margin: 0 auto; padding: 72px 80px; background: var(--ak-color-background); border: 1px solid var(--ak-color-border-soft); border-radius: var(--ak-radius-sm, 6px); }
.ak-word-view .ak-word-canvas { padding: 0; overflow: visible; }
.ak-word-view .ak-word-page { min-height: 0; border-color: transparent; background: transparent; padding: 0; }
.ak-markdown .ProseMirror { outline: none; min-height: 880px; font-family: var(--ak-font-body); font-size: 15px; line-height: 1.6; color: var(--ak-color-text); }
.ak-markdown .ProseMirror:focus-visible { outline: none; }
.ak-markdown .ProseMirror p { margin: 0 0 12px; }
.ak-markdown .ProseMirror h1, .ak-markdown .ProseMirror h2, .ak-markdown .ProseMirror h3 { font-family: var(--ak-font-heading); color: var(--ak-color-text); line-height: 1.25; font-weight: 700; }
.ak-markdown .ProseMirror h1 { font-size: 28px; margin: 0 0 16px; }
.ak-markdown .ProseMirror h2 { font-size: 22px; margin: 28px 0 12px; }
.ak-markdown .ProseMirror h3 { font-size: 18px; margin: 22px 0 8px; }
.ak-markdown .ProseMirror ul, .ak-markdown .ProseMirror ol { margin: 0 0 12px; padding-left: 24px; }
.ak-markdown .ProseMirror li > p { margin: 0 0 4px; }
.ak-markdown .ProseMirror blockquote { margin: 0 0 12px; padding: 4px 16px; border-left: 3px solid var(--ak-color-accent); color: var(--ak-color-muted); }
.ak-markdown .ProseMirror code { font-family: var(--ak-font-mono); font-size: 0.9em; padding: 1px 5px; border-radius: 4px; background: var(--ak-color-hover); }
.ak-markdown .ProseMirror pre { margin: 0 0 12px; padding: 12px 16px; overflow: auto; background: var(--ak-color-surface); border: 1px solid var(--ak-color-border-soft); border-radius: var(--ak-radius-md, 8px); }
.ak-markdown .ProseMirror pre code { padding: 0; background: none; font-size: 13px; }
.ak-markdown .ProseMirror hr { margin: 24px 0; border: 0; border-top: 1px solid var(--ak-color-border-soft); }
.ak-markdown .ProseMirror a { color: var(--ak-color-accent); text-decoration: underline; text-underline-offset: 2px; }
.ak-markdown .ProseMirror table { width: 100%; margin: 0 0 16px; border-collapse: collapse; }
.ak-markdown .ProseMirror th, .ak-markdown .ProseMirror td { border: 1px solid var(--ak-color-border-soft); padding: 6px 10px; text-align: left; vertical-align: top; }
.ak-markdown .ProseMirror th { background: var(--ak-color-hover); font-weight: 600; }
@media (max-width: 640px) {
  .ak-word-canvas { padding: 16px 8px; }
  .ak-word-page { padding: 32px 20px; min-height: 0; }
  .ak-markdown .ProseMirror { min-height: 480px; }
}
`;
