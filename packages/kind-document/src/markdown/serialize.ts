import { normalizeRuns, runFormat } from '../runs.js';
import type {
  Block,
  CalloutBlock,
  Cover,
  DocumentContent,
  ListItem,
  PageSetup,
  Run,
  TableBlock,
} from '../schema.js';
import { yamlString } from './frontmatter.js';

export interface MarkdownSerializeOptions {
  /**
   * Emits `<!-- ak:… -->` comments for what GFM cannot express (table caption/footer/widths, paragraph
   * alignment, image width, toc settings), so the Markdown converts back without loss. Default true.
   */
  metadata?: boolean;
  /** Emits `<!-- #id -->` anchors so block ids survive the round trip. Default false. */
  ids?: boolean;
}

const TONE_ALERT: Record<CalloutBlock['tone'], string> = {
  info: 'NOTE',
  success: 'TIP',
  warning: 'WARNING',
  danger: 'CAUTION',
};

/** Serializes a whole document: front matter (cover/page) followed by the blocks. */
export function contentToMarkdown(content: DocumentContent, options: MarkdownSerializeOptions = {}): string {
  const front = frontMatter(content.cover, content.page);
  const body = blocksToMarkdown(content.blocks, options);
  return [front, body].filter(Boolean).join('\n\n') + (front || body ? '\n' : '');
}

export function frontMatter(cover: Cover | undefined, page: PageSetup | undefined): string {
  if (!cover && !page) return '';
  const lines = ['---'];
  if (cover) {
    if (cover.eyebrow) lines.push(`eyebrow: ${yamlString(cover.eyebrow)}`);
    lines.push(`title: ${yamlString(cover.title)}`);
    if (cover.subtitle) lines.push(`subtitle: ${yamlString(cover.subtitle)}`);
    if (cover.fields?.length) {
      lines.push('fields:');
      for (const field of cover.fields)
        lines.push(`  - label: ${yamlString(field.label)}`, `    value: ${yamlString(field.value)}`);
    }
  }
  if (page) lines.push(`page: ${JSON.stringify(page)}`);
  lines.push('---');
  return lines.join('\n');
}

/** Serializes blocks as GFM separated by blank lines. */
export function blocksToMarkdown(blocks: readonly Block[], options: MarkdownSerializeOptions = {}): string {
  const parts: string[] = [];
  let previous: Block | undefined;
  for (const block of blocks) {
    const text = blockToMarkdown(block, { ...options, previous });
    if (text !== '') parts.push(text);
    previous = block;
  }
  return parts.join('\n\n');
}

