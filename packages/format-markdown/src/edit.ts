import type { MarkdownOperation } from './operations.js';

/** What the editor emits: Markdown operations, or the core `replace_content` for structural edits. */
export type MarkdownEditOperation = MarkdownOperation | { op: 'replace_content'; content: string };

import { editorRoundTrip } from './dialect.js';
import { type MarkdownDocument, parseDocument, splitFrontMatter } from './document.js';

/**
 * The body of a document without its frontmatter, and the frontmatter lines kept as they were. The editor shows only the
 * body, so the YAML block cannot turn into headings; `withFrontMatter` puts the block back around an edited body.
 */
export function splitBody(text: string): { frontMatter: string; body: string } {
  const { block, body } = splitFrontMatter(text.replace(/\r\n/g, '\n'));
  return { frontMatter: block.length > 0 ? `---\n${block.join('\n')}\n---\n` : '', body };
}

export function withFrontMatter(frontMatter: string, body: string): string {
  return `${frontMatter}${body}`;
}

function normalize(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

function trimBlankLines(text: string): string {
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

function frontMatterKey(document: MarkdownDocument): string {
  return JSON.stringify(document.frontMatter);
}

/**
 * Operations that turn the confirmed Markdown into what the editor produced (spec §10.7). Both sides go through the
 * editor serialization first, so formatting the editor normalizes (`_x_` → `*x*`) does not count as an edit. Sections
 * whose body changed become `replace_section`; a changed title becomes `rename_section`. Structural changes the editor
 * cannot describe by anchor (added or removed sections, frontmatter, preamble) fall back to `replace_content`.
 */
export function editOperations(confirmed: string, edited: string): MarkdownEditOperation[] {
  const before = parseDocument(editorRoundTrip(confirmed));
  const after = parseDocument(editorRoundTrip(edited));
  const sameShape =
    before.sections.length === after.sections.length &&
    before.sections.every((section, index) => section.anchor === after.sections[index]!.anchor) &&
    frontMatterKey(before) === frontMatterKey(after) &&
    normalize(before.preamble.join('\n')) === normalize(after.preamble.join('\n'));
  if (!sameShape) {
    return normalize(editorRoundTrip(confirmed)) === normalize(editorRoundTrip(edited))
      ? []
      : [{ op: 'replace_content', content: edited }];
  }
  const operations: MarkdownEditOperation[] = [];
  before.sections.forEach((section, index) => {
    const next = after.sections[index]!;
    if (section.title !== next.title) {
      operations.push({ op: 'rename_section', section: section.anchor, title: next.title });
    }
    const body = normalize(section.body.join('\n'));
    const nextBody = normalize(next.body.join('\n'));
    if (body !== nextBody) {
      operations.push({
        op: 'replace_section',
        section: section.anchor,
        body: trimBlankLines(next.body.join('\n')),
      });
    }
  });
  return operations;
}
