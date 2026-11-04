import { ASSET_REF_PATTERN, IdAllocator, isSafeLink, type LintIssue } from '@artkit-ai/core';
import { type AnyExtension, Extension, Mark, mergeAttributes, Node } from '@tiptap/core';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { StarterKit } from '@tiptap/starter-kit';
import { idPrefix } from '../normalize.js';
import type { Block } from '../schema.js';

/** Node types that map to blocks and carry a `blockId`. */
export const BLOCK_NODE_TYPES: Record<string, Block['type']> = {
  heading: 'heading',
  paragraph: 'paragraph',
  bulletList: 'list',
  orderedList: 'list',
  table: 'table',
  callout: 'callout',
  blockquote: 'quote',
  codeBlock: 'code',
  docImage: 'image',
  horizontalRule: 'divider',
  pageBreak: 'pageBreak',
  toc: 'toc',
};

export const blockIdsKey = new PluginKey('akBlockIds');
export const lintKey = new PluginKey('akLint');

export interface DocumentEditorExtensionOptions {
  /** Ids that must never be generated again (every id seen in the content, including removed ones). */
  knownIds?: () => Iterable<string>;
  resolveAssetUrl?: (ref: string) => string | undefined;
  /** Current lint issues, shown as decorations on the blocks they target. */
  lint?: () => readonly LintIssue[] | undefined;
  locale?: string;
}

const pt = (locale: string | undefined) => locale?.toLowerCase().startsWith('pt') ?? false;

/**
 * Gives every top-level node a unique `blockId`. New nodes adopt the id of a wrapped block when possible
 * (turning a paragraph into a list keeps its id), otherwise a fresh id is generated with the block prefix.
 */
function blockIdsPlugin(knownIds: () => Iterable<string>): Plugin {
  return new Plugin({
    key: blockIdsKey,
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const doc = state.doc;
      const topIds = new Set<string>();
      doc.forEach((node) => {
        if (typeof node.attrs.blockId === 'string') topIds.add(node.attrs.blockId);
      });
      const allocator = new IdAllocator([...knownIds(), ...topIds]);
      const used = new Set<string>();
      const changes: { pos: number; id: string }[] = [];
      const single =
        doc.childCount === 1 &&
        doc.firstChild?.type.name === 'paragraph' &&
        doc.firstChild.content.size === 0;
      doc.forEach((node, pos) => {
        const type = BLOCK_NODE_TYPES[node.type.name];
        if (!type) return;
        const current = node.attrs.blockId;
        if (typeof current === 'string' && current && !used.has(current)) {
          used.add(current);
          return;
        }
        // The empty placeholder paragraph of an empty document stays without id until it gets text.
        if (single && !current) return;
        let adopted: string | undefined;
        node.descendants((child) => {
          const candidate = child.attrs.blockId;
          if (
            !adopted &&
            typeof candidate === 'string' &&
            candidate &&
            !topIds.has(candidate) &&
            !used.has(candidate)
          )
            adopted = candidate;
          return !adopted;
        });
        const id = adopted ?? allocator.next(idPrefix(type));
        allocator.reserve(id);
        used.add(id);
        changes.push({ pos, id });
      });
      if (changes.length === 0) return null;
      const tr = state.tr;
      for (const change of changes) tr.setNodeAttribute(change.pos, 'blockId', change.id);
      tr.setMeta('addToHistory', false);
      return tr;
    },
  });
}

function lintPlugin(lint: () => readonly LintIssue[] | undefined): Plugin {
  return new Plugin({
    key: lintKey,
    props: {
      decorations(state) {
        const issues = lint() ?? [];
        if (issues.length === 0) return DecorationSet.empty;
        const byBlock = new Map<string, string[]>();
        for (const issue of issues) {
          if (!issue.target.startsWith('block:')) continue;
          const id = issue.target.slice('block:'.length);
          byBlock.set(id, [...(byBlock.get(id) ?? []), issue.message]);
        }
        const decorations: Decoration[] = [];
        state.doc.forEach((node: PMNode, pos: number) => {
          const messages = byBlock.get(String(node.attrs.blockId ?? ''));
          if (messages) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: 'ak-document-editor-lint',
                title: messages.join('\n'),
              }),
            );
          }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

const BlockIds = Extension.create<DocumentEditorExtensionOptions>({
  name: 'akBlockIds',
  addOptions() {
    return {};
  },
  addGlobalAttributes() {
    return [
      {
        types: Object.keys(BLOCK_NODE_TYPES),
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            // Ids never come from pasted HTML, so a pasted copy can't steal the id of the original block.
            parseHTML: () => null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.blockId ? { 'data-block-id': String(attributes.blockId) } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [blockIdsPlugin(options.knownIds ?? (() => [])), lintPlugin(options.lint ?? (() => []))];
  },
});

/** Inline code that, unlike TipTap's default, can be combined with other marks (the schema allows it). */
const Code = Mark.create({
  name: 'code',
  excludes: '',
  code: true,
  parseHTML: () => [{ tag: 'code' }],
  renderHTML: ({ HTMLAttributes }) => ['code', HTMLAttributes, 0],
  addKeyboardShortcuts() {
    return { 'Mod-e': () => this.editor.commands.toggleMark(this.name) };
  },
});

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      tone: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-tone') ?? 'info',
        renderHTML: () => ({}),
      },
      title: { default: null, parseHTML: (el) => el.getAttribute('data-title'), renderHTML: () => ({}) },
    };
  },
  parseHTML: () => [
    { tag: 'aside[data-callout]', contentElement: 'p.ak-document-callout-body' },
    { tag: 'aside[data-callout]' },
  ],
  renderHTML({ node, HTMLAttributes }) {
    const tone = String(node.attrs.tone);
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-callout': '',
      'data-tone': tone,
      class: `ak-document-callout ak-document-callout--${tone}`,
      role: 'note',
    });
    return node.attrs.title
      ? [
          'aside',
          attrs,
          ['p', { class: 'ak-document-callout-title', contenteditable: 'false' }, String(node.attrs.title)],
          ['p', { class: 'ak-document-callout-body' }, 0],
        ]
      : ['aside', attrs, ['p', { class: 'ak-document-callout-body' }, 0]];
  },
});

