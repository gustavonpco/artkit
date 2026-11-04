# @artkit/kind-document

Rich document artifact kind for artkit: proposals, specs, reports and notes made of
blocks with stable ids. Markdown is a representation of this kind, not a separate one: models can create
and extend documents with GFM Markdown, and documents export back to `.md`.

```bash
pnpm add @artkit/kind-document @artkit/core zod
# for /react and /edit
pnpm add react react-dom
```

## Usage

```ts
import { createRegistry, applyOperations } from '@artkit/core';
import { documentKind, markdownToContent } from '@artkit/kind-document';

const registry = createRegistry({ kinds: [documentKind] });

// Create from Markdown (front matter becomes the cover).
const { content, warnings } = markdownToContent('---\ntitle: Proposal\n---\n\n# Scope\n\nThe portal…');

// Edit by block id.
const result = applyOperations(
  registry,
  { kind: 'document', content, title: 'Proposal', themeId: 'default', locale: 'en' },
  [
    { op: 'insert_markdown', after: 'h1', markdown: '## Assumptions\n\n- Test environment provided' },
    { op: 'replace_text', id: 'p1', find: 'portal', replace: 'supplier portal' },
  ],
);

// What the model reads: Markdown with one `<!-- #id -->` anchor per block.
documentKind.project(result.content, { mode: 'full', locale: 'en' });
```

`createDocumentKind({ limits })` builds an instance with different limits (defaults: 2,000 blocks,
200 rows per table).

## Subpaths

| Import                         | Contents                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@artkit/kind-document`        | Schemas, operations, projection, lint, diff, `parsePartial`, Markdown parser/serializer (`parseMarkdown`, `markdownToContent`, `contentToMarkdown`), the `markdown` input. Pure JS, no DOM. |
| `@artkit/kind-document/react`  | `<DocumentRenderer content ctx className? />` and `documentCss`. Continuous page view; `ctx.mode === 'print'` adds `@page` size, margins, running header/footer and page numbers.           |
| `@artkit/kind-document/edit`   | `<DocumentEditor {...EditorBindings} />` (TipTap) plus the pure mapping/diff helpers and `documentEditorCss`.                                                                               |
| `@artkit/kind-document/export` | `documentExporters`: `docx`, `md`, `html` (all `runtime: 'any'`). PDF comes from `@artkit/node/headless`.                                                                                   |

## Model

- `cover?`: `eyebrow`, `title`, `subtitle`, `fields` (≤ 8 `{label, value}`).
- `page?`: `size` (`A4`/`Letter`), `orientation`, `margins` (mm), `header`, `footer`, `pageNumbers`.
- `blocks[]`, each with an `id` (generated when omitted: `h1`, `p3`, `l2`, `t1`, `c1`, `q1`, `code1`, `img1`, `hr1`, `pb1`, `toc1`):
  `heading` (level 1–4), `paragraph` (`align`), `list` (`ordered`, `start`, `items[{runs, children?, childrenOrdered?}]`, 3 levels),
  `table` (`header`, `rows`, `footer`, `align[]`, `widths[]`, `caption`), `callout` (`tone`, `title`), `quote` (`attribution`),
  `code` (`language`, `text`), `image` (`asset://` ref, required `alt`, `caption`, `width` 0.1–1), `divider`, `pageBreak`,
  `toc` (`maxLevel`, `title`).
- Text is `runs`: `{text, bold, italic, underline, strike, code, link, superscript, subscript}`; `"\n"` is a line break.
- **Table cells are runs** (`[{ "text": "40" }]`, `[]` for an empty cell). On creation, strings are accepted as
  cells, list items and `text` instead of `runs`; they are normalized to runs.

## Operations

`insert_block`, `insert_markdown`, `update_block`, `remove_block`, `move_block`, `replace_text`, `set_cover`,
`set_page`, `table_set_cells`, `table_insert_row`, `table_remove_row`. Targets: `block:<id>`, `cover`, `page`.

- `update_block { id, fields, unset? }` merges `fields`; changing `type` rebuilds the block from `fields`
  only (the id is kept); `unset` removes optional fields.
- `replace_text` searches every text of the block (runs across formatting boundaries, cells, list items,
  captions); it fails when the anchor is missing or not unique. The replacement takes the formatting of
  the run where the match starts.
- Table operations use 0-based body row and column indexes; `section: 'header' | 'footer'` addresses the
  other rows. Cells accept a string or runs.

## Markdown

Supported: ATX/setext headings (5–6 become 4), paragraphs, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``,
links (https/http/mailto/`#id`), `<u>`, `<sup>`, `<sub>`, `<br>`, nested lists (deeper than 3 levels are
flattened), GFM tables with alignment, blockquotes (a final `— Name` paragraph becomes the attribution),
GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!CAUTION]`) as callouts, fenced code, `---` dividers and
`![alt](asset://id "caption")` images. Images that are not `asset://` refs are rejected (or dropped with
`externalImages: 'drop'`). Front matter keys `title`/`titulo`, `subtitle`/`subtitulo`, `eyebrow`,
`fields`/`campos`, `page` fill the cover and page setup. A trailing `<!-- #id -->` sets a block id.

What GFM cannot express is kept in comments so documents round-trip: `<!-- ak:table {...} -->` (caption,
footer row, widths), `<!-- ak:paragraph {"align":…} -->`, `<!-- ak:image {"width":…} -->`, `<!-- ak:toc -->`
and `<!-- ak:pagebreak -->` (`<!-- toc -->`, `[TOC]` and `<!-- pagebreak -->` are read too).
Task-list items keep their `[ ]`/`[x]` as text, footnotes stay as literal `[^n]` text and other raw HTML
is kept as plain text.

## Editor

The editor maps ProseMirror nodes to blocks with the id in a `blockId` attribute. Each change is diffed at
block level and emitted as `update_block` (only changed fields), `insert_block`, `remove_block` or
`move_block`; pure text edits use `{ kind: 'typing' }`. New nodes get fresh ids that never reuse an id seen
in the content; wrapping a paragraph in a list keeps its id. Content changes from outside replace only the
differing nodes, so the selection survives. Images, toc and page breaks are atom nodes that keep every
field. Undo/redo is left to the host (`@artkit/react`).

## Exporters

- **docx**: native Heading 1–4 styles, Word TOC field, numbered/bulleted lists, tables with repeated
  header row, widths and footer, cover with a page break, header/footer with page numbers (not on the
  cover page), bookmarks for internal links, PNG/JPEG/GIF images. Callouts become shaded single-cell tables
  and SVG/WebP images fall back to their alt text (both reported through `ctx.warn`).
- **md**: GFM with front matter and `ak:` comments. Options: `images: 'embed'` (data URLs), `metadata: false`.
- **html**: one static page with inline CSS, theme colors and images as data URLs.

## Limitations

- Editor: no image insertion from the toolbar (images come from assets added by the host or agent); table
  cell spans are split into plain cells; column alignment is read from the header cell; callout titles,
  table captions/widths and quote attributions are kept but not editable inline.
- Lists nest at most 3 levels; content inside list items, quotes and callouts is flattened to text.
- Diff summaries are in English (the kind contract does not receive a locale).
