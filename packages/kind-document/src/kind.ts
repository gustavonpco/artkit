import {
  ArtifactError,
  type ArtifactKind,
  type ContentInput,
  defineKind,
  IdAllocator,
} from '@artkit-ai/core';
import { z } from 'zod';
import { diffDocument } from './diff.js';
import { blockIssues, DOCUMENT_LIMITS, measureDocument, validateDocument } from './integrity.js';
import { lintDocument } from './lint.js';
import { type MarkdownParseOptions, parseMarkdown } from './markdown/parse.js';
import { canonicalBlock, idPrefix, normalizeContent } from './normalize.js';
import {
  applyDocumentOperation,
  type DocumentOperation,
  documentOperationSchema,
  documentOperationTargets,
} from './operations.js';
import { projectDocument } from './projection.js';
import {
  type Block,
  blockSchema,
  type Cover,
  coverSchema,
  type DocumentContent,
  documentContentSchema,
  type PageSetup,
  pageSchema,
} from './schema.js';

export const markdownInputSchema = z.union([
  z
    .string()
    .max(1_000_000)
    .describe('GFM Markdown, optionally with front matter (title, subtitle, eyebrow, fields).'),
  z
    .object({
      markdown: z.string().max(1_000_000),
      cover: coverSchema.optional(),
      page: pageSchema.optional(),
    })
    .strict(),
]);

export type MarkdownInput = z.infer<typeof markdownInputSchema>;

export interface MarkdownToContentResult {
  content: DocumentContent;
  warnings: string[];
}

/**
 * Converts Markdown (GFM subset) into document content with generated ids. An explicit `cover`/`page`
 * wins over front matter. Throws `ArtifactError('INVALID_CONTENT')` when something cannot be converted
 * (by default, images that are not `asset://` references).
 */
export function markdownToContent(
  input: MarkdownInput,
  options: MarkdownParseOptions & { locale?: string } = {},
): MarkdownToContentResult {
  const source = typeof input === 'string' ? { markdown: input } : input;
  const parsed = parseMarkdown(source.markdown, options);
  if (parsed.errors.length > 0) {
    throw new ArtifactError(
      'INVALID_CONTENT',
      options.locale?.toLowerCase().startsWith('pt')
        ? 'O Markdown não pôde ser convertido.'
        : 'The Markdown could not be converted.',
      {
        issues: parsed.errors.map((error) => ({
          path: 'input.source',
          message: error.message,
          ...(error.hint ? { hint: error.hint } : {}),
        })),
      },
    );
  }
  const allocator = new IdAllocator([]);
  const blocks: Block[] = parsed.blocks.map((input) => {
    let id = input.id;
    if (id === undefined || allocator.has(id)) id = allocator.next(idPrefix(input.type));
    else allocator.reserve(id);
    return canonicalBlock({ ...input, id } as Block);
  });
  const content: DocumentContent = { blocks };
  const cover: Cover | undefined = 'cover' in source ? (source.cover ?? parsed.cover) : parsed.cover;
  const page: PageSetup | undefined = 'page' in source ? (source.page ?? parsed.page) : parsed.page;
  if (cover) content.cover = cover;
  if (page) content.page = page;
  return { content, warnings: parsed.warnings };
}

const markdownInput: ContentInput<DocumentContent> = {
  description:
    'GFM Markdown: headings (#–####), paragraphs, **bold**, *italic*, ~~strike~~, `code`, [links](https://…), nested lists (3 levels), tables with alignment, > quotes, > [!NOTE] callouts, fenced code, --- dividers and ![alt](asset://id "caption") images. Front matter (title, subtitle, eyebrow, fields) becomes the cover. Pass a string, or { markdown, cover?, page? }.',
  schema: markdownInputSchema,
  toContent: (input, ctx) => markdownToContent(input as MarkdownInput, { locale: ctx.locale }).content,
};

/** Keeps the valid prefix of a streamed document, dropping the incomplete trailing block. */
export function parsePartialDocument(raw: unknown): DocumentContent | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const content: DocumentContent = { blocks: [] };
  const cover = coverSchema.safeParse(value.cover);
  if (cover.success) content.cover = cover.data;
  const page = pageSchema.safeParse(value.page);
  if (page.success) content.page = page.data;
  if (!Array.isArray(value.blocks)) return value.blocks === undefined ? content : undefined;
  const raws = structuredClone(value.blocks) as unknown[];
  const allocator = new IdAllocator(
    raws.flatMap((block) =>
      block && typeof block === 'object' && typeof (block as { id?: unknown }).id === 'string'
        ? [(block as { id: string }).id]
        : [],
    ),
  );
  const normalized = normalizeContent(
    { blocks: raws },
    {
      nextId: (p) => allocator.next(p),
      hasId: (id) => allocator.has(id),
      reserveId: (id) => allocator.reserve(id),
    },
  ) as {
    blocks: unknown[];
  };
  normalized.blocks.forEach((block, index) => {
    if (content.blocks.length !== index) return;
    const isLast = index === normalized.blocks.length - 1;
    const parsed = blockSchema.safeParse(isLast ? trimStreamingTail(block) : block);
    if (parsed.success && blockIssues(parsed.data as Block).length === 0)
      content.blocks.push(parsed.data as Block);
  });
  return content;
}

/** The last streamed block may end with a half-written table row or list item: drop just that part. */
function trimStreamingTail(block: unknown): unknown {
  if (!block || typeof block !== 'object') return block;
  const value = { ...(block as Record<string, unknown>) };
  if (value.type === 'table' && Array.isArray(value.rows) && Array.isArray(value.header)) {
    const width = value.header.length;
    const rows = [...value.rows];
    const last = rows[rows.length - 1];
    if (
      !Array.isArray(last) ||
      last.length !== width ||
      !blockSchema.safeParse({ ...value, rows: [last] }).success
    )
      rows.pop();
    value.rows = rows;
  }
  if (value.type === 'list' && Array.isArray(value.items) && value.items.length > 1) {
    const items = [...value.items];
    if (!blockSchema.safeParse({ ...value, items: [items[items.length - 1]] }).success) items.pop();
    value.items = items;
  }
  return value;
}

