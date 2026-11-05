/**
 * Markdown document model (spec §10.3). The stored content is text; this module parses it into a flat list of
 * sections so operations address sections by anchor and serialize back without changing untouched lines.
 */

export interface FrontMatterEntry {
  key: string;
  value: string;
}

export interface Section {
  /** Stable anchor: explicit `{#id}` when given, otherwise a slug of the title (with a numeric suffix on repeats). */
  anchor: string;
  /** Anchor was written explicitly in the heading and survives renames. */
  explicit: boolean;
  level: number;
  title: string;
  /** Lines between this heading and the next heading of any level. */
  body: string[];
}

export interface MarkdownDocument {
  frontMatter: FrontMatterEntry[];
  /** Lines before the first heading. */
  preamble: string[];
  sections: Section[];
}

const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+\{#([A-Za-z0-9][A-Za-z0-9_-]{0,63})\})?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const FRONT_KEY = /^([A-Za-z_][A-Za-z0-9_-]{0,63}):(?:[ \t]+(.*))?$/;

/** Slug used for automatic anchors: lowercase ASCII words joined by "-". */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'secao';
}

/** Splits `---` frontmatter from the body. Returns the raw lines of the block (empty when absent). */
export function splitFrontMatter(text: string): { block: string[]; body: string } {
  if (!text.startsWith('---\n') && text !== '---') return { block: [], body: text };
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      return { block: lines.slice(1, i), body: lines.slice(i + 1).join('\n') };
    }
  }
  return { block: [], body: text };
}

export function parseFrontMatter(block: string[]): FrontMatterEntry[] {
  const entries: FrontMatterEntry[] = [];
  for (const line of block) {
    if (line.trim() === '') continue;
    const match = FRONT_KEY.exec(line);
    if (match) entries.push({ key: match[1]!, value: (match[2] ?? '').trim() });
  }
  return entries;
}

/** Parses Markdown into sections. Headings inside fenced code blocks are text, not structure. */
export function parseDocument(text: string): MarkdownDocument {
  const { block, body } = splitFrontMatter(text.replace(/\r\n/g, '\n'));
  const document: MarkdownDocument = { frontMatter: parseFrontMatter(block), preamble: [], sections: [] };
  let current: Section | undefined;
  let fence: string | undefined;
  for (const line of body.split('\n')) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    const heading = fence === undefined ? HEADING.exec(line) : null;
    if (heading) {
      const title = heading[2]!.trim();
      const explicit = heading[3] !== undefined;
      current = {
        anchor: explicit ? heading[3]! : '',
        explicit,
        level: heading[1]!.length,
        title,
        body: [],
      };
      document.sections.push(current);
      continue;
    }
    (current ? current.body : document.preamble).push(line);
  }
  assignAnchors(document.sections);
  return document;
}

/**
 * Derives automatic anchors in document order. Explicit anchors are reserved first and never change; repeated titles
 * get a numeric suffix (`escopo`, `escopo-2`, …).
 */
export function assignAnchors(sections: Section[]): void {
  const taken = new Set(sections.filter((section) => section.explicit).map((section) => section.anchor));
  for (const section of sections) {
    if (section.explicit) continue;
    const base = slugifyTitle(section.title);
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) candidate = `${base}-${n++}`;
    section.anchor = candidate;
    taken.add(candidate);
  }
}

export function headingLine(section: Pick<Section, 'level' | 'title' | 'anchor' | 'explicit'>): string {
  return `${'#'.repeat(section.level)} ${section.title}${section.explicit ? ` {#${section.anchor}}` : ''}`;
}

/** Serializes back to text. Untouched lines are emitted exactly as they were parsed. */
export function serializeDocument(document: MarkdownDocument): string {
  const lines: string[] = [];
  if (document.frontMatter.length > 0) {
    lines.push('---');
    for (const entry of document.frontMatter)
      lines.push(entry.value === '' ? `${entry.key}:` : `${entry.key}: ${entry.value}`);
    lines.push('---');
  }
  lines.push(...document.preamble);
  for (const section of document.sections) {
    lines.push(headingLine(section), ...section.body);
  }
  return normalizeTrailingNewline(lines.join('\n'));
}

function normalizeTrailingNewline(text: string): string {
  return `${text.replace(/\n+$/, '')}\n`;
}

/** Index one past the last section of the subtree that starts at `index` (headings of lower level end it). */
export function subtreeEnd(sections: readonly Section[], index: number): number {
  const level = sections[index]!.level;
  let end = index + 1;
  while (end < sections.length && sections[end]!.level > level) end += 1;
  return end;
}

/** Text of a section: its heading, direct body and the whole subtree. */
export function sectionText(sections: readonly Section[], index: number): string {
  const end = subtreeEnd(sections, index);
  const lines: string[] = [];
  for (let i = index; i < end; i++) lines.push(headingLine(sections[i]!), ...sections[i]!.body);
  return lines.join('\n').replace(/\n+$/, '');
}

export function bodyText(section: Pick<Section, 'body'>): string {
  return section.body.join('\n').replace(/\n+$/, '');
}
