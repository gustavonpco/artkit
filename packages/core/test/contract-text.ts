import { z } from 'zod';
import type { ChangeSummary, FormatAdapter, LintIssue } from '../src/adapter.js';
import { ellipsis } from '../src/projection.js';

/** Minimal native format used by the core tests: the content is plain text. */
export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace_text'), find: z.string().min(1), replace: z.string() }).strict(),
  z.object({ op: z.literal('append'), text: z.string().min(1) }).strict(),
]);

export type TextOperation = z.infer<typeof operationSchema>;

export const MAX_CHARS = 1000;

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

export const contractText: FormatAdapter<string, TextOperation> = {
  format: 'contract-text',
  formatVersion: 'contract@1',
  readableVersions: ['contract@1'],
  label: 'Contract text',
  empty: () => '',
  validate(content) {
    if (typeof content !== 'string') {
      return { ok: false, issues: [{ path: 'content', message: 'Expected text.', hint: 'Send a string.' }] };
    }
    return { ok: true, content };
  },
  operationSchema,
  async apply(content, operations, ctx) {
    let text = content;
    const createdRefs: string[] = [];
    for (const op of operations) {
      if (op.op === 'append') {
        text = `${text}${op.text}`;
        createdRefs.push(`tail:${text.length}`);
        continue;
      }
      const occurrences = countOccurrences(text, op.find);
      if (occurrences !== 1) {
        ctx.fail(`The text "${op.find}" appears ${occurrences} times.`, {
          hint: 'Use a snippet that appears exactly once.',
          path: 'find',
        });
      }
      text = text.replace(op.find, op.replace);
    }
    return { content: text, createdRefs, warnings: [] };
  },
  read(content, request) {
    const text = request.mode === 'outline' ? `${content.length} chars: ${ellipsis(content, 40)}` : content;
    return { text, truncated: false };
  },
  diff(before, after): ChangeSummary[] {
    return before === after
      ? []
      : [{ type: 'changed', target: 'text', summary: `${before.length} → ${after.length} chars` }];
  },
  lint(content): LintIssue[] {
    return content.trim().length === 0
      ? [{ code: 'empty', severity: 'info', target: 'text', message: 'Empty text.' }]
      : [];
  },
  parsePartial: (raw) => raw,
  migrations: [],
  limits: { chars: MAX_CHARS },
  measure: (content) => ({ chars: content.length }),
  instructions: {
    summary: 'Plain text used by the core tests.',
    rules: ['Replace snippets only when they are unique.'],
    examples: [{ title: 'Append', content: 'Hello', operations: [{ op: 'append', text: ' world' }] }],
  },
};
