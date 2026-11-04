import { ASSET_REF_PATTERN, ITEM_ID_PATTERN, isSafeLink } from '@artkit-ai/core';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { normalizeRuns, runsText } from '../runs.js';
import {
  type BlockInput,
  type CALLOUT_TONES,
  type Cell,
  type Cover,
  coverSchema,
  type ListItem,
  type PageSetup,
  pageSchema,
  type Run,
} from '../schema.js';
import { splitFrontMatter, type YamlValue } from './frontmatter.js';

/** Loose mdast node: the parser output is walked structurally, without depending on @types/mdast. */
interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  align?: (string | null)[] | null;
  lang?: string | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  label?: string | null;
}

export interface MarkdownProblem {
  message: string;
  hint?: string;
}

export interface MarkdownParseOptions {
  /**
   * What to do with images that are not `asset://` references: `fail` (default) reports an error,
   * `drop` removes them with a warning.
   */
  externalImages?: 'fail' | 'drop';
}

export interface MarkdownParseResult {
  blocks: BlockInput[];
  /** Cover read from front matter (`title`/`titulo`, `subtitle`/`subtitulo`, `eyebrow`, `fields`/`campos`). */
  cover?: Cover;
  page?: PageSetup;
  /** Lossy conversions that were applied. */
  warnings: string[];
  /** Content that could not be converted; callers should refuse the input. */
  errors: MarkdownProblem[];
}

type Marks = Omit<Run, 'text'>;

const ALERTS: Record<string, (typeof CALLOUT_TONES)[number]> = {
  NOTE: 'info',
  INFO: 'info',
  IMPORTANT: 'info',
  TIP: 'success',
  SUCCESS: 'success',
  WARNING: 'warning',
  CAUTION: 'danger',
  DANGER: 'danger',
};

const ANCHOR = /^<!--\s*#([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*-->$/;
const META = /^<!--\s*ak:([A-Za-z]+)(?:\s+([\s\S]*?))?\s*-->$/;
const LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;

/** Converts GFM Markdown into document blocks (without ids unless anchors `<!-- #id -->` are present). */
export function parseMarkdown(markdown: string, options: MarkdownParseOptions = {}): MarkdownParseResult {
  const parser = new MarkdownConverter(options);
  return parser.convert(markdown);
}

class MarkdownConverter {
  readonly warnings: string[] = [];
  readonly errors: MarkdownProblem[] = [];
  readonly #definitions = new Map<string, { url: string; title: string | null }>();

  constructor(readonly options: MarkdownParseOptions) {}

