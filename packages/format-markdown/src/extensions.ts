import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

/**
 * Tiptap extensions of the Markdown dialect (spec §10.1). The same set validates the dialect on the server and runs in
 * the editor, so what the agent writes is what the editor loads. Underline is off: GFM has no underline. Undo and redo
 * belong to the draft session, not to the editor.
 */
export function dialectExtensions() {
  return [
    StarterKit.configure({
      undoRedo: false,
      underline: false,
      link: { openOnClick: false, autolink: true },
    }),
    Table,
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown,
  ];
}

/** Alert kinds of the dialect (`> [!NOTE]` and the rest). */
export const ALERT_KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;

const ESCAPED_ALERT = /\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\\]/g;

/**
 * The Markdown serializer escapes the marker of an alert (`\[!WARNING\]`). The dialect writes it plain, so the escape is
 * taken back before the text is compared or stored.
 */
export function unescapeAlerts(text: string): string {
  return text.replace(ESCAPED_ALERT, '[!$1]');
}
