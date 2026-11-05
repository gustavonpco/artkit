import type { EditorBindings, RenderContext } from '@artkit-ai/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import { splitFrontMatter } from '../document.js';
import { editOperations, type MarkdownEditOperation, splitBody, withFrontMatter } from '../edit.js';
import { dialectExtensions, unescapeAlerts } from '../extensions.js';
import { markdownCss } from './css.js';
import { MarkdownToolbar } from './toolbar.js';

export interface MarkdownRendererProps {
  content: string;
  ctx: RenderContext;
  className?: string;
}

function normalized(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

/** Heading anchors (`{#id}`) are part of the stored text, not of what the reader sees. */
function withoutAnchors(body: string): string {
  return body.replace(/^(#{1,6}[ \t]+.*?)[ \t]+\{#[A-Za-z0-9][A-Za-z0-9_-]{0,63}\}[ \t]*$/gm, '$1');
}

/** Read-only Markdown view on Tiptap (spec §10.7), laid out as a page. */
export function MarkdownRenderer({ content, className, ctx }: MarkdownRendererProps) {
  const { body } = splitFrontMatter(content.replace(/\r\n/g, '\n'));
  const shown = withoutAnchors(body);
  const editor = useEditor(
    {
      extensions: dialectExtensions(),
      content: shown,
      contentType: 'markdown',
      editable: false,
      immediatelyRender: false,
    },
    [],
  );
  useEffect(() => {
    if (editor && normalized(unescapeAlerts(editor.getMarkdown())) !== normalized(shown)) {
      editor.commands.setContent(shown, { contentType: 'markdown' });
    }
  }, [editor, shown]);
  return (
    <div className={`ak-markdown ak-word-view${className ? ` ${className}` : ''}`} data-locale={ctx.locale}>
      <div className="ak-word-canvas">
        <div className="ak-word-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

export interface MarkdownEditorProps extends EditorBindings<string, MarkdownEditOperation> {
  className?: string;
}

/**
 * Editable Markdown on Tiptap, laid out like a word processor: the command toolbar above a page. The frontmatter is kept
 * as it was unless a structural edit replaces the whole document. Every change becomes operations relative to the
 * content it was loaded from (spec §14.3). Undo, redo and save come from the host (`actions`).
 */
export function MarkdownEditor({ content, emit, readOnly, className, ctx, actions }: MarkdownEditorProps) {
  const latest = useRef(content);
  latest.current = content;
  const { body } = splitBody(content);
  const editor = useEditor(
    {
      extensions: dialectExtensions(),
      content: body,
      contentType: 'markdown',
      editable: !readOnly,
      immediatelyRender: false,
      onUpdate: ({ editor: current }) => {
        const before = splitBody(latest.current);
        const operations = editOperations(before.body, unescapeAlerts(current.getMarkdown())).map((op) =>
          op.op === 'replace_content'
            ? { op: 'replace_content' as const, content: withFrontMatter(before.frontMatter, op.content) }
            : op,
        );
        if (operations.length > 0) emit(operations, { kind: 'typing' });
      },
    },
    [],
  );
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor && normalized(unescapeAlerts(editor.getMarkdown())) !== normalized(body)) {
      editor.commands.setContent(body, { contentType: 'markdown' });
    }
  }, [editor, body]);
  return (
    <div
      className={`ak-markdown ak-markdown-editor ak-word${className ? ` ${className}` : ''}`}
      data-locale={ctx.locale}
    >
      {readOnly ? null : <MarkdownToolbar editor={editor} actions={actions} />}
      <div className="ak-word-canvas">
        <div className="ak-word-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

export { markdownCss };
