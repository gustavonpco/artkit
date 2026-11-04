# Document (`document`)

Schema version 1. Edit with `artifact_apply`.

## Summary

Rich document (proposals, specs, reports, minutes) made of blocks with stable ids: heading, paragraph, list, table, callout, quote, code, image, divider, pageBreak and toc, plus an optional cover and page setup. Read it as Markdown where every block ends its first line with <!-- #id -->. Edit it with operations that reference those ids; insert_markdown is the easiest way to add several blocks.

## When to use

Text people read, review or sign: proposals, reports, specs, contracts, meeting notes.

## Rules

- Reference blocks only by ids from the projection (<!-- #id -->); never by position.
- Text lives in runs: [{"text":"plain "},{"text":"bold","bold":true}]. Marks: bold, italic, underline, strike, code, link, superscript, subscript. "\n" is a line break.
- Table cells are runs ([{"text":"40"}]); every row and the footer have exactly as many cells as the header; align and widths have one entry per column.
- Heading levels go from 1 to 4 and should not skip levels; lists nest at most 3 levels.
- Images must use registered assets ("asset://<id>") and always need a meaningful alt text.
- Links accept https, http, mailto or an internal anchor "#<block id>".
- replace_text needs an exact anchor that occurs once in the block; include more words when it is ambiguous.
- update_block merges the given fields into the block; changing "type" rebuilds it from the given fields only. Use "unset" to remove optional fields.
- table_set_cells, table_insert_row and table_remove_row use 0-based body row and column indexes.
- Prefer insert_markdown for new sections; use replace_content only when rewriting everything.

## Content fields

- `cover` (object)
  - `eyebrow` (string (length ≤ 120)): Small line above the title, e.g. "Technical proposal".
  - `title` (string (length 1–200), required)
  - `subtitle` (string (length ≤ 300))
  - `fields` (array of object (items ≤ 8)): Up to 8 label/value pairs (client, date, version…).
    - `label` (string (length 1–80), required)
    - `value` (string (length ≤ 300), required)
- `page` (object)
  - `size` ("A4" | "Letter")
  - `orientation` ("portrait" | "landscape")
  - `margins` (object): Margins in millimeters (default 25 top/bottom, 20 left/right).
    - `top` (number 0–100)
    - `right` (number 0–100)
    - `bottom` (number 0–100)
    - `left` (number 0–100)
  - `header` (string (length ≤ 200)): Text repeated at the top of every page.
  - `footer` (string (length ≤ 200)): Text repeated at the bottom of every page.
  - `pageNumbers` (boolean)
- `blocks` (array of object, required)
  - variant `type: "heading"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `level` (integer 1–4, required)
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
  - variant `type: "paragraph"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
    - `align` ("left" | "center" | "right" | "justify")
  - variant `type: "list"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `ordered` (boolean)
    - `start` (integer 0–1000000): First number of an ordered list (default 1).
    - `items` (array of object (items 1–1000), required)
      - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
      - `children` (array of object (items ≤ 500)): Nested items (up to 3 levels in total).
      - `childrenOrdered` (boolean): Numbering of the nested items; defaults to the parent list.
  - variant `type: "table"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `header` (array of array of object (items ≤ 2000) (items 1–50), required): Header cells; defines the column count.
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
    - `rows` (array of array of array of object (items ≤ 2000) (items ≤ 50) (items ≤ 10000), required): Body rows; each with exactly as many cells as the header.
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
    - `align` (array of "left" | "center" | "right" (items ≤ 50)): Per-column alignment (same length as header).
    - `widths` (array of number ≤ 1000 (items ≤ 50)): Relative column widths (proportions, same length as header), e.g. [3,1,1].
    - `footer` (array of array of object (items ≤ 2000) (items ≤ 50)): Footer/total row (same length as header).
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
    - `caption` (string (length ≤ 500))
  - variant `type: "callout"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `tone` ("info" | "warning" | "success" | "danger", required)
    - `title` (string (length ≤ 300))
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
  - variant `type: "quote"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
      - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
      - `bold` (boolean)
      - `italic` (boolean)
      - `underline` (boolean)
      - `strike` (boolean)
      - `code` (boolean): Inline code (monospace).
      - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
      - `superscript` (boolean)
      - `subscript` (boolean)
    - `attribution` (string (length ≤ 300))
  - variant `type: "code"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `language` (string (length ≤ 40))
    - `text` (string (length ≤ 100000), required)
  - variant `type: "image"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `asset` (string, required): Asset reference "asset://<id>". Binary files never go inside the JSON.
    - `alt` (string (length 1–500), required): Required alternative text describing the image.
    - `caption` (string (length ≤ 500))
    - `width` (number 0.1–1): Width as a fraction of the text width (0.1 to 1).
  - variant `type: "divider"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - variant `type: "pageBreak"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - variant `type: "toc"`:
    - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `maxLevel` (integer 1–4): Deepest heading level listed (1 to 4, default 3).
    - `title` (string (length ≤ 200))

## Alternative inputs

Pass `input: { format, source }` to `artifact_create` instead of `content`.

- `markdown`: GFM Markdown: headings (#–####), paragraphs, **bold**, *italic*, ~~strike~~, `code`, [links](https://…), nested lists (3 levels), tables with alignment, > quotes, > [!NOTE] callouts, fenced code, --- dividers and ![alt](asset://id "caption") images. Front matter (title, subtitle, eyebrow, fields) becomes the cover. Pass a string, or { markdown, cover?, page? }.

## Operations

### `insert_block`

Inserts one block after a block id (or at the start). The id is generated when omitted.

- `after` (string): Id of the block to insert after. Omit to insert at the start.
- `block` (object, required)
  - variant `type: "heading"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `level` (integer 1–4, required)
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
  - variant `type: "paragraph"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
    - `align` ("left" | "center" | "right" | "justify")
  - variant `type: "list"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `ordered` (boolean)
    - `start` (integer 0–1000000): First number of an ordered list (default 1).
    - `items` (array of object (items 1–1000), required)
  - variant `type: "table"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `header` (array of array of object (items ≤ 2000) (items 1–50), required): Header cells; defines the column count.
    - `rows` (array of array of array of object (items ≤ 2000) (items ≤ 50) (items ≤ 10000), required): Body rows; each with exactly as many cells as the header.
    - `align` (array of "left" | "center" | "right" (items ≤ 50)): Per-column alignment (same length as header).
    - `widths` (array of number ≤ 1000 (items ≤ 50)): Relative column widths (proportions, same length as header), e.g. [3,1,1].
    - `footer` (array of array of object (items ≤ 2000) (items ≤ 50)): Footer/total row (same length as header).
    - `caption` (string (length ≤ 500))
  - variant `type: "callout"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `tone` ("info" | "warning" | "success" | "danger", required)
    - `title` (string (length ≤ 300))
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
  - variant `type: "quote"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `runs` (array of object (items ≤ 2000), required): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
    - `attribution` (string (length ≤ 300))
  - variant `type: "code"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `language` (string (length ≤ 40))
    - `text` (string (length ≤ 100000), required)
  - variant `type: "image"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `asset` (string, required): Asset reference "asset://<id>". Binary files never go inside the JSON.
    - `alt` (string (length 1–500), required): Required alternative text describing the image.
    - `caption` (string (length ≤ 500))
    - `width` (number 0.1–1): Width as a fraction of the text width (0.1 to 1).
  - variant `type: "divider"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - variant `type: "pageBreak"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - variant `type: "toc"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `maxLevel` (integer 1–4): Deepest heading level listed (1 to 4, default 3).
    - `title` (string (length ≤ 200))

### `insert_markdown`

Converts Markdown into blocks and inserts them after a block id (or at the start).

- `after` (string): Id of the block to insert after. Omit to insert at the start.
- `markdown` (string (length 1–200000), required): GFM Markdown converted into blocks.

### `update_block`

Replaces fields of a block, keeping its id.

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `fields` (object, required)
  - `type` ("heading" | "paragraph" | "list" | "table" | "callout" | "quote" | "code" | "image" | "divider" | "pageBreak" | "toc"): Changing the type rebuilds the block from the given fields only (the id is kept).
  - `level` (integer 1–4)
  - `runs` (array of object (items ≤ 2000)): Formatted text runs, e.g. [{"text":"Hello "},{"text":"world","bold":true}].
  - `align` ("left" | "center" | "right" | "justify" | array of "left" | "center" | "right" (items ≤ 50)): Paragraph alignment or per-column table alignment.
  - `ordered` (boolean)
  - `start` (integer 0–1000000)
  - `items` (array of object (items 1–1000))
  - `header` (array of array of object (items ≤ 2000) (items 1–50))
  - `rows` (array of array of array of object (items ≤ 2000) (items ≤ 50) (items ≤ 10000))
  - `widths` (array of number ≤ 1000 (items ≤ 50))
  - `footer` (array of array of object (items ≤ 2000) (items ≤ 50))
  - `caption` (string (length ≤ 500))
  - `tone` ("info" | "warning" | "success" | "danger")
  - `title` (string (length ≤ 300))
  - `attribution` (string (length ≤ 300))
  - `language` (string (length ≤ 40))
  - `text` (string (length ≤ 100000))
  - `asset` (string (length ≤ 200))
  - `alt` (string (length ≤ 500))
  - `width` (number 0.1–1)
  - `maxLevel` (integer 1–4)
- `unset` (array of "align" | "ordered" | "start" | "widths" | "footer" | "caption" | "title" | "attribution" | "language" | "width" | "maxLevel" (items ≤ 11)): Optional fields to remove.

### `remove_block`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").

### `move_block`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `after` (string): Id of the block to insert after. Omit to insert at the start.

### `replace_text`

Replaces an exact, unique text anchor inside one block, keeping the formatting of the runs.

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `find` (string (length 1–5000), required): Exact text to find; must occur exactly once in the block.
- `replace` (string (length ≤ 20000), required)

### `set_cover`

- `cover` (object): Omit to remove the cover.
  - `eyebrow` (string (length ≤ 120)): Small line above the title, e.g. "Technical proposal".
  - `title` (string (length 1–200), required)
  - `subtitle` (string (length ≤ 300))
  - `fields` (array of object (items ≤ 8)): Up to 8 label/value pairs (client, date, version…).

### `set_page`

- `page` (object): Omit to reset to defaults.
  - `size` ("A4" | "Letter")
  - `orientation` ("portrait" | "landscape")
  - `margins` (object): Margins in millimeters (default 25 top/bottom, 20 left/right).
  - `header` (string (length ≤ 200)): Text repeated at the top of every page.
  - `footer` (string (length ≤ 200)): Text repeated at the bottom of every page.
  - `pageNumbers` (boolean)

### `table_set_cells`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `cells` (array of object (items 1–2000), required)
  - `section` ("header" | "body" | "footer"): Default "body".
  - `row` (integer 0–9007199254740991): 0-based body row index (required for "body").
  - `col` (integer 0–9007199254740991, required): 0-based column index.
  - `value` (string (length ≤ 20000) | array of object (items ≤ 2000), required): Cell as plain text ("40") or runs ([{"text":"40","bold":true}]).

### `table_insert_row`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `index` (integer 0–9007199254740991): 0-based position among body rows. Omit to append.
- `cells` (array of string (length ≤ 20000) | array of object (items ≤ 2000) (items ≤ 50), required)
  - variant:
    - `text` (string (length ≤ 20000), required): Text. "\n" is a line break inside the block.
    - `bold` (boolean)
    - `italic` (boolean)
    - `underline` (boolean)
    - `strike` (boolean)
    - `code` (boolean): Inline code (monospace).
    - `link` (string (length ≤ 2048)): Link target: https/http URL, mailto: address or internal anchor "#id".
    - `superscript` (boolean)
    - `subscript` (boolean)

### `table_remove_row`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `index` (integer 0–9007199254740991, required): 0-based body row index.

### Envelope operations (every kind)

#### `set_title`

- `title` (string (length 1–200), required): Artifact title, 1 to 200 characters.

#### `set_theme`

- `themeId` (string (length 1–64), required)

#### `set_locale`

- `locale` (string, required): BCP-47 locale tag; drives number, date and currency formatting.

#### `replace_content`

- `content` (any, required): Whole new content. Allowed but discouraged for large artifacts.

## Limits

| Counter | Maximum |
|---|---|
| `blocks` | 2000 |
| `tableRows` | 200 |
| operations per call | 200 |
| serialized artifact | 5120 KB |

## Examples

### Add a paragraph, fix a word and add a table row

Content:

```json
{
  "cover": {
    "eyebrow": "Technical proposal",
    "title": "Supplier Portal",
    "fields": [
      {
        "label": "Client",
        "value": "Acme"
      }
    ]
  },
  "blocks": [
    {
      "id": "scope",
      "type": "heading",
      "level": 1,
      "runs": [
        {
          "text": "Scope"
        }
      ]
    },
    {
      "id": "scope-p1",
      "type": "paragraph",
      "runs": [
        {
          "text": "The portal centralizes "
        },
        {
          "text": "supplier onboarding",
          "bold": true
        },
        {
          "text": "."
        }
      ]
    },
    {
      "id": "cost",
      "type": "table",
      "header": [
        [
          {
            "text": "Module"
          }
        ],
        [
          {
            "text": "Hours"
          }
        ]
      ],
      "rows": [
        [
          [
            {
              "text": "Login"
            }
          ],
          [
            {
              "text": "40"
            }
          ]
        ]
      ],
      "align": [
        "left",
        "right"
      ],
      "footer": [
        [
          {
            "text": "Total"
          }
        ],
        [
          {
            "text": "40"
          }
        ]
      ]
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "insert_block",
    "after": "scope-p1",
    "block": {
      "type": "paragraph",
      "runs": [
        {
          "text": "Integration with the ERP is out of scope."
        }
      ]
    }
  },
  {
    "op": "replace_text",
    "id": "scope-p1",
    "find": "centralizes",
    "replace": "unifies"
  },
  {
    "op": "table_insert_row",
    "id": "cost",
    "cells": [
      "Reports",
      "80"
    ]
  },
  {
    "op": "table_set_cells",
    "id": "cost",
    "cells": [
      {
        "section": "footer",
        "col": 1,
        "value": "120"
      }
    ]
  }
]
```

### Insert a section from Markdown

Content:

```json
{
  "cover": {
    "eyebrow": "Technical proposal",
    "title": "Supplier Portal",
    "fields": [
      {
        "label": "Client",
        "value": "Acme"
      }
    ]
  },
  "blocks": [
    {
      "id": "scope",
      "type": "heading",
      "level": 1,
      "runs": [
        {
          "text": "Scope"
        }
      ]
    },
    {
      "id": "scope-p1",
      "type": "paragraph",
      "runs": [
        {
          "text": "The portal centralizes "
        },
        {
          "text": "supplier onboarding",
          "bold": true
        },
        {
          "text": "."
        }
      ]
    },
    {
      "id": "cost",
      "type": "table",
      "header": [
        [
          {
            "text": "Module"
          }
        ],
        [
          {
            "text": "Hours"
          }
        ]
      ],
      "rows": [
        [
          [
            {
              "text": "Login"
            }
          ],
          [
            {
              "text": "40"
            }
          ]
        ]
      ],
      "align": [
        "left",
        "right"
      ],
      "footer": [
        [
          {
            "text": "Total"
          }
        ],
        [
          {
            "text": "40"
          }
        ]
      ]
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "insert_markdown",
    "after": "cost",
    "markdown": "## Assumptions\n\n- The client provides a test environment.\n- Access is granted in week 1.\n\n> [!WARNING]\n> Prices are valid for 30 days."
  }
]
```

### Change a block and the cover

Content:

```json
{
  "cover": {
    "eyebrow": "Technical proposal",
    "title": "Supplier Portal",
    "fields": [
      {
        "label": "Client",
        "value": "Acme"
      }
    ]
  },
  "blocks": [
    {
      "id": "scope",
      "type": "heading",
      "level": 1,
      "runs": [
        {
          "text": "Scope"
        }
      ]
    },
    {
      "id": "scope-p1",
      "type": "paragraph",
      "runs": [
        {
          "text": "The portal centralizes "
        },
        {
          "text": "supplier onboarding",
          "bold": true
        },
        {
          "text": "."
        }
      ]
    },
    {
      "id": "cost",
      "type": "table",
      "header": [
        [
          {
            "text": "Module"
          }
        ],
        [
          {
            "text": "Hours"
          }
        ]
      ],
      "rows": [
        [
          [
            {
              "text": "Login"
            }
          ],
          [
            {
              "text": "40"
            }
          ]
        ]
      ],
      "align": [
        "left",
        "right"
      ],
      "footer": [
        [
          {
            "text": "Total"
          }
        ],
        [
          {
            "text": "40"
          }
        ]
      ]
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "update_block",
    "id": "scope",
    "fields": {
      "level": 2
    }
  },
  {
    "op": "update_block",
    "id": "scope-p1",
    "fields": {
      "type": "callout",
      "tone": "info",
      "runs": [
        {
          "text": "Scope agreed on the kickoff."
        }
      ]
    }
  },
  {
    "op": "set_cover",
    "cover": {
      "title": "Supplier Portal",
      "subtitle": "Version 2"
    }
  },
  {
    "op": "move_block",
    "id": "cost",
    "after": "scope"
  }
]
```

## Checklist

- [ ] Heading hierarchy has no skipped levels (h1 → h2 → h3).
- [ ] Tables have a header row; totals get their own final row.
- [ ] Assumptions and risks go in callouts, not buried in paragraphs.
- [ ] Create from Markdown (`input.format: "markdown"`); edit existing blocks by id with operations.
- [ ] Every image has alternative text.

## Anti-patterns

- Recreating the whole document with `replace_content` to change one paragraph.
- Pasting raw HTML into text fields.
- Empty paragraphs used as spacing.
