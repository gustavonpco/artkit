import { deepEqual, type EditorBindings, IdAllocator, isSafeLink } from '@artkit-ai/core';
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarMenu, ToolbarSelect } from '@artkit-ai/react';
import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  PanelBottom,
  Plus,
  RemoveFormatting,
  SeparatorHorizontal,
  Sigma,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableColumnsSplit,
  TableRowsSplit,
  TextQuote,
  Trash2,
  Underline,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { idPrefix } from '../normalize.js';
import type { DocumentOperation } from '../operations.js';
import type { Block, CalloutBlock, DocumentContent } from '../schema.js';
import { diffBlocksToOperations } from './diff-ops.js';
import { documentEditorExtensions, lintKey } from './extensions.js';
import { blocksToDoc, docToBlocks, editorView, isPlaceholderDoc } from './mapping.js';

export type DocumentEditorProps = EditorBindings<DocumentContent, DocumentOperation> & { className?: string };

const EXTERNAL = 'akExternalContent';

/** Blocks of the current editor state (the empty placeholder document has none). */
export function editorBlocks(editor: Editor, knownIds: Iterable<string>): Block[] {
  const json = editor.getJSON();
  if (isPlaceholderDoc(json)) return [];
  const allocator = new IdAllocator(knownIds);
  return docToBlocks(json, (type) => allocator.next(idPrefix(type)));
}

/** Replaces only the top-level nodes that differ, so the selection elsewhere is kept. */
function applyExternalContent(editor: Editor, json: JSONContent): void {
  const { state } = editor;
  const next = state.schema.nodeFromJSON(json);
  const current = state.doc;
  let start = 0;
  while (start < current.childCount && start < next.childCount && current.child(start).eq(next.child(start)))
    start++;
  let endCurrent = current.childCount;
  let endNext = next.childCount;
  while (endCurrent > start && endNext > start && current.child(endCurrent - 1).eq(next.child(endNext - 1))) {
    endCurrent--;
    endNext--;
  }
  if (start === endCurrent && start === endNext) return;
  const offset = (doc: typeof current, index: number) => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    return pos;
  };
  const nodes = [];
  for (let i = start; i < endNext; i++) nodes.push(next.child(i));
  const tr = state.tr.replaceWith(offset(current, start), offset(current, endCurrent), Fragment.from(nodes));
  tr.setMeta(EXTERNAL, true).setMeta('addToHistory', false).setMeta('preventUpdate', false);
  editor.view.dispatch(tr);
}

const LABELS = {
  en: {
    toolbar: 'Formatting',
    blockType: 'Block type',
    paragraph: 'Paragraph',
    heading: 'Heading',
    code: 'Code block',
    callout: 'Callout',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strikethrough',
    inlineCode: 'Inline code',
    superscript: 'Superscript',
    subscript: 'Subscript',
    link: 'Link',
    linkPrompt: 'Link address (https://, mailto: or #block-id). Leave empty to remove.',
    bullets: 'Bulleted list',
    numbers: 'Numbered list',
    quote: 'Quote',
    alignLeft: 'Align left',
    alignCenter: 'Center',
    alignRight: 'Align right',
    justify: 'Justify',
    table: 'Insert table',
    addRow: 'Add row',
    removeRow: 'Remove row',
    addColumn: 'Add column',
    removeColumn: 'Remove column',
    footer: 'Footer row',
    removeTable: 'Remove table',
    divider: 'Divider',
    pageBreak: 'Page break',
    toc: 'Table of contents',
    insert: 'Insert',
    tableMenu: 'Table',
    clearFormat: 'Clear formatting',
    text: 'Text',
    lists: 'Lists',
    alignment: 'Alignment',
    editor: 'Document editor',
    tones: { info: 'Info', warning: 'Warning', success: 'Success', danger: 'Danger' },
  },
  pt: {
    toolbar: 'Formatação',
    blockType: 'Tipo de bloco',
    paragraph: 'Parágrafo',
    heading: 'Título',
    code: 'Bloco de código',
    callout: 'Destaque',
    bold: 'Negrito',
    italic: 'Itálico',
    underline: 'Sublinhado',
    strike: 'Tachado',
    inlineCode: 'Código',
    superscript: 'Sobrescrito',
    subscript: 'Subscrito',
    link: 'Link',
    linkPrompt: 'Endereço do link (https://, mailto: ou #id-do-bloco). Deixe vazio para remover.',
    bullets: 'Lista com marcadores',
    numbers: 'Lista numerada',
    quote: 'Citação',
    alignLeft: 'Alinhar à esquerda',
    alignCenter: 'Centralizar',
    alignRight: 'Alinhar à direita',
    justify: 'Justificar',
    table: 'Inserir tabela',
    addRow: 'Adicionar linha',
    removeRow: 'Remover linha',
    addColumn: 'Adicionar coluna',
    removeColumn: 'Remover coluna',
    footer: 'Linha de rodapé',
    removeTable: 'Remover tabela',
    divider: 'Divisor',
    pageBreak: 'Quebra de página',
    toc: 'Sumário',
    insert: 'Inserir',
    tableMenu: 'Tabela',
    clearFormat: 'Limpar formatação',
    text: 'Texto',
    lists: 'Listas',
    alignment: 'Alinhamento',
    editor: 'Editor de documento',
    tones: { info: 'Informação', warning: 'Atenção', success: 'Sucesso', danger: 'Perigo' },
  },
};