  convert(raw: string): MarkdownParseResult {
    let markdown = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const result: MarkdownParseResult = { blocks: [], warnings: this.warnings, errors: this.errors };
    const front = splitFrontMatter(markdown);
    if (front) {
      markdown = front.body;
      this.warnings.push(...front.warnings);
      Object.assign(result, this.#frontMatter(front.data));
    }
    const tree = fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as unknown as MdNode;
    this.#collectDefinitions(tree);
    result.blocks = this.#blocks(tree.children ?? []);
    return result;
  }

  #frontMatter(data: Record<string, YamlValue>): { cover?: Cover; page?: PageSetup } {
    const out: { cover?: Cover; page?: PageSetup } = {};
    const text = (value: YamlValue | undefined) =>
      value === undefined || value === null
        ? undefined
        : typeof value === 'object'
          ? undefined
          : String(value);
    const title = text(data.title ?? data.titulo);
    const fieldsRaw = data.fields ?? data.campos;
    const fields: { label: string; value: string }[] = [];
    if (Array.isArray(fieldsRaw)) {
      for (const entry of fieldsRaw) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const label = text(entry.label);
          if (label) fields.push({ label, value: text(entry.value) ?? '' });
        }
      }
    } else if (fieldsRaw && typeof fieldsRaw === 'object') {
      for (const [label, value] of Object.entries(fieldsRaw))
        fields.push({ label, value: text(value) ?? '' });
    }
    if (title) {
      const cover: Record<string, unknown> = { title };
      const eyebrow = text(data.eyebrow);
      const subtitle = text(data.subtitle ?? data.subtitulo);
      if (eyebrow) cover.eyebrow = eyebrow;
      if (subtitle) cover.subtitle = subtitle;
      if (fields.length > 8) this.warnings.push(`The cover keeps the first 8 of ${fields.length} fields.`);
      if (fields.length > 0) cover.fields = fields.slice(0, 8);
      const parsed = coverSchema.safeParse(cover);
      if (parsed.success) out.cover = parsed.data;
      else this.warnings.push('The front matter cover is invalid and was ignored.');
    } else if (fields.length > 0) {
      this.warnings.push('Front matter fields need a title to form a cover; they were ignored.');
    }
    if (data.page !== undefined) {
      const parsed = pageSchema.safeParse(data.page);
      if (parsed.success) out.page = parsed.data;
      else this.warnings.push('The front matter "page" setting is invalid and was ignored.');
    }
    const known = new Set([
      'title',
      'titulo',
      'subtitle',
      'subtitulo',
      'eyebrow',
      'fields',
      'campos',
      'page',
      'tipo',
      'schemaVersion',
    ]);
    const ignored = Object.keys(data).filter((key) => !known.has(key));
    if (ignored.length > 0) this.warnings.push(`Front matter keys ignored: ${ignored.join(', ')}.`);
    return out;
  }

  #collectDefinitions(node: MdNode): void {
    if (node.type === 'definition' && node.identifier && node.url !== undefined) {
      const key = node.identifier.toLowerCase();
      if (!this.#definitions.has(key))
        this.#definitions.set(key, { url: node.url, title: node.title ?? null });
    }
    for (const child of node.children ?? []) this.#collectDefinitions(child);
  }

  #blocks(nodes: MdNode[]): BlockInput[] {
    const out: BlockInput[] = [];
    for (const node of nodes) {
      if (node.type === 'html') {
        this.#htmlBlock(node.value ?? '', out);
        continue;
      }
      out.push(...this.#block(node));
    }
    return out;
  }

  /** Block-level HTML: anchors and `ak:` metadata attach to the previous block; other HTML becomes text. */
  #htmlBlock(raw: string, out: BlockInput[]): void {
    const html = raw.trim();
    const previous = out[out.length - 1];
    const anchor = ANCHOR.exec(html);
    if (anchor) {
      if (previous && !previous.id) previous.id = anchor[1]!;
      else this.warnings.push(`Anchor "<!-- #${anchor[1]} -->" has no block to attach to; it was ignored.`);
      return;
    }
    if (/^<!--\s*toc\s*-->$/i.test(html) || /^\[(toc|\[_toc_\])\]$/i.test(html)) {
      out.push({ type: 'toc' });
      return;
    }
    if (
      /^<!--\s*page-?break\s*-->$/i.test(html) ||
      /^<div[^>]*page-break-after:\s*always[^>]*>\s*<\/div>$/i.test(html)
    ) {
      out.push({ type: 'pageBreak' });
      return;
    }
    const meta = META.exec(html);
    if (meta) {
      this.#meta(meta[1]!, meta[2], out);
      return;
    }
    if (/^<!--[\s\S]*-->$/.test(html)) {
      this.warnings.push('HTML comments are not kept.');
      return;
    }
    // Raw HTML is kept as literal text: renderers escape it, so nothing executes.
    this.warnings.push('Raw HTML was kept as plain text.');
    out.push({ type: 'paragraph', runs: [{ text: html }] });
  }

  #meta(name: string, json: string | undefined, out: BlockInput[]): void {
    let data: Record<string, unknown> = {};
    if (json) {
      try {
        const parsed = JSON.parse(json) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          data = parsed as Record<string, unknown>;
      } catch {
        this.warnings.push(`Unreadable "ak:${name}" comment; it was ignored.`);
        return;
      }
    }
    if (name === 'pagebreak') {
      out.push({ type: 'pageBreak' });
      return;
    }
    if (name === 'toc') {
      const toc: BlockInput = { type: 'toc' };
      if (
        typeof data.maxLevel === 'number' &&
        Number.isInteger(data.maxLevel) &&
        data.maxLevel >= 1 &&
        data.maxLevel <= 4
      ) {
        toc.maxLevel = data.maxLevel;
      }
      if (typeof data.title === 'string' && data.title) toc.title = data.title.slice(0, 200);
      out.push(toc);
      return;
    }
    const previous = out[out.length - 1];
    if (!previous || previous.type !== name) {
      this.warnings.push(`"ak:${name}" comment does not follow a ${name} block; it was ignored.`);
      return;
    }
    if (previous.type === 'table') {
      if (typeof data.caption === 'string' && data.caption) previous.caption = data.caption.slice(0, 500);
      if (data.footer === true && previous.rows.length > 0) previous.footer = previous.rows.pop()!;
      if (
        Array.isArray(data.widths) &&
        data.widths.length === previous.header.length &&
        data.widths.every((w) => typeof w === 'number' && w > 0)
      ) {
        previous.widths = data.widths as number[];
      }
    } else if (previous.type === 'paragraph') {
      if (
        data.align === 'left' ||
        data.align === 'center' ||
        data.align === 'right' ||
        data.align === 'justify'
      )
        previous.align = data.align;
    } else if (previous.type === 'image') {
      if (typeof data.width === 'number' && data.width >= 0.1 && data.width <= 1) previous.width = data.width;
    }
  }

  #block(node: MdNode): BlockInput[] {
    switch (node.type) {
      case 'heading': {
        const depth = node.depth ?? 1;
        if (depth > 4) this.warnings.push(`Heading level ${depth} was converted to level 4 (the maximum).`);
        const { runs, id } = this.#inlineWithAnchor(node.children ?? [], 'heading');
        return [{ type: 'heading', level: Math.min(4, Math.max(1, depth)), runs, ...(id ? { id } : {}) }];
      }
      case 'paragraph':
        return this.#paragraph(node);
      case 'list':
        return [this.#list(node, 1)];
      case 'table':
        return [this.#table(node)];
      case 'blockquote':
        return [this.#blockquote(node)];
      case 'code': {
        const lang = node.lang?.trim();
        const block: BlockInput = { type: 'code', text: node.value ?? '' };
        if (lang && LANGUAGE.test(lang)) block.language = lang;
        else if (lang) this.warnings.push(`Code language "${lang}" is not a simple name and was dropped.`);
        return [block];
      }
      case 'thematicBreak':
        return [{ type: 'divider' }];
      case 'definition':
        return [];
      case 'footnoteDefinition': {
        const runs = this.#flattenToRuns(node.children ?? []);
        return [
          {
            type: 'paragraph',
            runs: normalizeRuns([{ text: `[^${node.label ?? node.identifier ?? ''}]: ` }, ...runs]),
          },
        ];
      }
      default:
        this.warnings.push(`Unsupported Markdown "${node.type}" was dropped.`);
        return [];
    }
  }

  #paragraph(node: MdNode): BlockInput[] {
    const children = node.children ?? [];
    const plain = plainText(children).trim();
    if (/^\[(toc|\[_?toc_?\])\]$/i.test(plain)) return [{ type: 'toc' }];
    const out: BlockInput[] = [];
    let segment: MdNode[] = [];
    const flush = () => {
      const meaningful = segment.some(
        (child) => !(child.type === 'text' && !child.value?.trim()) && child.type !== 'break',
      );
      if (meaningful) {
        const { runs, id } = this.#inlineWithAnchor(trimSegment(segment), 'paragraph');
        out.push({ type: 'paragraph', runs, ...(id ? { id } : {}) });
      }
      segment = [];
    };
    for (const child of children) {
      if (child.type === 'image' || child.type === 'imageReference') {
        flush();
        const image = this.#image(child);
        if (image) out.push(image);
        continue;
      }
      segment.push(child);
    }
    flush();
    return out;
  }

  #image(node: MdNode): BlockInput | undefined {
    let url = node.url;
    let title = node.title ?? null;
    if (node.type === 'imageReference') {
      const definition = this.#definitions.get((node.identifier ?? '').toLowerCase());
      url = definition?.url;
      title = definition?.title ?? null;
    }
    const alt = (node.alt ?? '').trim();
    if (!url || !ASSET_REF_PATTERN.test(url)) {
      const problem = {
        message: `Image "${url ?? alt}" is not an asset reference; only "asset://<id>" images are allowed.`,
        hint: 'Register the file as an asset first and use ![alt text](asset://<id>), or remove the image.',
      };
      if (this.options.externalImages === 'drop') this.warnings.push(problem.message);
      else this.errors.push(problem);
      return undefined;
    }
    const block: BlockInput = { type: 'image', asset: url, alt: alt || url.slice('asset://'.length) };
    if (title) block.caption = title.slice(0, 500);
    return block;
  }

  #list(node: MdNode, depth: number): BlockInput & { type: 'list' } {
    const ordered = Boolean(node.ordered);
    const block: BlockInput & { type: 'list' } = {
      type: 'list',
      items: this.#listItems(node, depth, ordered),
    };
    if (ordered) block.ordered = true;
    if (ordered && typeof node.start === 'number' && node.start !== 1) block.start = node.start;
    if (block.items.length === 0) block.items = [{ runs: [] }];
    return block;
  }

  #listItems(list: MdNode, depth: number, ordered: boolean): ListItem[] {
    const items: ListItem[] = [];
    for (const itemNode of list.children ?? []) {
      const item: ListItem = { runs: [] };
      const textParts: Run[][] = [];
      const nested: { ordered: boolean; items: ListItem[] }[] = [];
      for (const child of itemNode.children ?? []) {
        if (child.type === 'list') {
          nested.push({
            ordered: Boolean(child.ordered),
            items: this.#listItems(child, depth + 1, Boolean(child.ordered)),
          });
        } else if (child.type === 'paragraph') {
          textParts.push(this.#inline(child.children ?? [], 'list item'));
        } else {
          this.warnings.push(`A ${child.type} inside a list item was flattened to text.`);
          textParts.push(this.#flattenToRuns([child]));
        }
      }
      const prefix: Run[] =
        itemNode.checked === true ? [{ text: '[x] ' }] : itemNode.checked === false ? [{ text: '[ ] ' }] : [];
      item.runs = normalizeRuns([...prefix, ...joinLines(textParts)]);
      const childItems = nested.flatMap((entry) => entry.items);
      if (childItems.length > 0) {
        if (depth >= 3) {
          // Deeper levels than the schema allows are hoisted to siblings at the third level.
          this.warnings.push('Lists nested deeper than 3 levels were flattened to the third level.');
          items.push(item, ...childItems);
          continue;
        }
        item.children = childItems;
        const childOrdered = nested[0]!.ordered;
        if (childOrdered !== ordered) item.childrenOrdered = childOrdered;
      }
      items.push(item);
    }
    return items;
  }

  #table(node: MdNode): BlockInput & { type: 'table' } {
    const rows = (node.children ?? []).map((row) =>
      (row.children ?? []).map((cell) => this.#inline(cell.children ?? [], 'table cell') as Cell),
    );
    const header = rows[0] ?? [[]];
    const width = header.length;
    const fit = (row: Cell[]) =>
      row.length >= width
        ? row.slice(0, width)
        : [...row, ...Array.from({ length: width - row.length }, () => [] as Cell)];
    const body = rows.slice(1).map(fit);
    if (rows.slice(1).some((row) => row.length > width))
      this.warnings.push('Table cells beyond the header width were dropped.');
    const block: BlockInput & { type: 'table' } = { type: 'table', header, rows: body };
    const align = (node.align ?? []).slice(0, width);
    if (align.some((value) => value !== null && value !== undefined)) {
      block.align = Array.from({ length: width }, (_, i) => {
        const value = align[i];
        return value === 'center' || value === 'right' ? value : 'left';
      });
    }
    return block;
  }

  #blockquote(node: MdNode): BlockInput {
    const children = node.children ?? [];
    const first = children[0];
    const firstText = first?.type === 'paragraph' ? first.children?.[0] : undefined;
    const alert =
      firstText?.type === 'text' ? /^\[!([A-Za-z]+)\][ \t]*([^\n]*)(\n|$)/.exec(firstText.value ?? '') : null;
    if (alert && ALERTS[alert[1]!.toUpperCase()] && first) {
      const tone = ALERTS[alert[1]!.toUpperCase()]!;
      const rest = (firstText!.value ?? '').slice(alert[0].length);
      const inline = [...(rest ? [{ ...firstText!, value: rest }] : []), ...(first.children ?? []).slice(1)];
      let title = alert[2]!.trim() || undefined;
      // GitHub-style title: a first line made only of bold text.
      if (!title && inline[0]?.type === 'strong') {
        const after = inline[1];
        if (
          !after ||
          (after.type === 'text' && (after.value ?? '').startsWith('\n')) ||
          after.type === 'break'
        ) {
          title = runsText(this.#inline([inline[0]], 'callout')).trim() || undefined;
          inline.shift();
          if (after?.type === 'text') inline[0] = { ...after, value: (after.value ?? '').replace(/^\n/, '') };
          else if (after?.type === 'break') inline.shift();
        }
      }
      const parts = [
        this.#inline(inline, 'callout'),
        ...children.slice(1).map((child) => this.#flattenToRuns([child])),
      ];
      const block: BlockInput = {
        type: 'callout',
        tone,
        runs: normalizeRuns(joinLines(parts.filter((p) => p.length > 0))),
      };
      if (title) block.title = title.slice(0, 300);
      return block;
    }
    let attribution: string | undefined;
    const body = [...children];
    const last = body[body.length - 1];
    if (body.length > 1 && last?.type === 'paragraph') {
      const text = runsText(this.#inline(last.children ?? [], 'quote')).trim();
      const match = /^(?:—|–|--)\s*(.+)$/s.exec(text);
      if (match) {
        attribution = match[1]!.replace(/\s+/g, ' ').slice(0, 300);
        body.pop();
      }
    }
    const parts = body.map((child) =>
      child.type === 'paragraph' ? this.#inline(child.children ?? [], 'quote') : this.#flattenToRuns([child]),
    );
    if (body.some((child) => child.type !== 'paragraph'))
      this.warnings.push('Blocks inside a quote were flattened to text.');
    const block: BlockInput = { type: 'quote', runs: normalizeRuns(joinLines(parts)) };
    if (attribution) block.attribution = attribution;
    return block;
  }

  /** Any block content as runs (used where the schema only allows text). */
  #flattenToRuns(nodes: MdNode[]): Run[] {
    const parts: Run[][] = [];
    for (const node of nodes) {
      switch (node.type) {
        case 'paragraph':
        case 'heading':
        case 'tableCell':
          parts.push(this.#inline(node.children ?? [], 'text'));
          break;
        case 'code':
          parts.push([{ text: node.value ?? '', code: true }]);
          break;
        case 'html':
          if (!/^<!--[\s\S]*-->$/.test((node.value ?? '').trim())) parts.push([{ text: node.value ?? '' }]);
          break;
        case 'thematicBreak':
        case 'definition':
          break;
        case 'listItem': {
          const runs = this.#flattenToRuns(node.children ?? []);
          parts.push(
            node.checked === true
              ? [{ text: '[x] ' }, ...runs]
              : node.checked === false
                ? [{ text: '[ ] ' }, ...runs]
                : runs,
          );
          break;
        }
        default:
          parts.push(this.#flattenToRuns(node.children ?? []));
      }
    }
    return normalizeRuns(joinLines(parts.filter((part) => part.length > 0)));
  }

  /** Inline content of a heading or paragraph, reading a trailing `<!-- #id -->` anchor. */
  #inlineWithAnchor(nodes: MdNode[], where: string): { runs: Run[]; id?: string } {
    let id: string | undefined;
    const kept = nodes.filter((node) => {
      const match = node.type === 'html' ? ANCHOR.exec((node.value ?? '').trim()) : null;
      if (match && !id && ITEM_ID_PATTERN.test(match[1]!)) {
        id = match[1]!;
        return false;
      }
      return true;
    });
    const runs = this.#inline(kept, where);
    // The anchor is written after a space; drop it with the anchor.
    const last = runs[runs.length - 1];
    if (id && last) last.text = last.text.replace(/[ \t]+$/, '');
    return { runs: normalizeRuns(runs), ...(id ? { id } : {}) };
  }

  #inline(nodes: MdNode[], where: string): Run[] {
    const out: Run[] = [];
    this.#walkInline(nodes, {}, out, where);
    return normalizeRuns(out);
  }

  #walkInline(nodes: MdNode[], marks: Marks, out: Run[], where: string): void {
    // Inline HTML tags like <u> toggle marks for the following siblings.
    const html: Marks = {};
    const current = (): Marks => ({ ...marks, ...html });
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out.push({ text: node.value ?? '', ...current() });
          break;
        case 'emphasis':
          this.#walkInline(node.children ?? [], { ...current(), italic: true }, out, where);
          break;
        case 'strong':
          this.#walkInline(node.children ?? [], { ...current(), bold: true }, out, where);
          break;
        case 'delete':
          this.#walkInline(node.children ?? [], { ...current(), strike: true }, out, where);
          break;
        case 'inlineCode':
          out.push({ text: node.value ?? '', ...current(), code: true });
          break;
        case 'break':
          out.push({ text: '\n', ...current() });
          break;
        case 'link':
        case 'linkReference': {
          const url =
            node.type === 'link'
              ? node.url
              : this.#definitions.get((node.identifier ?? '').toLowerCase())?.url;
          const next = { ...current() };
          if (url && isSafeLink(url)) next.link = url.trim();
          else
            this.warnings.push(`Link "${url ?? ''}" uses an unsupported protocol; only its text was kept.`);
          this.#walkInline(node.children ?? [], next, out, where);
          break;
        }
        case 'image':
        case 'imageReference':
          this.warnings.push(
            `Images are not allowed inside a ${where}; the image "${node.alt ?? ''}" was dropped.`,
          );
          break;
        case 'footnoteReference':
          out.push({ text: `[^${node.label ?? node.identifier ?? ''}]`, ...current() });
          break;
        case 'html':
          this.#inlineHtml(node.value ?? '', html, current, out);
          break;
        default:
          if (node.children) this.#walkInline(node.children, current(), out, where);
          else if (node.value) out.push({ text: node.value, ...current() });
      }
    }
  }

  #inlineHtml(raw: string, html: Marks, current: () => Marks, out: Run[]): void {
    const tag = /^<(\/?)([a-z]+)\s*\/?>$/i.exec(raw.trim());
    if (tag) {
      const closing = tag[1] === '/';
      const name = tag[2]!.toLowerCase();
      const mark = INLINE_TAGS[name];
      if (name === 'br') {
        out.push({ text: '\n', ...current() });
        return;
      }
      if (mark) {
        if (closing) delete html[mark];
        else html[mark] = true;
        return;
      }
    }
    if (/^<!--[\s\S]*-->$/.test(raw.trim())) return;
    out.push({ text: raw, ...current() });
  }
}

