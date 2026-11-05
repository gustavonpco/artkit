import type { ChangeSummary } from '@artkit-ai/core';
import { bodyText, type MarkdownDocument, parseDocument, sectionText } from './document.js';

/** Changes between two documents, targeted by section anchor (`section:escopo`) or envelope parts. */
export function diffMarkdown(before: string, after: string): ChangeSummary[] {
  if (before === after) return [];
  const a = parseDocument(before);
  const b = parseDocument(after);
  const changes: ChangeSummary[] = [];
  const beforeMap = new Map(a.sections.map((section, index) => [section.anchor, { section, index }]));
  const afterMap = new Map(b.sections.map((section, index) => [section.anchor, { section, index }]));
  for (const [anchor, { section, index }] of afterMap) {
    const previous = beforeMap.get(anchor);
    if (!previous) {
      changes.push({
        type: 'added',
        target: `section:${anchor}`,
        summary: `"${section.title}" (${sectionText(b.sections, index).length} chars)`,
      });
      continue;
    }
    if (previous.section.title !== section.title || previous.section.level !== section.level) {
      changes.push({
        type: 'changed',
        target: `section:${anchor}`,
        summary: `"${previous.section.title}" → "${section.title}"`,
      });
    } else if (sectionText(a.sections, previous.index) !== sectionText(b.sections, index)) {
      changes.push({ type: 'changed', target: `section:${anchor}`, summary: `"${section.title}" edited` });
    } else if (previous.index !== index) {
      changes.push({ type: 'moved', target: `section:${anchor}`, summary: `"${section.title}" moved` });
    }
  }
  for (const [anchor, { section }] of beforeMap) {
    if (!afterMap.has(anchor))
      changes.push({ type: 'removed', target: `section:${anchor}`, summary: `"${section.title}"` });
  }
  changes.push(...frontMatterChanges(a, b));
  if (bodyText({ body: a.preamble }) !== bodyText({ body: b.preamble })) {
    changes.push({ type: 'changed', target: 'preamble', summary: 'introduction edited' });
  }
  return changes;
}

function frontMatterChanges(a: MarkdownDocument, b: MarkdownDocument): ChangeSummary[] {
  const before = new Map(a.frontMatter.map((entry) => [entry.key, entry.value]));
  const after = new Map(b.frontMatter.map((entry) => [entry.key, entry.value]));
  const changes: ChangeSummary[] = [];
  for (const [key, value] of after) {
    if (!before.has(key)) changes.push({ type: 'added', target: `frontmatter:${key}`, summary: value });
    else if (before.get(key) !== value)
      changes.push({
        type: 'changed',
        target: `frontmatter:${key}`,
        summary: `${before.get(key)} → ${value}`,
      });
  }
  for (const key of before.keys())
    if (!after.has(key)) changes.push({ type: 'removed', target: `frontmatter:${key}`, summary: key });
  return changes;
}