type Labels = (typeof LABELS)['en'];

function blockTypeOf(editor: Editor): string {
  for (const level of [1, 2, 3, 4]) if (editor.isActive('heading', { level })) return `h${level}`;
  if (editor.isActive('codeBlock')) return 'code';
  if (editor.isActive('callout')) return `callout-${String(editor.getAttributes('callout').tone ?? 'info')}`;
  return 'paragraph';
}

function DocumentToolbar({ editor, labels }: { editor: Editor; labels: Labels }): ReactNode {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      blockType: blockTypeOf(e),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      superscript: e.isActive('superscript'),
      subscript: e.isActive('subscript'),
      link: e.isActive('link'),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      align: (e.getAttributes('paragraph').textAlign as string | null) ?? 'left',
      inTable: e.isActive('table'),
      hasFooter: Boolean(e.getAttributes('table').hasFooter),
    }),
  });
  if (!state?.editable) return null;
  const chain = () => editor.chain().focus();
  const setBlockType = (value: string) => {
    if (value === 'paragraph') chain().setParagraph().run();
    else if (value === 'code') chain().setCodeBlock().run();
    else if (value.startsWith('callout-'))
      chain()
        .setNode('callout', { tone: value.slice('callout-'.length) })
        .run();
    else
      chain()
        .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 })
        .run();
  };
  const editLink = () => {
    const current = String(editor.getAttributes('link').href ?? '');
    const href = globalThis.prompt?.(labels.linkPrompt, current);
    if (href === null || href === undefined) return;
    if (href.trim() === '') chain().extendMarkRange('link').unsetLink().run();
    else if (isSafeLink(href)) chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };
  const insert = (node: JSONContent) => chain().insertContent(node).run();
  const tones: CalloutBlock['tone'][] = ['info', 'warning', 'success', 'danger'];
  const blockOptions = [
    { value: 'paragraph', label: labels.paragraph },
    ...[1, 2, 3, 4].map((level) => ({ value: `h${level}`, label: `${labels.heading} ${level}` })),
    { value: 'code', label: labels.code },
    ...tones.map((tone) => ({ value: `callout-${tone}`, label: `${labels.callout}: ${labels.tones[tone]}` })),
  ];
  const align = (value: 'left' | 'center' | 'right' | 'justify') => () => chain().setTextAlign(value).run();
  return (
    <Toolbar label={labels.toolbar} className="ak-document-editor-toolbar">
      <ToolbarGroup label={labels.blockType}>
        <ToolbarSelect
          label={labels.blockType}
          value={state.blockType}
          options={blockOptions}
          onChange={setBlockType}
          width={168}
        />
      </ToolbarGroup>
      <ToolbarGroup label={labels.text}>
        <ToolbarButton
          icon={Bold}
          label={labels.bold}
          shortcut="Ctrl+B"
          pressed={state.bold}
          onClick={() => chain().toggleBold().run()}
        />
        <ToolbarButton
          icon={Italic}
          label={labels.italic}
          shortcut="Ctrl+I"
          pressed={state.italic}
          onClick={() => chain().toggleItalic().run()}
        />
        <ToolbarButton
          icon={Underline}
          label={labels.underline}
          shortcut="Ctrl+U"
          pressed={state.underline}
          onClick={() => chain().toggleUnderline().run()}
        />
        <ToolbarButton
          icon={Strikethrough}
          label={labels.strike}
          shortcut="Ctrl+Shift+S"
          pressed={state.strike}
          onClick={() => chain().toggleStrike().run()}
        />
        <ToolbarButton
          icon={Code}
          label={labels.inlineCode}
          shortcut="Ctrl+E"
          pressed={state.code}
          onClick={() => chain().toggleMark('code').run()}
        />
        <ToolbarButton
          icon={Superscript}
          label={labels.superscript}
          pressed={state.superscript}
          onClick={() => chain().toggleSuperscript().run()}
        />
        <ToolbarButton
          icon={Subscript}
          label={labels.subscript}
          pressed={state.subscript}
          onClick={() => chain().toggleSubscript().run()}
        />
        <ToolbarButton
          icon={Link}
          label={labels.link}
          shortcut="Ctrl+K"
          pressed={state.link}
          onClick={editLink}
        />
        <ToolbarButton
          icon={RemoveFormatting}
          label={labels.clearFormat}
          onClick={() => chain().unsetAllMarks().run()}
        />
      </ToolbarGroup>
      <ToolbarGroup label={labels.lists}>
        <ToolbarButton
          icon={List}
          label={labels.bullets}
          shortcut="Ctrl+Shift+8"
          pressed={state.bullets}
          onClick={() => chain().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ListOrdered}
          label={labels.numbers}
          shortcut="Ctrl+Shift+7"
          pressed={state.numbers}
          onClick={() => chain().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={TextQuote}
          label={labels.quote}
          shortcut="Ctrl+Shift+B"
          pressed={state.quote}
          onClick={() => chain().toggleBlockquote().run()}
        />
      </ToolbarGroup>
      <ToolbarGroup label={labels.alignment}>
        <ToolbarButton
          icon={AlignLeft}
          label={labels.alignLeft}
          pressed={state.align === 'left'}
          onClick={align('left')}
        />
        <ToolbarButton
          icon={AlignCenter}
          label={labels.alignCenter}
          pressed={state.align === 'center'}
          onClick={align('center')}
        />
        <ToolbarButton
          icon={AlignRight}
          label={labels.alignRight}
          pressed={state.align === 'right'}
          onClick={align('right')}
        />
        <ToolbarButton
          icon={AlignJustify}
          label={labels.justify}
          pressed={state.align === 'justify'}
          onClick={align('justify')}
        />
      </ToolbarGroup>
      <ToolbarGroup label={labels.insert}>
        <ToolbarMenu
          icon={Plus}
          label={labels.insert}
          showLabel
          items={[
            {
              key: 'table',
              label: labels.table,
              icon: Table,
              onSelect: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            },
            {
              key: 'divider',
              label: labels.divider,
              icon: SeparatorHorizontal,
              onSelect: () => chain().setHorizontalRule().run(),
            },
            {
              key: 'pageBreak',
              label: labels.pageBreak,
              icon: PanelBottom,
              onSelect: () => insert({ type: 'pageBreak' }),
            },
            { key: 'toc', label: labels.toc, icon: ListTree, onSelect: () => insert({ type: 'toc' }) },
          ]}
        />
        {state.inTable ? (
          <ToolbarMenu
            icon={Table}
            label={labels.tableMenu}
            showLabel
            items={[
              {
                key: 'addRow',
                label: labels.addRow,
                icon: BetweenHorizontalEnd,
                onSelect: () => chain().addRowAfter().run(),
              },
              {
                key: 'removeRow',
                label: labels.removeRow,
                icon: TableRowsSplit,
                onSelect: () => chain().deleteRow().run(),
              },
              {
                key: 'addColumn',
                label: labels.addColumn,
                icon: BetweenVerticalEnd,
                onSelect: () => chain().addColumnAfter().run(),
              },
              {
                key: 'removeColumn',
                label: labels.removeColumn,
                icon: TableColumnsSplit,
                onSelect: () => chain().deleteColumn().run(),
              },
              'separator',
              {
                key: 'footer',
                label: labels.footer,
                icon: Sigma,
                checked: state.hasFooter,
                onSelect: () => chain().updateAttributes('table', { hasFooter: !state.hasFooter }).run(),
              },
              'separator',
              {
                key: 'removeTable',
                label: labels.removeTable,
                icon: Trash2,
                danger: true,
                onSelect: () => chain().deleteTable().run(),
              },
            ]}
          />
        ) : null}
      </ToolbarGroup>
    </Toolbar>
  );
}

