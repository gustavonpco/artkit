import {
  ellipsis,
  type ProjectionItem,
  paginate,
  type ReadRequest,
  type ReadResult,
  selectRange,
} from '@artkit-ai/core';
import {
  headingLine,
  type MarkdownDocument,
  sectionText,
  serializeDocument,
  subtreeEnd,
} from './document.js';

/** Compact reading (spec §10.4): `outline`, `section` (by anchors) and `full`, all under the token budget. */
export function readDocument(document: MarkdownDocument, request: ReadRequest): ReadResult {
  const sections = document.sections;
  if (request.mode === 'outline') {
    const items: ProjectionItem[] = sections.map((section) => {
      const size = sectionText(sections, sections.indexOf(section)).length;
      const line = `- [${section.anchor}] ${'#'.repeat(section.level)} ${ellipsis(section.title, 80)} (${size} chars)`;
      return { id: section.anchor, text: line, outline: line };
    });
    const front = document.frontMatter.map((entry) => `${entry.key}: ${entry.value}`).join('\n');
    const header = front ? `Frontmatter:\n${front}\nOutline:` : 'Outline:';
    return finish(paginate(items, { header, ...budget(request), outlineOnly: true }));
  }
  if (request.mode === 'section') {
    const anchors = sections.map((section) => section.anchor);
    const selected = selectRange(anchors, request.range);
    if (!selected) return { text: 'Nenhuma seção corresponde ao intervalo.', truncated: false };
    const items: ProjectionItem[] = selected.map((anchor) => {
      const index = anchors.indexOf(anchor);
      const text = sectionText(sections, index);
      return { id: anchor, text, outline: `[${anchor}] ${sections[index]!.title}` };
    });
    return finish(paginate(items, budget(request)));
  }
  // full: frontmatter and preamble first, then one item per section subtree.
  const items: ProjectionItem[] = [];
  const preamble = serializeDocument({
    frontMatter: document.frontMatter,
    preamble: document.preamble,
    sections: [],
  }).trimEnd();
  if (preamble) items.push({ id: '__preamble', text: preamble, outline: '[preamble]' });
  sections.forEach((section, index) => {
    const end = subtreeEnd(sections, index);
    const text = sectionText(sections, index);
    items.push({ id: section.anchor, text, outline: `${headingLine(section)} [${end - index}]` });
  });
  return finish(paginate(items, budget(request)));
}

function budget(request: ReadRequest) {
  return {
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    ...(request.charsPerToken === undefined ? {} : { charsPerToken: request.charsPerToken }),
  };
}

function finish(projection: {
  text: string;
  truncated: boolean;
  cursor?: string;
  remainingOutline?: string;
}): ReadResult {
  const text =
    projection.truncated && projection.remainingOutline
      ? `${projection.text}\nRemaining outline:\n${projection.remainingOutline}`
      : projection.text;
  return {
    text,
    truncated: projection.truncated,
    ...(projection.cursor ? { cursor: projection.cursor } : {}),
  };
}
