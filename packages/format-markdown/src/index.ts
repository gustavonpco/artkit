import {
  type AdapterContext,
  type ApplyResult,
  defineFormat,
  type FormatAdapter,
  type FormatInstructions,
  type LintIssue,
  type ReadRequest,
  type ReadResult,
  type ValidationResult,
} from '@artkit-ai/core';
import { stripRawHtml } from './dialect.js';
import { diffMarkdown } from './diff.js';
import { parseDocument, serializeDocument } from './document.js';
import { lintMarkdown } from './lint.js';
import { applyMarkdownOperation, type MarkdownOperation, markdownOperationSchema } from './operations.js';
import { readDocument } from './read.js';

export const MARKDOWN_LIMITS = { chars: 200_000, sections: 300 };
export const MARKDOWN_FORMAT_VERSION = 'gfm@1';

export const MARKDOWN_INSTRUCTIONS: FormatInstructions = {
  summary:
    'Markdown (GFM with frontmatter) for text to read, review or sign. Read the outline first, then change sections by anchor.',
  rules: [
    'Address sections by their anchor from the outline; never by line numbers.',
    'Use replace_text for a small change; it fails when the snippet is not unique inside the section.',
    'Use replace_section for a whole body; subsections are kept.',
    'Create headings with insert_section; set an explicit anchor with {#id} only when the section must keep it across renames.',
    'Do not write raw HTML; use the pagebreak directive <!-- pagebreak --> only where a page break is needed.',
    'Use alert blocks (> [!NOTE], > [!WARNING], > [!TIP]) for callouts and asset://<id> for images with alt text.',
  ],
  examples: [
    {
      title: 'Create a document skeleton',
      operations: [
        { op: 'insert_section', title: 'Escopo', level: 1, body: 'Resumo do escopo.' },
        { op: 'insert_section', after: 'escopo', title: 'Premissas', level: 2, body: '- Ambiente em nuvem.' },
      ],
    },
  ],
};

export function countOpenFences(text: string): number {
  return text.split('\n').filter((line) => /^ {0,3}(`{3,}|~{3,})/.test(line)).length;
}

/** Markdown format adapter (spec §10). */
export const markdownFormat: FormatAdapter<string, MarkdownOperation> = defineFormat({
  format: 'markdown',
  formatVersion: MARKDOWN_FORMAT_VERSION,
  readableVersions: [MARKDOWN_FORMAT_VERSION],
  label: 'Documento',
  empty: () => '',
  validate(content: unknown, _ctx: AdapterContext): ValidationResult<string> {
    if (typeof content !== 'string') {
      return {
        ok: false,
        issues: [
          {
            path: 'content',
            message: 'O documento deve ser texto Markdown.',
            hint: 'Envie o Markdown como string.',
          },
        ],
      };
    }
    const { text } = stripRawHtml(content.replace(/\r\n/g, '\n'));
    const document = parseDocument(text);
    const anchors = new Set<string>();
    for (const section of document.sections) {
      if (!section.explicit) continue;
      if (anchors.has(section.anchor)) {
        return {
          ok: false,
          issues: [
            {
              path: 'content',
              message: `A âncora "${section.anchor}" está repetida.`,
              hint: 'Cada {#id} precisa ser único.',
            },
          ],
        };
      }
      anchors.add(section.anchor);
    }
    return { ok: true, content: serializeDocument(document) };
  },
  operationSchema: markdownOperationSchema,
  async apply(
    content: string,
    operations: MarkdownOperation[],
    ctx: AdapterContext,
  ): Promise<ApplyResult<string>> {
    const document = parseDocument(content);
    const createdRefs: string[] = [];
    operations.forEach((op, index) => {
      createdRefs.push(...applyMarkdownOperation(document, op, ctx, index).createdRefs);
    });
    const next = serializeDocument(document);
    const validation = markdownFormat.validate(next, ctx);
    if (!validation.ok)
      ctx.fail(validation.issues[0]?.message ?? 'Documento inválido.', { hint: validation.issues[0]?.hint });
    return { content: validation.content, createdRefs, warnings: [] };
  },
  read(content: string, request: ReadRequest): ReadResult {
    return readDocument(parseDocument(content), request);
  },
  diff: (before, after) => diffMarkdown(before, after),
  lint(content: string, _ctx): LintIssue[] {
    return lintMarkdown(content);
  },
  parsePartial(raw: string): string | undefined {
    if (raw.trim() === '') return undefined;
    // Drop an unfinished fenced block: keep everything before its opening fence.
    if (countOpenFences(raw) % 2 === 1) {
      const lines = raw.split('\n');
      const last = lines.map((line) => /^ {0,3}(`{3,}|~{3,})/.test(line)).lastIndexOf(true);
      return lines.slice(0, last).join('\n');
    }
    return raw;
  },
  migrations: [],
  limits: MARKDOWN_LIMITS,
  measure: (content: string) => ({ chars: content.length, sections: parseDocument(content).sections.length }),
  instructions: MARKDOWN_INSTRUCTIONS,
});

export { editorRoundTrip, stripRawHtml } from './dialect.js';
export { diffMarkdown } from './diff.js';
export {
  assignAnchors,
  parseDocument,
  parseFrontMatter,
  serializeDocument,
  slugifyTitle,
  splitFrontMatter,
} from './document.js';
export { lintMarkdown } from './lint.js';
export type { MarkdownOperation } from './operations.js';
export { markdownOperationSchema } from './operations.js';
export { readDocument } from './read.js';