/**
 * Rich-text editor for documents, built on TipTap. It renders `content` and turns every change into
 * block operations (`insert_block`, `update_block`, `remove_block`, `move_block`) through `emit`; text
 * typing is emitted with `{ kind: 'typing' }`. Changes to `content` from outside (an agent commit) are
 * merged into the editor without resetting the selection.
 */
export function DocumentEditor({
  content,
  ctx,
  emit,
  readOnly,
  lint,
  className,
}: DocumentEditorProps): ReactNode {
  const labels = ctx.locale.toLowerCase().startsWith('pt') ? LABELS.pt : LABELS.en;
  const knownIds = useRef(new Set<string>(content.blocks.map((block) => block.id)));
  const baseline = useRef<Block[]>(editorView(content.blocks));
  // States emitted but not yet echoed back through `content`.
  const pending = useRef<Block[][]>([]);
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const lintRef = useRef(lint);
  lintRef.current = lint;
  const resolveRef = useRef(ctx.resolveAssetUrl);
  resolveRef.current = ctx.resolveAssetUrl;

  const editor = useEditor({
    extensions: documentEditorExtensions({
      knownIds: () => knownIds.current,
      lint: () => lintRef.current,
      resolveAssetUrl: (ref) => resolveRef.current?.(ref),
      locale: ctx.locale,
    }),
    content: blocksToDoc(content.blocks),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'ak-document ak-document-editor-content',
        'aria-label': labels.editor,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta(EXTERNAL)) return;
      const blocks = editorBlocks(current, knownIds.current);
      const ops = diffBlocksToOperations(baseline.current, blocks);
      if (ops.length === 0) return;
      baseline.current = blocks;
      pending.current.push(blocks);
      for (const block of blocks) knownIds.current.add(block.id);
      const typing = ops.every(
        (op) =>
          op.op === 'update_block' &&
          Object.keys(op.fields).every(
            (key) =>
              key === 'runs' ||
              key === 'items' ||
              key === 'text' ||
              key === 'header' ||
              key === 'rows' ||
              key === 'footer',
          ),
      );
      emitRef.current(ops, typing ? { kind: 'typing' } : { kind: 'discrete' });
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    for (const block of content.blocks) knownIds.current.add(block.id);
    const incoming = editorView(content.blocks);
    const echo = pending.current.findIndex((state) => deepEqual(state, incoming));
    if (echo >= 0) {
      pending.current = pending.current.slice(echo + 1);
      return;
    }
    pending.current = [];
    baseline.current = incoming;
    if (deepEqual(incoming, editorBlocks(editor, knownIds.current))) return;
    applyExternalContent(editor, blocksToDoc(content.blocks));
  }, [content, editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // Decorations read the lint ref; an empty transaction makes ProseMirror redraw them when lint changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lint` is the trigger, read through lintRef.
  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta(lintKey, true).setMeta(EXTERNAL, true));
  }, [editor, lint]);

  return (
    <div className={['ak-document-editor', className ?? ''].filter(Boolean).join(' ')}>
      {editor ? <DocumentToolbar editor={editor} labels={labels} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