const INLINE_TAGS: Record<string, 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript'> =
  {
    b: 'bold',
    strong: 'bold',
    i: 'italic',
    em: 'italic',
    u: 'underline',
    ins: 'underline',
    s: 'strike',
    del: 'strike',
    strike: 'strike',
    sup: 'superscript',
    sub: 'subscript',
  };

/** Literal text of inline nodes, without conversion side effects. */
function plainText(nodes: readonly MdNode[]): string {
  return nodes.map((node) => node.value ?? (node.children ? plainText(node.children) : '')).join('');
}

function joinLines(parts: Run[][]): Run[] {
  const out: Run[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ text: '\n' });
    out.push(...part);
  });
  return out;
}

/** Drops whitespace-only text and line breaks at the edges of a paragraph segment split around images. */
function trimSegment(nodes: MdNode[]): MdNode[] {
  const out = [...nodes];
  while (out.length > 0 && (out[0]!.type === 'break' || (out[0]!.type === 'text' && !out[0]!.value?.trim())))
    out.shift();
  while (
    out.length > 0 &&
    (out[out.length - 1]!.type === 'break' ||
      (out[out.length - 1]!.type === 'text' && !out[out.length - 1]!.value?.trim()))
  )
    out.pop();
  if (out[0]?.type === 'text') out[0] = { ...out[0], value: (out[0].value ?? '').replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.type === 'text') out[out.length - 1] = { ...last, value: (last.value ?? '').replace(/\s+$/, '') };
  return out;
}
