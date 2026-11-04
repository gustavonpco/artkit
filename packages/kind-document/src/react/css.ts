/**
 * Styles of the document renderer (also embedded by the HTML exporter). Colors and fonts come from the
 * theme variables (`--ak-color-*`, `--ak-font-*`) set by the host with `themeCssVariables`.
 */
export const documentCss = `
.ak-document {
  --ak-doc-page-width: 210mm;
  --ak-doc-margin-top: 25mm;
  --ak-doc-margin-right: 20mm;
  --ak-doc-margin-bottom: 25mm;
  --ak-doc-margin-left: 20mm;
  box-sizing: border-box;
  max-width: var(--ak-doc-page-width);
  margin: 0 auto;
  padding: var(--ak-doc-margin-top) var(--ak-doc-margin-right) var(--ak-doc-margin-bottom) var(--ak-doc-margin-left);
  background: var(--ak-color-background, #fff);
  color: var(--ak-color-text, #1d2f3c);
  font-family: var(--ak-font-body, "Sora", "Segoe UI", system-ui, sans-serif);
  font-size: 10.5pt;
  line-height: 1.6;
  overflow-wrap: break-word;
}
.ak-document *, .ak-document *::before, .ak-document *::after { box-sizing: border-box; }
.ak-document--provisional { opacity: 0.85; }
.ak-document-running { color: var(--ak-color-muted, #56636d); font-size: 0.8em; }
.ak-document-running--header { border-bottom: 1px solid var(--ak-color-border, #dde0e2); padding-bottom: 0.4em; margin-bottom: 1.5em; }
.ak-document-running--footer { border-top: 1px solid var(--ak-color-border, #dde0e2); padding-top: 0.4em; margin-top: 2em; }
.ak-document-cover {
  position: relative;
  margin: 0 0 2.5em;
  padding: 3.5em 2.5em 2.5em;
  border-radius: var(--ak-radius, 12px);
  background: linear-gradient(to bottom left, var(--ak-brand-from, #14ab83), var(--ak-brand-to, #1d2f3c) 62%);
  color: #ffffff;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.ak-document .ak-document-cover-eyebrow { margin: 0 0 0.8em; color: var(--ak-color-primary, #00dd80); font-size: 0.8em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.ak-document .ak-document-cover-title { margin: 0; font-family: var(--ak-font-heading, "Sora", system-ui, sans-serif); font-size: 2.4em; font-weight: 700; line-height: 1.15; color: #ffffff; }
.ak-document .ak-document-cover-subtitle { margin: 0.6em 0 0; color: var(--ak-color-primary-soft, #5afab4); font-size: 1.2em; font-weight: 300; }
.ak-document-cover-fields { display: grid; grid-template-columns: max-content 1fr; gap: 0.35em 1.5em; margin: 2em 0 0; padding-top: 1.2em; border-top: 1px solid rgba(255, 255, 255, 0.25); }
.ak-document-cover-fields dt { color: rgba(255, 255, 255, 0.72); font-weight: 700; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; }
.ak-document-cover-fields dd { margin: 0; color: #ffffff; }
.ak-document h1, .ak-document h2, .ak-document h3, .ak-document h4 {
  font-family: var(--ak-font-heading, "Sora", system-ui, sans-serif);
  font-weight: 700;
  line-height: 1.3;
  color: var(--ak-color-text, #1d2f3c);
  margin: 1.6em 0 0.6em;
  break-after: avoid;
}
.ak-document h1 { font-size: 1.85em; letter-spacing: -0.01em; }
.ak-document h2 { font-size: 1.4em; padding-bottom: 0.35em; border-bottom: 1px solid var(--ak-color-border, #dde0e2); }
.ak-document h3 { font-size: 1.15em; color: var(--ak-color-accent, #0f7a5a); }
.ak-document h4 { font-size: 0.95em; color: var(--ak-color-muted, #56636d); text-transform: uppercase; letter-spacing: 0.04em; }
.ak-document p { margin: 0 0 0.9em; }
.ak-document strong { font-weight: 700; }
.ak-document a { color: var(--ak-color-accent, #0f7a5a); text-underline-offset: 3px; }
.ak-document code { font-family: var(--ak-font-mono, ui-monospace, monospace); font-size: 0.88em; background: var(--ak-color-surface, #f4f7f7); border: 1px solid var(--ak-color-border, #dde0e2); padding: 0.05em 0.35em; border-radius: var(--ak-radius-sm, 6px); }
.ak-document ul, .ak-document ol { margin: 0 0 0.9em; padding-left: 1.5em; }
.ak-document li { margin: 0.2em 0; }
.ak-document li::marker { color: var(--ak-color-accent, #0f7a5a); }
.ak-document li > ul, .ak-document li > ol { margin: 0.2em 0 0; }
.ak-document-table, .ak-document .tableWrapper { margin: 0 0 1.4em; overflow-x: auto; border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-md, 8px); }
.ak-document table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
.ak-document caption { caption-side: bottom; color: var(--ak-color-muted, #56636d); font-size: 0.85em; padding: 0.6em 0.8em; text-align: left; }
.ak-document th, .ak-document td { padding: 0.55em 0.8em; vertical-align: top; border-bottom: 1px solid var(--ak-color-border, #dde0e2); }
.ak-document tbody tr:last-child td, .ak-document tbody tr:last-child th { border-bottom: 0; }
.ak-document .tableWrapper table { margin: 0; }
.ak-document thead th, .ak-document th { background: var(--ak-color-surface, #f4f7f7); color: var(--ak-color-text, #1d2f3c); font-weight: 700; font-size: 0.92em; text-align: left; }
.ak-document tfoot td { background: var(--ak-color-surface, #f4f7f7); font-weight: 700; border-top: 1px solid var(--ak-color-border-strong, #8e979d); border-bottom: 0; }
.ak-document-callout { margin: 0 0 1em; padding: 0.85em 1em; border: 1px solid var(--ak-callout-color); border-radius: var(--ak-radius-md, 8px); background: var(--ak-callout-fill); }
.ak-document-callout--info { --ak-callout-color: var(--ak-color-info, #1d2f3c); --ak-callout-fill: var(--ak-color-fill-info, #f4f5f5); }
.ak-document-callout--warning { --ak-callout-color: var(--ak-color-warning, #73692f); --ak-callout-fill: var(--ak-color-fill-warning, #f1f0ea); }
.ak-document-callout--success { --ak-callout-color: var(--ak-color-success, #0f7a5a); --ak-callout-fill: var(--ak-color-fill-accent, #e7f2ef); }
.ak-document-callout--danger { --ak-callout-color: var(--ak-color-danger, #9f343a); --ak-callout-fill: var(--ak-color-fill-danger, #f5ebeb); }
.ak-document-callout-title { margin: 0 0 0.3em; font-weight: 700; color: var(--ak-callout-color); }
.ak-document-callout p:last-child { margin-bottom: 0; }
.ak-document-quote { margin: 0 0 1em; }
.ak-document-quote blockquote { margin: 0; padding: 0.3em 1.1em; border-left: 3px solid var(--ak-color-primary, #00dd80); color: var(--ak-color-text, #1d2f3c); font-size: 1.05em; font-weight: 300; }
.ak-document-quote blockquote p { margin: 0; }
.ak-document-quote figcaption { padding: 0.4em 1.1em 0; font-size: 0.85em; color: var(--ak-color-muted, #56636d); font-weight: 700; }
.ak-document-code { margin: 0 0 1em; padding: 0.9em 1.1em; background: var(--ak-color-surface, #f4f7f7); border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-md, 8px); overflow-x: auto; font-size: 0.85em; line-height: 1.5; }
.ak-document-code code { background: none; border: 0; padding: 0; font-size: 1em; white-space: pre; }
.ak-document-image { margin: 0 auto 1.2em; text-align: center; break-inside: avoid; }
.ak-document-image img { display: block; max-width: 100%; height: auto; margin: 0 auto; border-radius: var(--ak-radius-md, 8px); }
.ak-document-image figcaption { color: var(--ak-color-muted, #56636d); font-size: 0.85em; margin-top: 0.5em; }
.ak-document-image-placeholder { display: flex; align-items: center; justify-content: center; min-height: 8em; padding: 1em; border: 1px dashed var(--ak-color-border-strong, #8e979d); border-radius: var(--ak-radius-md, 8px); color: var(--ak-color-muted, #56636d); background: var(--ak-color-surface, #f4f7f7); }
.ak-document hr { border: 0; border-top: 1px solid var(--ak-color-border, #dde0e2); margin: 2em 0; }
.ak-document-page-break { margin: 2em 0; border-top: 1px dashed var(--ak-color-border-strong, #8e979d); text-align: center; height: 0; }
.ak-document-page-break span { position: relative; top: -0.75em; padding: 0 0.6em; background: var(--ak-color-background, #fff); color: var(--ak-color-muted, #56636d); font-size: 0.75em; }
.ak-document-toc { margin: 0 0 1.8em; padding: 1.1em 1.3em; background: linear-gradient(135deg, var(--ak-color-card-from, #f4f7f7), var(--ak-color-card-to, #e7efee)); border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius, 12px); }
.ak-document-toc-title { margin: 0 0 0.6em; font-weight: 700; color: var(--ak-color-accent, #0f7a5a); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.06em; }
.ak-document-toc ol { list-style: none; margin: 0; padding: 0; }
.ak-document-toc li { margin: 0.2em 0; }
.ak-document-toc a { color: inherit; text-decoration: none; }
.ak-document-toc a:hover, .ak-document-toc a:focus-visible { color: var(--ak-color-accent, #0f7a5a); text-decoration: underline; }
.ak-document-toc-level-2 { padding-left: 1.2em; }
.ak-document-toc-level-3 { padding-left: 2.4em; }
.ak-document-toc-level-4 { padding-left: 3.6em; }
.ak-document-align-center { text-align: center; }
.ak-document-align-right { text-align: right; }
.ak-document-align-justify { text-align: justify; }
.ak-document--print { max-width: none; margin: 0; padding: 0; }
.ak-document--print .ak-document-cover { min-height: 60vh; break-after: page; display: flex; flex-direction: column; justify-content: flex-end; }
.ak-document--print .ak-document-page-break { break-after: page; border: 0; margin: 0; }
.ak-document--print .ak-document-page-break span { display: none; }
.ak-document--print .ak-document-running { display: none; }
.ak-document--print tr, .ak-document--print .ak-document-callout, .ak-document--print .ak-document-code { break-inside: avoid; }
.ak-document--print thead { display: table-header-group; }
@media print {
  .ak-document { max-width: none; margin: 0; padding: 0; }
  .ak-document-page-break { break-after: page; border: 0; margin: 0; }
  .ak-document-page-break span, .ak-document-running { display: none; }
}
`;
