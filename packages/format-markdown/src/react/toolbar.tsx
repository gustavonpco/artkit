import type { EditorActions } from '@artkit-ai/core';
import { type Editor, useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Columns3,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Quote,
  Redo2,
  Rows3,
  Save,
  SquareCode,
  Strikethrough,
  Table,
  Trash2,
  Undo2,
  Unlink,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { ALERT_KINDS } from '../extensions.js';

/** What the toolbar needs to know about the selection and the commands, read in one pass. */
interface ToolbarState {
  heading: 0 | 1 | 2 | 3;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  linkHref: string;
  blockquote: boolean;
  codeBlock: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  inTable: boolean;
  canBold: boolean;
  canItalic: boolean;
  canStrike: boolean;
  canCode: boolean;
  canLink: boolean;
  canClear: boolean;
  canParagraph: boolean;
  canHeading: boolean;
  canBlockquote: boolean;
  canCodeBlock: boolean;
  canBulletList: boolean;
  canOrderedList: boolean;
  canTaskList: boolean;
  canIndent: boolean;
  canOutdent: boolean;
  canRule: boolean;
  canAlert: boolean;
  canInsertTable: boolean;
  canAddRowBefore: boolean;
  canAddRowAfter: boolean;
  canDeleteRow: boolean;
  canAddColumnBefore: boolean;
  canAddColumnAfter: boolean;
  canDeleteColumn: boolean;
  canDeleteTable: boolean;
}

const EMPTY: ToolbarState = {
  heading: 0,
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  linkHref: '',
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  inTable: false,
  canBold: false,
  canItalic: false,
  canStrike: false,
  canCode: false,
  canLink: false,
  canClear: false,
  canParagraph: false,
  canHeading: false,
  canBlockquote: false,
  canCodeBlock: false,
  canBulletList: false,
  canOrderedList: false,
  canTaskList: false,
  canIndent: false,
  canOutdent: false,
  canRule: false,
  canAlert: false,
  canInsertTable: false,
  canAddRowBefore: false,
  canAddRowAfter: false,
  canDeleteRow: false,
  canAddColumnBefore: false,
  canAddColumnAfter: false,
  canDeleteColumn: false,
  canDeleteTable: false,
};

function readState(editor: Editor): ToolbarState {
  const can = editor.can();
  const heading = ([1, 2, 3] as const).find((level) => editor.isActive('heading', { level })) ?? 0;
  const canIndent = can.sinkListItem('listItem') || can.sinkListItem('taskItem');
  const canOutdent = can.liftListItem('listItem') || can.liftListItem('taskItem');
  return {
    heading,
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    link: editor.isActive('link'),
    linkHref: (editor.getAttributes('link').href as string | undefined) ?? '',
    blockquote: editor.isActive('blockquote'),
    codeBlock: editor.isActive('codeBlock'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    taskList: editor.isActive('taskList'),
    inTable: editor.isActive('table'),
    canBold: can.toggleBold(),
    canItalic: can.toggleItalic(),
    canStrike: can.toggleStrike(),
    canCode: can.toggleCode(),
    canLink: can.setLink({ href: 'https://example.com' }),
    canClear: can.unsetAllMarks(),
    canParagraph: can.setParagraph(),
    canHeading: can.toggleHeading({ level: 1 }),
    canBlockquote: can.toggleBlockquote(),
    canCodeBlock: can.toggleCodeBlock(),
    canBulletList: can.toggleBulletList(),
    canOrderedList: can.toggleOrderedList(),
    canTaskList: can.toggleTaskList(),
    canIndent,
    canOutdent,
    canRule: can.setHorizontalRule(),
    canAlert: can.toggleBlockquote(),
    canInsertTable: can.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    canAddRowBefore: can.addRowBefore(),
    canAddRowAfter: can.addRowAfter(),
    canDeleteRow: can.deleteRow(),
    canAddColumnBefore: can.addColumnBefore(),
    canAddColumnAfter: can.addColumnAfter(),
    canDeleteColumn: can.deleteColumn(),
    canDeleteTable: can.deleteTable(),
  };
}

const ALERT_LABELS: Record<(typeof ALERT_KINDS)[number], string> = {
  NOTE: 'Nota',
  TIP: 'Dica',
  IMPORTANT: 'Importante',
  WARNING: 'Aviso',
  CAUTION: 'Cuidado',
};

/**
 * Toolbar of the Markdown editor: everything the dialect can express, grouped the way a word processor groups it. Undo,
 * redo, the save status and the save button come from the host (`actions`). The table group appears only with the cursor
 * in a table. Arrow keys move between the buttons.
 */
export function MarkdownToolbar({ editor, actions }: { editor: Editor | null; actions?: EditorActions }) {
  const state =
    useEditorState({
      editor,
      selector: ({ editor: current }): ToolbarState => (current ? readState(current) : EMPTY),
    }) ?? EMPTY;
  const [linkOpen, setLinkOpen] = useState(false);

  if (!editor) return <div className="ak-word-ribbon" aria-hidden="true" />;
  const chain = () => editor.chain().focus();

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        'button:not([disabled]), select:not([disabled])',
      ),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(index + step + buttons.length) % buttons.length];
    event.preventDefault();
    next?.focus();
  }

  return (
    <div className="ak-word-ribbon" role="toolbar" aria-label="Formatação" onKeyDown={onKeyDown}>
      <Group label="Estilo">
        <select
          className="ak-select ak-word-style"
          aria-label="Estilo do parágrafo"
          value={String(state.heading)}
          disabled={!state.canHeading && !state.canParagraph}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value === 0) chain().setParagraph().run();
            else
              chain()
                .toggleHeading({ level: value as 1 | 2 | 3 })
                .run();
          }}
        >
          <option value="0">Normal</option>
          <option value="1">Título 1</option>
          <option value="2">Título 2</option>
          <option value="3">Título 3</option>
        </select>
      </Group>

      <Group label="Texto">
        <Btn
          label="Negrito"
          shortcut="Ctrl+B"
          icon={Bold}
          pressed={state.bold}
          disabled={!state.canBold}
          onRun={() => chain().toggleBold().run()}
        />
        <Btn
          label="Itálico"
          shortcut="Ctrl+I"
          icon={Italic}
          pressed={state.italic}
          disabled={!state.canItalic}
          onRun={() => chain().toggleItalic().run()}
        />
        <Btn
          label="Tachado"
          shortcut="Ctrl+Shift+X"
          icon={Strikethrough}
          pressed={state.strike}
          disabled={!state.canStrike}
          onRun={() => chain().toggleStrike().run()}
        />
        <Btn
          label="Código"
          shortcut="Ctrl+E"
          icon={Code}
          pressed={state.code}
          disabled={!state.canCode}
          onRun={() => chain().toggleCode().run()}
        />
        <Btn
          label={state.link ? 'Editar link' : 'Link'}
          shortcut="Ctrl+K"
          icon={Link}
          pressed={linkOpen || state.link}
          disabled={!state.canLink && !state.link}
          onRun={() => setLinkOpen((open) => !open)}
        />
        <Btn
          label="Limpar formatação"
          icon={Eraser}
          disabled={!state.canClear}
          onRun={() => chain().unsetAllMarks().setParagraph().run()}
        />
      </Group>

      {linkOpen ? (
        <LinkForm
          key={state.linkHref}
          href={state.linkHref}
          canRemove={state.link}
          onApply={(href) => {
            if (href.trim() === '') chain().extendMarkRange('link').unsetLink().run();
            else chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
            setLinkOpen(false);
          }}
          onRemove={() => {
            chain().extendMarkRange('link').unsetLink().run();
            setLinkOpen(false);
          }}
          onCancel={() => setLinkOpen(false)}
        />
      ) : null}

      <Group label="Listas">
        <Btn
          label="Lista com marcadores"
          icon={List}
          pressed={state.bulletList}
          disabled={!state.canBulletList}
          onRun={() => chain().toggleBulletList().run()}
        />
        <Btn
          label="Lista numerada"
          icon={ListOrdered}
          pressed={state.orderedList}
          disabled={!state.canOrderedList}
          onRun={() => chain().toggleOrderedList().run()}
        />
        <Btn
          label="Lista de tarefas"
          icon={ListChecks}
          pressed={state.taskList}
          disabled={!state.canTaskList}
          onRun={() => chain().toggleTaskList().run()}
        />
        <Btn
          label="Aumentar recuo"
          shortcut="Tab"
          icon={IndentIncrease}
          disabled={!state.canIndent}
          onRun={() => {
            if (editor.can().sinkListItem('listItem')) chain().sinkListItem('listItem').run();
            else chain().sinkListItem('taskItem').run();
          }}
        />
        <Btn
          label="Diminuir recuo"
          shortcut="Shift+Tab"
          icon={IndentDecrease}
          disabled={!state.canOutdent}
          onRun={() => {
            if (editor.can().liftListItem('listItem')) chain().liftListItem('listItem').run();
            else chain().liftListItem('taskItem').run();
          }}
        />
      </Group>

      <Group label="Blocos">
        <Btn
          label="Citação"
          icon={Quote}
          pressed={state.blockquote}
          disabled={!state.canBlockquote}
          onRun={() => chain().toggleBlockquote().run()}
        />
        <Btn
          label="Bloco de código"
          icon={SquareCode}
          pressed={state.codeBlock}
          disabled={!state.canCodeBlock}
          onRun={() => chain().toggleCodeBlock().run()}
        />
        <Btn
          label="Linha horizontal"
          icon={Minus}
          disabled={!state.canRule}
          onRun={() => chain().setHorizontalRule().run()}
        />
        <select
          className="ak-select ak-word-alert"
          aria-label="Inserir alerta"
          value=""
          disabled={!state.canAlert}
          onChange={(event) => {
            const kind = event.target.value as (typeof ALERT_KINDS)[number];
            if (!kind) return;
            // An alert is a quote whose first line is the marker, as the dialect writes it.
            chain()
              .insertContent({
                type: 'blockquote',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: `[!${kind}]` }] },
                  { type: 'paragraph' },
                ],
              })
              .run();
          }}
        >
          <option value="">Alerta…</option>
          {ALERT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ALERT_LABELS[kind]}
            </option>
          ))}
        </select>
      </Group>

      <Group label="Tabela">
        <Btn
          label="Inserir tabela"
          icon={Table}
          pressed={state.inTable}
          disabled={!state.canInsertTable}
          onRun={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
      </Group>

      {state.inTable ? (
        <Group label="Tabela atual">
          <Btn
            label="Linha acima"
            icon={Rows3}
            disabled={!state.canAddRowBefore}
            onRun={() => chain().addRowBefore().run()}
          />
          <Btn
            label="Linha abaixo"
            icon={Rows3}
            disabled={!state.canAddRowAfter}
            onRun={() => chain().addRowAfter().run()}
          />
          <Btn
            label="Excluir linha"
            icon={Trash2}
            disabled={!state.canDeleteRow}
            onRun={() => chain().deleteRow().run()}
          />
          <Btn
            label="Coluna à esquerda"
            icon={Columns3}
            disabled={!state.canAddColumnBefore}
            onRun={() => chain().addColumnBefore().run()}
          />
          <Btn
            label="Coluna à direita"
            icon={Columns3}
            disabled={!state.canAddColumnAfter}
            onRun={() => chain().addColumnAfter().run()}
          />
          <Btn
            label="Excluir coluna"
            icon={Trash2}
            disabled={!state.canDeleteColumn}
            onRun={() => chain().deleteColumn().run()}
          />
          <Btn
            label="Excluir tabela"
            icon={Trash2}
            disabled={!state.canDeleteTable}
            onRun={() => chain().deleteTable().run()}
          />
        </Group>
      ) : null}

      {actions ? <DraftActions actions={actions} /> : null}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="ak-word-group" aria-label={label}>
      {children}
    </fieldset>
  );
}

