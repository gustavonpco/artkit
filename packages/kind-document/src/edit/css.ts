import { kitCss } from '@artkit/react';
import { documentCss } from '../react/css.js';

/** Renderer styles plus the editor chrome, so the editor alone styles every block (callouts, tables…). */
export const documentEditorCss = `${documentCss}
${kitCss}
.ak-document-editor { display: flex; flex-direction: column; gap: 12px; }
.ak-document-editor-content { outline: none; min-height: 12rem; border-radius: var(--ak-radius-md, 8px); }
.ak-document.ak-document-editor-content { padding: 24px 32px; }
.ak-document-editor-content:focus-visible { outline: 2px solid var(--ak-color-focus, #0f7a5a); outline-offset: 2px; }
.ak-document-editor-content .selectedCell { background: var(--ak-color-selected, #e0faf0); }
.ak-document-editor-content .ProseMirror-selectednode { outline: 2px solid var(--ak-color-focus, #0f7a5a); outline-offset: 2px; }
.ak-document-editor-lint { text-decoration: underline wavy var(--ak-color-warning, #73692f); text-decoration-skip-ink: none; }
.ak-document-editor-content [data-ak-toc], .ak-document-editor-content [data-ak-page-break] { cursor: default; user-select: none; }
`;