const Attribution = Extension.create({
  name: 'akQuoteAttribution',
  addGlobalAttributes() {
    return [
      {
        types: ['blockquote'],
        attributes: { attribution: { default: null, parseHTML: () => null, renderHTML: () => ({}) } },
      },
    ];
  },
});

const TableAttributes = Extension.create({
  name: 'akTableAttributes',
  addGlobalAttributes() {
    const hidden = (fallback: unknown) => ({
      default: fallback,
      parseHTML: () => fallback,
      renderHTML: () => ({}),
    });
    return [
      {
        types: ['table'],
        attributes: {
          caption: hidden(null),
          widths: hidden(null),
          hasFooter: hidden(false),
          hasAlign: hidden(false),
        },
      },
    ];
  },
});

function createDocImage(options: DocumentEditorExtensionOptions) {
  return Node.create({
    name: 'docImage',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        asset: {
          default: null,
          parseHTML: (el) =>
            ASSET_REF_PATTERN.test(el.getAttribute('data-asset') ?? '')
              ? el.getAttribute('data-asset')
              : null,
          renderHTML: () => ({}),
        },
        alt: { default: '', parseHTML: (el) => el.getAttribute('data-alt') ?? '', renderHTML: () => ({}) },
        caption: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-caption'),
          renderHTML: () => ({}),
        },
        width: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      };
    },
    parseHTML: () => [{ tag: 'figure[data-ak-image]' }],
    renderHTML({ node, HTMLAttributes }) {
      const asset = String(node.attrs.asset ?? '');
      const alt = String(node.attrs.alt ?? '');
      const src = options.resolveAssetUrl?.(asset);
      const attrs = mergeAttributes(HTMLAttributes, {
        'data-ak-image': '',
        'data-asset': asset,
        'data-alt': alt,
        ...(node.attrs.caption ? { 'data-caption': String(node.attrs.caption) } : {}),
        class: 'ak-document-image',
        ...(typeof node.attrs.width === 'number'
          ? { style: `width:${Math.round(node.attrs.width * 100)}%` }
          : {}),
      });
      const media = src
        ? ['img', { src, alt }]
        : ['div', { class: 'ak-document-image-placeholder', role: 'img', 'aria-label': alt }, alt];
      return node.attrs.caption
        ? ['figure', attrs, media, ['figcaption', {}, String(node.attrs.caption)]]
        : ['figure', attrs, media];
    },
  });
}

function createPageBreak(options: DocumentEditorExtensionOptions) {
  return Node.create({
    name: 'pageBreak',
    group: 'block',
    atom: true,
    selectable: true,
    parseHTML: () => [{ tag: 'div[data-ak-page-break]' }],
    renderHTML({ HTMLAttributes }) {
      const label = pt(options.locale) ? 'Quebra de página' : 'Page break';
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          'data-ak-page-break': '',
          class: 'ak-document-page-break',
          role: 'separator',
          'aria-label': label,
        }),
        ['span', {}, label],
      ];
    },
  });
}

function createToc(options: DocumentEditorExtensionOptions) {
  return Node.create({
    name: 'toc',
    group: 'block',
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        maxLevel: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
        title: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      };
    },
    parseHTML: () => [{ tag: 'nav[data-ak-toc]' }],
    renderHTML({ node, HTMLAttributes }) {
      const isPt = pt(options.locale);
      const title = String(node.attrs.title ?? (isPt ? 'Sumário' : 'Contents'));
      const levels = `${isPt ? 'títulos' : 'headings'} 1–${node.attrs.maxLevel ?? 3}`;
      return [
        'nav',
        mergeAttributes(HTMLAttributes, { 'data-ak-toc': '', class: 'ak-document-toc', 'aria-label': title }),
        ['p', { class: 'ak-document-toc-title' }, title],
        ['p', {}, `(${levels})`],
      ];
    },
  });
}

/** TipTap extensions whose schema matches the document model. */
export function documentEditorExtensions(options: DocumentEditorExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      code: false,
      // Undo/redo belongs to the host, which owns the operation history.
      undoRedo: false,
      // An automatic trailing paragraph would become a block of its own.
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url) => isSafeLink(url),
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    Code,
    Subscript,
    Superscript,
    TextAlign.configure({
      types: ['paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: null,
    }),
    Table.configure({ resizable: false, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    Callout,
    Attribution,
    TableAttributes,
    createDocImage(options),
    createPageBreak(options),
    createToc(options),
    BlockIds.configure(options),
  ];
}
