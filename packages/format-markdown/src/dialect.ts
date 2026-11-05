import { Editor } from '@tiptap/core';
import { dialectExtensions, unescapeAlerts } from './extensions.js';

/** Raw HTML is removed on validation (spec §10.1). The only comment kept is the page break directive. */
const HTML_COMMENT = /<!--(?!\s*pagebreak\s*-->)[\s\S]*?-->/g;
const HTML_TAG = /<\/?[A-Za-z][^>\n]*>/g;

export interface SanitizeResult {
  text: string;
  removed: number;
}

/** Strips raw HTML (other than the pagebreak directive) and reports how many pieces were removed. */
export function stripRawHtml(text: string): SanitizeResult {
  let removed = 0;
  const cleaned = text
    .replace(HTML_COMMENT, () => {
      removed += 1;
      return '';
    })
    .replace(HTML_TAG, () => {
      removed += 1;
      return '';
    });
  return { text: cleaned, removed };
}

function normalizeForComparison(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

/**
 * Parses the text with the same Tiptap extensions the editor uses (spec §10.1) and serializes it back. Used by lint to
 * report divergences of the round trip (spec §10.2). Returns the serialized text.
 */
export function editorRoundTrip(text: string): string {
  const editor = new Editor({
    extensions: dialectExtensions(),
    content: text,
    contentType: 'markdown',
  });
  try {
    return unescapeAlerts(editor.getMarkdown());
  } finally {
    editor.destroy();
  }
}

/** True when the editor serialization keeps the same content, ignoring whitespace-only differences. */
export function roundTripDiverges(text: string): boolean {
  return normalizeForComparison(editorRoundTrip(text)) !== normalizeForComparison(text);
}