const exampleContent = {
  cover: {
    eyebrow: 'Technical proposal',
    title: 'Supplier Portal',
    fields: [{ label: 'Client', value: 'Acme' }],
  },
  blocks: [
    { id: 'scope', type: 'heading', level: 1, runs: [{ text: 'Scope' }] },
    {
      id: 'scope-p1',
      type: 'paragraph',
      runs: [{ text: 'The portal centralizes ' }, { text: 'supplier onboarding', bold: true }, { text: '.' }],
    },
    {
      id: 'cost',
      type: 'table',
      header: [[{ text: 'Module' }], [{ text: 'Hours' }]],
      rows: [[[{ text: 'Login' }], [{ text: '40' }]]],
      align: ['left', 'right'],
      footer: [[{ text: 'Total' }], [{ text: '40' }]],
    },
  ],
};

export const DOCUMENT_INSTRUCTIONS = {
  summary:
    'Rich document (proposals, specs, reports, minutes) made of blocks with stable ids: heading, paragraph, list, table, callout, quote, code, image, divider, pageBreak and toc, plus an optional cover and page setup. Read it as Markdown where every block ends its first line with <!-- #id -->. Edit it with operations that reference those ids; insert_markdown is the easiest way to add several blocks.',
  rules: [
    'Reference blocks only by ids from the projection (<!-- #id -->); never by position.',
    'Text lives in runs: [{"text":"plain "},{"text":"bold","bold":true}]. Marks: bold, italic, underline, strike, code, link, superscript, subscript. "\\n" is a line break.',
    'Table cells are runs ([{"text":"40"}]); every row and the footer have exactly as many cells as the header; align and widths have one entry per column.',
    'Heading levels go from 1 to 4 and should not skip levels; lists nest at most 3 levels.',
    'Images must use registered assets ("asset://<id>") and always need a meaningful alt text.',
    'Links accept https, http, mailto or an internal anchor "#<block id>".',
    'replace_text needs an exact anchor that occurs once in the block; include more words when it is ambiguous.',
    'update_block merges the given fields into the block; changing "type" rebuilds it from the given fields only. Use "unset" to remove optional fields.',
    'table_set_cells, table_insert_row and table_remove_row use 0-based body row and column indexes.',
    'Prefer insert_markdown for new sections; use replace_content only when rewriting everything.',
  ],
  examples: [
    {
      title: 'Add a paragraph, fix a word and add a table row',
      content: exampleContent,
      operations: [
        {
          op: 'insert_block',
          after: 'scope-p1',
          block: { type: 'paragraph', runs: [{ text: 'Integration with the ERP is out of scope.' }] },
        },
        { op: 'replace_text', id: 'scope-p1', find: 'centralizes', replace: 'unifies' },
        { op: 'table_insert_row', id: 'cost', cells: ['Reports', '80'] },
        { op: 'table_set_cells', id: 'cost', cells: [{ section: 'footer', col: 1, value: '120' }] },
      ],
    },
    {
      title: 'Insert a section from Markdown',
      content: exampleContent,
      operations: [
        {
          op: 'insert_markdown',
          after: 'cost',
          markdown:
            '## Assumptions\n\n- The client provides a test environment.\n- Access is granted in week 1.\n\n> [!WARNING]\n> Prices are valid for 30 days.',
        },
      ],
    },
    {
      title: 'Change a block and the cover',
      content: exampleContent,
      operations: [
        { op: 'update_block', id: 'scope', fields: { level: 2 } },
        {
          op: 'update_block',
          id: 'scope-p1',
          fields: { type: 'callout', tone: 'info', runs: [{ text: 'Scope agreed on the kickoff.' }] },
        },
        { op: 'set_cover', cover: { title: 'Supplier Portal', subtitle: 'Version 2' } },
        { op: 'move_block', id: 'cost', after: 'scope' },
      ],
    },
  ],
};

export interface DocumentKindOptions {
  /** Overrides of the default limits (`blocks`, `tableRows`). */
  limits?: Partial<typeof DOCUMENT_LIMITS>;
}

/** Creates the document kind; `documentKind` is the default instance. */
export function createDocumentKind(
  options: DocumentKindOptions = {},
): ArtifactKind<DocumentContent, DocumentOperation> {
  return defineKind<DocumentContent, DocumentOperation>({
    kind: 'document',
    version: 1,
    label: 'Document',
    contentSchema: documentContentSchema as unknown as z.ZodType<DocumentContent>,
    operationSchema: documentOperationSchema,
    empty: () => ({ blocks: [] }),
    normalize: normalizeContent,
    apply: applyDocumentOperation,
    ids: (content) => content.blocks.map((block) => block.id),
    validate: (content) => validateDocument(content),
    measure: measureDocument,
    targets: documentOperationTargets,
    project: projectDocument,
    lint: lintDocument,
    diff: diffDocument,
    parsePartial: parsePartialDocument,
    inputs: { markdown: markdownInput },
    migrations: [],
    limits: {
      ...DOCUMENT_LIMITS,
      ...Object.fromEntries(Object.entries(options.limits ?? {}).filter(([, v]) => v !== undefined)),
    },
    instructions: DOCUMENT_INSTRUCTIONS,
  });
}

export const documentKind: ArtifactKind<DocumentContent, DocumentOperation> = createDocumentKind();