function Btn({
  label,
  shortcut,
  icon: Icon,
  pressed,
  disabled,
  onRun,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  pressed?: boolean;
  disabled?: boolean;
  onRun(): void;
}) {
  return (
    <button
      type="button"
      className="ak-button ak-word-command"
      data-variant="quiet"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the text selection: the command runs on the editor, not on the button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

function LinkForm({
  href,
  canRemove,
  onApply,
  onRemove,
  onCancel,
}: {
  href: string;
  canRemove: boolean;
  onApply(href: string): void;
  onRemove(): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(href);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="ak-word-link"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <input
        type="url"
        className="ak-word-link-input"
        aria-label="Endereço do link"
        placeholder="https://"
        value={value}
        ref={input}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="ak-button" data-variant="primary">
        Aplicar
      </button>
      {canRemove ? (
        <button type="button" className="ak-button" onClick={onRemove} aria-label="Remover link">
          <Unlink aria-hidden="true" />
          Remover
        </button>
      ) : null}
      <button type="button" className="ak-button" data-variant="quiet" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}

/** Undo, redo, save status and save, at the end of the ribbon. */
function DraftActions({ actions }: { actions: EditorActions }) {
  return (
    <fieldset className="ak-word-group ak-word-draft" aria-label="Rascunho">
      <Btn label="Desfazer" shortcut="Ctrl+Z" icon={Undo2} disabled={!actions.canUndo} onRun={actions.undo} />
      <Btn
        label="Refazer"
        shortcut="Ctrl+Shift+Z"
        icon={Redo2}
        disabled={!actions.canRedo}
        onRun={actions.redo}
      />
      <span className="ak-word-status" role="status" aria-live="polite">
        {actions.dirty ? 'Alterações não salvas' : 'Salvo'}
      </span>
      <button
        type="button"
        className="ak-button ak-word-save"
        data-variant="primary"
        disabled={!actions.canSave}
        onClick={actions.save}
      >
        <Save aria-hidden="true" />
        {actions.saving ? 'Salvando…' : 'Salvar'}
      </button>
    </fieldset>
  );
}