/** One block as Markdown. `previous` lets adjacent lists use a different marker so they stay separate. */
export function blockToMarkdown(
  block: Block,
  options: MarkdownSerializeOptions & { previous?: Block | undefined } = {},
): string {
  const metadata = options.metadata !== false;
  const meta = (name: string, data?: Record<string, unknown>) => {
    if (!metadata) return '';
    const json = data && Object.keys(data).length > 0 ? ` ${escapeComment(JSON.stringify(data))}` : '';
    return `<!-- ak:${name}${json} -->`;
  };
  const anchor = options.ids ? ` <!-- #${block.id} -->` : '';
  const anchorLine = options.ids ? `\n\n<!-- #${block.id} -->` : '';
  switch (block.type) {
    case 'heading': {
      // A trailing "#" would be read as the optional closing sequence of the heading.
      const text = inlineToMarkdown(block.runs, { breaks: 'html', lineStart: false }).replace(
        /(#+)$/,
        '\\$1',
      );
      return `${'#'.repeat(block.level)} ${text}`.trimEnd() + anchor;
    }
    case 'paragraph': {
      const text = inlineToMarkdown(block.runs);
      // Empty paragraphs have no Markdown form.
      if (!text) return '';
      const align = block.align && block.align !== 'left' ? meta('paragraph', { align: block.align }) : '';
      return text + anchor + (align ? `\n\n${align}` : '');
    }
    case 'list': {
      const sameKindBefore =
        options.previous?.type === 'list' && Boolean(options.previous.ordered) === Boolean(block.ordered);
      return (
        listToMarkdown(block.items, Boolean(block.ordered), block.start ?? 1, sameKindBefore, '') + anchorLine
      );
    }
    case 'table':
      return tableToMarkdown(block, meta) + anchorLine;
    case 'callout': {
      const lines = [`[!${TONE_ALERT[block.tone]}]`];
      if (block.title) {
        const title = escapeText(block.title, { lineStart: false }).replace(/\n/g, ' ');
        // GitHub-style bold title line when emphasis delimiters parse reliably, else the same-line form.
        if (/^[\p{L}\p{N}](.*[\p{L}\p{N}])?$/u.test(block.title)) lines.push(`**${title}**`);
        else lines[0] += ` ${title}`;
      }
      const body = inlineToMarkdown(block.runs);
      if (body) lines.push(...body.split('\n'));
      return prefixLines(lines.join('\n'), '> ') + anchorLine;
    }
    case 'quote': {
      const body = inlineToMarkdown(block.runs);
      const lines = [body];
      if (block.attribution) lines.push('', `— ${escapeText(block.attribution, { lineStart: false })}`);
      return prefixLines(lines.join('\n'), '> ') + anchorLine;
    }
    case 'code': {
      const longest = Math.max(2, ...[...block.text.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(longest + 1);
      return `${fence}${block.language ?? ''}\n${block.text}${block.text.endsWith('\n') || block.text === '' ? '' : '\n'}${fence}${anchorLine}`;
    }
    case 'image': {
      const caption = block.caption ? ` "${block.caption.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : '';
      const width = block.width !== undefined ? meta('image', { width: block.width }) : '';
      return `![${escapeText(block.alt, { lineStart: false }).replace(/\n/g, ' ')}](${block.asset}${caption})${anchorLine}${width ? `\n\n${width}` : ''}`;
    }
    case 'divider':
      return `---${anchorLine}`;
    case 'pageBreak':
      return `<!-- ak:pagebreak -->${anchorLine}`;
    case 'toc': {
      const data: Record<string, unknown> = {};
      if (block.maxLevel !== undefined) data.maxLevel = block.maxLevel;
      if (block.title) data.title = block.title;
      return `<!-- ak:toc${Object.keys(data).length ? ` ${escapeComment(JSON.stringify(data))}` : ''} -->${anchorLine}`;
    }
  }
}

function escapeComment(text: string): string {
  // "--" cannot appear inside an HTML comment.
  return text.replace(/--/g, '-\\u002d');
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : prefix.trimEnd()))
    .join('\n');
}

function listToMarkdown(
  items: readonly ListItem[],
  ordered: boolean,
  start: number,
  alternate: boolean,
  indent: string,
): string {
  const lines: string[] = [];
  items.forEach((item, index) => {
    const marker = ordered ? `${start + index}${alternate ? ')' : '.'} ` : `${alternate ? '*' : '-'} `;
    const childIndent = indent + ' '.repeat(marker.length);
    const text = inlineToMarkdown(item.runs);
    const [first = '', ...rest] = text.split('\n');
    lines.push(`${indent}${marker}${first}`.trimEnd());
    for (const line of rest) lines.push(line ? `${childIndent}${line}` : '');
    if (item.children?.length) {
      lines.push(listToMarkdown(item.children, item.childrenOrdered ?? ordered, 1, false, childIndent));
    }
  });
  return lines.join('\n');
}

function tableToMarkdown(
  block: TableBlock,
  meta: (name: string, data?: Record<string, unknown>) => string,
): string {
  const width = block.header.length;
  const cell = (runs: Run[]) =>
    inlineToMarkdown(runs, { breaks: 'html', table: true, lineStart: false }) || ' ';
  const row = (cells: Run[][]) =>
    `| ${Array.from({ length: width }, (_, i) => cell(cells[i] ?? [])).join(' | ')} |`;
  const delimiter = Array.from({ length: width }, (_, i) => {
    const align = block.align?.[i];
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : block.align ? ':---' : '---';
  });
  const lines = [row(block.header), `| ${delimiter.join(' | ')} |`, ...block.rows.map(row)];
  if (block.footer) lines.push(row(block.footer));
  const data: Record<string, unknown> = {};
  if (block.caption) data.caption = block.caption;
  if (block.footer) data.footer = true;
  if (block.widths) data.widths = block.widths;
  const comment = Object.keys(data).length > 0 ? meta('table', data) : '';
  return comment ? `${lines.join('\n')}\n\n${comment}` : lines.join('\n');
}

export interface InlineOptions {
  /** How "\n" is written: a Markdown line break (default) or `<br>` (headings and table cells). */
  breaks?: 'newline' | 'html';
  /** Escape `|` for table cells. */
  table?: boolean;
  /** Whether the text starts at the beginning of a line (enables block-marker escaping). Default true. */
  lineStart?: boolean;
  /** Escape `|` (set internally for table cells and multi-line text). */
  pipes?: boolean;
}

type DelimMark = 'bold' | 'italic' | 'strike';
type MarkKey = DelimMark | 'underline' | 'superscript' | 'subscript' | `link:${string}`;

interface Span {
  mark?: MarkKey;
  children: Span[];
  run?: Run;
}

const DELIMS: Record<DelimMark, [string, string, string]> = {
  bold: ['**', '<b>', '</b>'],
  italic: ['*', '<i>', '</i>'],
  strike: ['~~', '<s>', '</s>'],
};
const TAGS: Record<'underline' | 'superscript' | 'subscript', string> = {
  underline: 'u',
  superscript: 'sup',
  subscript: 'sub',
};
const MARK_ORDER: MarkKey[] = ['bold', 'italic', 'strike', 'underline', 'superscript', 'subscript'];

/** Serializes runs as inline Markdown with correctly nested marks and escaped text. */
export function inlineToMarkdown(runs: readonly Run[], options: InlineOptions = {}): string {
  const prepared = splitEdgeWhitespace(normalizeRuns(runs));
  const root = buildSpans(prepared);
  // A table needs two lines, so "|" only needs escaping in cells and in multi-line text.
  const pipes =
    options.table === true || (options.breaks !== 'html' && prepared.some((run) => run.text.includes('\n')));
  const text = renderSpans(root.children, { ...options, pipes });
  return options.lineStart === false ? text : escapeLineStarts(text);
}

function marksOf(run: Run): MarkKey[] {
  const keys: MarkKey[] = [];
  if (run.link) keys.push(`link:${run.link}`);
  for (const mark of MARK_ORDER) if (run[mark as keyof Run]) keys.push(mark);
  return keys;
}

/** Emphasis cannot start or end with whitespace, so edge whitespace is moved outside delimiter marks. */
function splitEdgeWhitespace(runs: Run[]): Run[] {
  const delims = ['bold', 'italic', 'strike'] as const;
  const out: Run[] = [];
  runs.forEach((run, index) => {
    if (run.code) {
      out.push(run);
      return;
    }
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
    // Only the edges of a mark span matter: whitespace shared with a neighbor that has the mark stays inside.
    const opening = delims.filter((mark) => run[mark] && !runs[index - 1]?.[mark]);
    const closing = delims.filter((mark) => run[mark] && !runs[index + 1]?.[mark]);
    const without = (marks: readonly (typeof delims)[number][]) => {
      const copy = { ...run };
      for (const mark of marks) copy[mark] = false;
      return copy;
    };
    if (!match[2]) {
      out.push(without([...new Set([...opening, ...closing])]));
      return;
    }
    if (match[1]) out.push({ ...without(opening), text: match[1] });
    out.push({ ...run, text: match[2] });
    if (match[3]) out.push({ ...without(closing), text: match[3] });
  });
  return normalizeRuns(out.map((run) => ({ text: run.text, ...runFormat(run) })));
}

/** Builds a mark tree: marks that span more runs are opened first so nesting stays valid. */
function buildSpans(runs: Run[]): Span {
  const root: Span = { children: [] };
  const stack: Span[] = [root];
  const keys = runs.map(marksOf);
  keys.forEach((marks, index) => {
    // Close marks that the run does not have (and everything opened after them).
    let keep = 1;
    while (keep < stack.length && marks.includes(stack[keep]!.mark!)) keep++;
    stack.length = keep;
    const open = new Set(stack.slice(1).map((span) => span.mark!));
    const missing = marks.filter((mark) => !open.has(mark));
    const reach = (mark: MarkKey) => {
      let end = index;
      while (end + 1 < keys.length && keys[end + 1]!.includes(mark)) end++;
      return end;
    };
    // Links outermost among equals so emphasis can live inside link text.
    missing.sort(
      (a, b) => reach(b) - reach(a) || Number(b.startsWith('link:')) - Number(a.startsWith('link:')),
    );
    for (const mark of missing) {
      const span: Span = { mark, children: [] };
      stack[stack.length - 1]!.children.push(span);
      stack.push(span);
    }
    stack[stack.length - 1]!.children.push({ children: [], run: runs[index]! });
  });
  return root;
}

/** Outermost leaf at one edge of a span; undefined when a link sits at that edge (its brackets are punctuation). */
function edgeLeaf(span: Span, edge: 'first' | 'last'): Run | undefined {
  if (span.run) return span.run;
  const child = edge === 'first' ? span.children[0] : span.children[span.children.length - 1];
  if (!child || child.mark?.startsWith('link:')) return undefined;
  return edgeLeaf(child, edge);
}

const PUNCTUATION = /[\p{P}\p{S}]/u;

/** Delimiters are safe when the content edges are plain word characters; otherwise HTML tags are used. */
function delimiterSafe(span: Span): boolean {
  const first = edgeLeaf(span, 'first');
  const last = edgeLeaf(span, 'last');
  if (!first || !last || first.code || last.code) return false;
  const a = first.text[0] ?? '';
  const b = last.text[last.text.length - 1] ?? '';
  return !PUNCTUATION.test(a) && !PUNCTUATION.test(b) && !/\s/.test(a) && !/\s/.test(b);
}

function renderSpans(spans: Span[], options: InlineOptions): string {
  return spans.map((span) => renderSpan(span, options)).join('');
}

function renderSpan(span: Span, options: InlineOptions): string {
  if (span.run) return renderLeaf(span.run, options);
  const inner = renderSpans(span.children, options);
  const mark = span.mark!;
  if (mark.startsWith('link:')) {
    const href = mark.slice('link:'.length);
    const only = span.children.length === 1 ? span.children[0]!.run : undefined;
    if (
      only &&
      !only.code &&
      (only.text === href || `mailto:${only.text}` === href) &&
      /^(https?:|mailto:)/i.test(href) &&
      !/[<>\s]/.test(href)
    ) {
      return `<${only.text}>`;
    }
    return `[${inner}](${formatDestination(href)})`;
  }
  if (mark === 'bold' || mark === 'italic' || mark === 'strike') {
    const [delim, open, close] = DELIMS[mark];
    return delimiterSafe(span) ? `${delim}${inner}${delim}` : `${open}${inner}${close}`;
  }
  const tag = TAGS[mark as keyof typeof TAGS];
  return `<${tag}>${inner}</${tag}>`;
}

function formatDestination(href: string): string {
  if (/[\s()<>]/.test(href)) return `<${href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>`;
  return href.replace(/\\/g, '%5C');
}

function renderLeaf(run: Run, options: InlineOptions): string {
  const breaks = options.breaks ?? 'newline';
  if (run.code) {
    let text = run.text.replace(/\n/g, ' ');
    if (options.table) text = text.replace(/\|/g, '\\|');
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    const pad =
      text.startsWith('`') ||
      text.endsWith('`') ||
      (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '')
        ? ' '
        : '';
    return `${fence}${pad}${text}${pad}${fence}`;
  }
  const escaped = escapeText(run.text, { pipes: options.pipes === true, lineStart: false });
  return breaks === 'html' ? escaped.replace(/\n/g, '<br>') : escaped;
}

/** Escapes characters with inline meaning in GFM. */
export function escapeText(text: string, options: { pipes?: boolean; lineStart?: boolean } = {}): string {
  const special = options.pipes ? /[\\`*[\]<~|]/g : /[\\`*[\]<~]/g;
  const out = escapeUnderscores(text.replace(special, (c) => `\\${c}`))
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
    // GFM turns bare URLs and e-mail addresses into links; an escaped character keeps them as text.
    .replace(/\b(https?):\/\//gi, '$1\\://')
    .replace(/\bwww\./gi, 'www\\.')
    .replace(/([\w.+-])@([\w-]+\.)/g, '$1\\@$2');
  return options.lineStart === false ? out : escapeLineStarts(out);
}

/** Escapes "_" unless it sits between two letters or digits (intraword "_" never starts emphasis). */
function escapeUnderscores(text: string): string {
  const alnum = /[\p{L}\p{N}]/u;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '_' && !(alnum.test(text[i - 1] ?? '') && alnum.test(text[i + 1] ?? ''))) out += '\\_';
    else out += char;
  }
  return out;
}

/** Escapes block markers at the start of each line (`#`, `>`, list markers, setext underlines). */
function escapeLineStarts(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)([#>+=-])/, (_, space: string, char: string) => `${space}\\${char}`)
        .replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2'),
    )
    .join('\n');
}
