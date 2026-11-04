# Slides (`slides`)

Schema version 1. Edit with `artifact_apply`.

## Summary

Slide deck (16:9 canvas of 13.333 x 7.5 inches). Each slide picks a layout and fills its named slots; free elements positioned in inches are available for compositions no layout covers. Exports to editable PowerPoint.

## When to use

A presentation for a meeting, pitch or review.

## Rules

- Layouts and their slots: title (title:text, subtitle:text): Opening slide: deck title and subtitle.; section (title:text, subtitle:text): Section divider with a large title.; title-content (title:text, body:bullets|text|table|chart|image|stats|steps|cards|quote): Title plus one body: bullets, text, table, chart, image, stats, steps, cards or quote.; two-columns (title:text, left:bullets|text|table|chart|image|stats|steps|cards|quote, right:bullets|text|table|chart|image|stats|steps|cards|quote): Title plus two side-by-side bodies.; title-image (title:text, image:image|chart|table, body:bullets|text): Title, a large image (or chart/table) on the left and short text on the right.; comparison (title:text, leftTitle:text, left:bullets|text|table|chart|image|stats|steps|cards|quote, rightTitle:text, right:bullets|text|table|chart|image|stats|steps|cards|quote): Title plus two labeled columns to compare options, before/after or pros/cons.; big-number (title:text, stat:stats, caption:text|bullets): One to four highlighted numbers (stats) with a short caption.; quote (quote:quote|text): A single quotation with attribution.; blank (no slots): No slots: only free elements positioned in inches..
- Prefer layouts with slots; use free elements (x, y, w, h in inches) only when no layout fits. Elements must stay inside the canvas: x + w ≤ 13.333 and y + h ≤ 7.5.
- One idea per slide. The title is a short assertion stating the takeaway (e.g. "Costs fell 20% after automation"), not a topic label.
- At most 6 bullets per box and 2 indentation levels; keep bullets under 12 words.
- Highlight numbers with the big-number layout or "stats" content; use "steps" for processes, "cards" for parallel items, charts for trends and comparisons.
- Put details, sources and talking points in the speaker notes, not on the slide.
- Colors are theme tokens (text, muted, accent, background, surface, info, warning, success, danger); use hex only when the user asks for a specific color.
- Slide and element ids are unique across the whole deck and stay stable; read the projection and reference items by id.
- Edit with operations (set_slot, update_element, add_slide…) instead of replace_content. A text slot accepts a plain string; other contents need "type".
- Tables: every row has one cell per column (header included), at most about 8 rows per slide. Charts: one value per category in every series; pie charts take one series.
- Images use "asset://<id>" references registered beforehand and always need alt text.

## Content fields

- `size` ("16:9"): Canvas 13.333 x 7.5 inches.
- `slides` (array of object)
  - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - `layout` (string, required): Layout name: title, section, title-content, two-columns, title-image, comparison, big-number, quote, blank, or an application layout.
  - `slots` (object): Slot name → content, per the layout.
  - `elements` (array of object): Free elements, back to front.
    - variant `type: "text"`:
      - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
      - `x` (number, required): Left, inches (canvas is 13.333 wide).
      - `y` (number, required): Top, inches (canvas is 7.5 high).
      - `w` (number ≥ 0, required): Width, inches.
      - `h` (number ≥ 0, required): Height, inches.
      - `paragraphs` (array of string (length ≤ 5000) | object (items 1–200))
      - `bullets` (array of string (length ≤ 5000) | object (items 1–200))
      - `fontSize` (number 8–96): Font size in points (8 to 96).
      - `font` ("heading" | "body" | "mono"): Theme font family.
      - `bold` (boolean)
      - `italic` (boolean)
      - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
      - `align` ("left" | "center" | "right" | "justify")
      - `valign` ("top" | "middle" | "bottom")
      - `fill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - variant `type: "shape"`:
      - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
      - `x` (number, required): Left, inches (canvas is 13.333 wide).
      - `y` (number, required): Top, inches (canvas is 7.5 high).
      - `w` (number ≥ 0, required): Width, inches.
      - `h` (number ≥ 0, required): Height, inches.
      - `shape` ("rect" | "roundRect" | "ellipse" | "line" | "arrow", required)
      - `fill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
      - `line` (object)
      - `flipH` (boolean)
      - `flipV` (boolean)
      - `text` (object): Text inside the shape.
    - variant `type: "image"`:
      - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
      - `x` (number, required): Left, inches (canvas is 13.333 wide).
      - `y` (number, required): Top, inches (canvas is 7.5 high).
      - `w` (number ≥ 0, required): Width, inches.
      - `h` (number ≥ 0, required): Height, inches.
      - `asset` (string, required): Asset reference "asset://<id>". Binary files never go inside the JSON.
      - `alt` (string (length ≤ 500), required): Alternative text describing the image.
      - `fit` ("contain" | "cover")
    - variant `type: "table"`:
      - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
      - `x` (number, required): Left, inches (canvas is 13.333 wide).
      - `y` (number, required): Top, inches (canvas is 7.5 high).
      - `w` (number ≥ 0, required): Width, inches.
      - `h` (number ≥ 0, required): Height, inches.
      - `header` (array of string (length ≤ 1000) (items 1–20)): Header cells (one per column).
      - `rows` (array of array of string (length ≤ 1000) (items 1–20) (items ≤ 100), required): Body rows; each row has one cell per column.
      - `widths` (array of number (items ≤ 20)): Relative column widths, one per column (e.g. [2,1,1]).
      - `fontSize` (number 8–96): Font size in points (8 to 96).
      - `headerFill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
      - `headerColor` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
      - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
      - `borderColor` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
      - `banded` (boolean): Alternate row shading.
    - variant `type: "chart"`:
      - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
      - `x` (number, required): Left, inches (canvas is 13.333 wide).
      - `y` (number, required): Top, inches (canvas is 7.5 high).
      - `w` (number ≥ 0, required): Width, inches.
      - `h` (number ≥ 0, required): Height, inches.
      - `chartType` ("bar" | "column" | "line" | "pie" | "stackedBar", required)
      - `categories` (array of string (length ≤ 200) (items 1–100), required)
      - `series` (array of object (items 1–12), required)
      - `showValues` (boolean)
      - `legend` ("none" | "top" | "bottom" | "right"): Legend position (default bottom).
      - `title` (string (length ≤ 200))
      - `fontSize` (number 8–96): Font size in points (8 to 96).
  - `background` (object): Slide background: a color token/hex and/or an image asset (cover).
    - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `image` (string): Asset reference "asset://<id>". Binary files never go inside the JSON.
  - `notes` (string (length ≤ 20000)): Speaker notes.
  - `hidden` (boolean)
- `footer` (object): Deck footer: text and/or slide numbers on content slides.
  - `text` (string (length ≤ 200))
  - `slideNumber` (boolean)

## Alternative inputs

Pass `input: { format, source }` to `artifact_create` instead of `content`.

- `outline`: Markdown-like outline: "# Title" starts a slide (the first one becomes the title slide), "## Title" a section slide, "- item" bullets (indent 2 spaces per level), "1. item" numbered items, plain lines paragraphs, "> text" speaker notes.

## Operations

### `add_slide`

Adds a slide with a layout and slot contents.

- `slide` (object, required)
  - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - `layout` (string, required): Layout name: title, section, title-content, two-columns, title-image, comparison, big-number, quote, blank, or an application layout.
  - `slots` (object): Slot name → content, per the layout.
  - `elements` (array of object): Free elements, back to front.
  - `background` (object): Slide background: a color token/hex and/or an image asset (cover).
  - `notes` (string (length ≤ 20000)): Speaker notes.
  - `hidden` (boolean)
- `after` (string): Insert after this slide (default: at the end).
- `position` (integer 1–9007199254740991): 1-based position in the deck.

### `remove_slide`

- `slide` (string, required): Slide id.

### `move_slide`

- `slide` (string, required): Slide id.
- `after` (string): Slide id.
- `position` (integer 1–9007199254740991): 1-based position in the deck.

### `duplicate_slide`

- `slide` (string, required): Slide id.
- `id` (string): Id of the copy (generated when omitted).
- `after` (string): Insert the copy after this slide (default: right after the source).

### `set_layout`

- `slide` (string, required): Slide id.
- `layout` (string, required): Layout name: title, section, title-content, two-columns, title-image, comparison, big-number, quote, blank, or an application layout.
- `orphans` ("elements" | "drop"): What happens to slot contents the new layout cannot hold: become free elements (default) or are dropped.

### `set_slot`

- `slide` (string, required): Slide id.
- `slot` (string, required)
- `content` (string (length ≤ 5000) | object | null, required): New content; null empties the slot.

### `set_notes`

- `slide` (string, required): Slide id.
- `notes` (string (length ≤ 20000), required): "" clears the notes.

### `set_background`

- `slide` (string, required): Slide id.
- `background` (object | null, required)
  - variant:
    - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `image` (string): Asset reference "asset://<id>". Binary files never go inside the JSON.

### `set_hidden`

- `slide` (string, required): Slide id.
- `hidden` (boolean, required)

### `add_element`

- `slide` (string, required): Slide id.
- `element` (object, required): Free element positioned in inches; id is optional and generated when omitted.
  - variant `type: "text"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `x` (number, required): Left, inches (canvas is 13.333 wide).
    - `y` (number, required): Top, inches (canvas is 7.5 high).
    - `w` (number ≥ 0, required): Width, inches.
    - `h` (number ≥ 0, required): Height, inches.
    - `paragraphs` (array of string (length ≤ 5000) | object (items 1–200))
    - `bullets` (array of string (length ≤ 5000) | object (items 1–200))
    - `fontSize` (number 8–96): Font size in points (8 to 96).
    - `font` ("heading" | "body" | "mono"): Theme font family.
    - `bold` (boolean)
    - `italic` (boolean)
    - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `align` ("left" | "center" | "right" | "justify")
    - `valign` ("top" | "middle" | "bottom")
    - `fill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
  - variant `type: "shape"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `x` (number, required): Left, inches (canvas is 13.333 wide).
    - `y` (number, required): Top, inches (canvas is 7.5 high).
    - `w` (number ≥ 0, required): Width, inches.
    - `h` (number ≥ 0, required): Height, inches.
    - `shape` ("rect" | "roundRect" | "ellipse" | "line" | "arrow", required)
    - `fill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `line` (object)
    - `flipH` (boolean)
    - `flipV` (boolean)
    - `text` (object): Text inside the shape.
  - variant `type: "image"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `x` (number, required): Left, inches (canvas is 13.333 wide).
    - `y` (number, required): Top, inches (canvas is 7.5 high).
    - `w` (number ≥ 0, required): Width, inches.
    - `h` (number ≥ 0, required): Height, inches.
    - `asset` (string, required): Asset reference "asset://<id>". Binary files never go inside the JSON.
    - `alt` (string (length ≤ 500), required): Alternative text describing the image.
    - `fit` ("contain" | "cover")
  - variant `type: "table"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `x` (number, required): Left, inches (canvas is 13.333 wide).
    - `y` (number, required): Top, inches (canvas is 7.5 high).
    - `w` (number ≥ 0, required): Width, inches.
    - `h` (number ≥ 0, required): Height, inches.
    - `header` (array of string (length ≤ 1000) (items 1–20)): Header cells (one per column).
    - `rows` (array of array of string (length ≤ 1000) (items 1–20) (items ≤ 100), required): Body rows; each row has one cell per column.
    - `widths` (array of number (items ≤ 20)): Relative column widths, one per column (e.g. [2,1,1]).
    - `fontSize` (number 8–96): Font size in points (8 to 96).
    - `headerFill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `headerColor` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `borderColor` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string): Theme token (text, muted, accent, background, surface, info, warning, success, danger) or hex color "#RRGGBB". Prefer tokens.
    - `banded` (boolean): Alternate row shading.
  - variant `type: "chart"`:
    - `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
    - `x` (number, required): Left, inches (canvas is 13.333 wide).
    - `y` (number, required): Top, inches (canvas is 7.5 high).
    - `w` (number ≥ 0, required): Width, inches.
    - `h` (number ≥ 0, required): Height, inches.
    - `chartType` ("bar" | "column" | "line" | "pie" | "stackedBar", required)
    - `categories` (array of string (length ≤ 200) (items 1–100), required)
    - `series` (array of object (items 1–12), required)
    - `showValues` (boolean)
    - `legend` ("none" | "top" | "bottom" | "right"): Legend position (default bottom).
    - `title` (string (length ≤ 200))
    - `fontSize` (number 8–96): Font size in points (8 to 96).
- `position` ("front" | "back"): Stacking position (default front).

### `update_element`

- `element` (string, required): Element id (unique in the whole deck).
- `set` (object, required): Fields to change. "id" and "type" cannot change; null removes an optional field.
  - `x` (number)
  - `y` (number)
  - `w` (number ≥ 0)
  - `h` (number ≥ 0)
  - `paragraphs` (array of string (length ≤ 5000) | object (items 1–200) | null)
  - `bullets` (array of string (length ≤ 5000) | object (items 1–200) | null)
  - `fontSize` (number 8–96 | null)
  - `font` ("heading" | "body" | "mono" | null)
  - `bold` (boolean | null)
  - `italic` (boolean | null)
  - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `align` ("left" | "center" | "right" | "justify" | null)
  - `valign` ("top" | "middle" | "bottom" | null)
  - `fill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `shape` ("rect" | "roundRect" | "ellipse" | "line" | "arrow")
  - `line` (object | null)
  - `flipH` (boolean | null)
  - `flipV` (boolean | null)
  - `text` (object | null)
  - `asset` (string): Asset reference "asset://<id>". Binary files never go inside the JSON.
  - `alt` (string (length ≤ 500))
  - `fit` ("contain" | "cover" | null)
  - `header` (array of string (length ≤ 1000) (items 1–20) | null)
  - `rows` (array of array of string (length ≤ 1000) (items 1–20) (items ≤ 100)): Body rows; each row has one cell per column.
  - `widths` (array of number (items ≤ 20) | null)
  - `headerFill` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `headerColor` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `borderColor` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `banded` (boolean | null)
  - `chartType` ("bar" | "column" | "line" | "pie" | "stackedBar")
  - `categories` (array of string (length ≤ 200) (items 1–100))
  - `series` (array of object (items 1–12))
  - `showValues` (boolean | null)
  - `legend` ("none" | "top" | "bottom" | "right" | null)
  - `title` (string (length ≤ 200) | null)

### `remove_element`

- `element` (string, required): Element id (unique in the whole deck).

### `reorder_element`

- `element` (string, required): Element id (unique in the whole deck).
- `to` ("front" | "back" | "forward" | "backward", required)

### `set_footer`

- `footer` (object | null, required)
  - variant:
    - `text` (string (length ≤ 200))
    - `slideNumber` (boolean)

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
| `slides` | 100 |
| `elementsPerSlide` | 60 |
| operations per call | 200 |
| serialized artifact | 5120 KB |

## Examples

### Create a deck with layouts

Content:

```json
{
  "slides": [
    {
      "id": "intro",
      "layout": "title",
      "slots": {
        "title": "Supplier portal: one place for every vendor",
        "subtitle": "Proposal · November 2026"
      }
    },
    {
      "id": "problem",
      "layout": "title-content",
      "slots": {
        "title": "Manual onboarding takes 12 days per supplier",
        "body": {
          "type": "bullets",
          "items": [
            "Three disconnected systems",
            "Data typed twice by hand",
            {
              "text": "Reports arrive a week late",
              "level": 1
            }
          ]
        }
      },
      "notes": "Mention the audit findings from March."
    },
    {
      "id": "impact",
      "layout": "big-number",
      "slots": {
        "title": "The pilot cut onboarding time by 40%",
        "stat": {
          "type": "stats",
          "items": [
            {
              "value": "40%",
              "label": "faster onboarding"
            },
            {
              "value": "3x",
              "label": "fewer data errors"
            }
          ]
        },
        "caption": "Pilot with 25 suppliers, Q3 2026"
      }
    },
    {
      "id": "plan",
      "layout": "title-content",
      "slots": {
        "title": "Delivery in three phases",
        "body": {
          "type": "steps",
          "items": [
            {
              "title": "Discovery",
              "description": "Interviews and process map"
            },
            {
              "title": "Build",
              "description": "Portal and integrations"
            },
            {
              "title": "Rollout",
              "description": "Training and support"
            }
          ]
        }
      }
    },
    {
      "id": "growth",
      "layout": "title-content",
      "slots": {
        "title": "Registered suppliers double every quarter",
        "body": {
          "type": "chart",
          "chartType": "column",
          "categories": [
            "Q1",
            "Q2",
            "Q3"
          ],
          "series": [
            {
              "name": "Suppliers",
              "values": [
                120,
                250,
                510
              ]
            }
          ],
          "showValues": true
        }
      }
    }
  ],
  "footer": {
    "text": "Acme · Confidential",
    "slideNumber": true
  }
}
```

### Edit slots, add a slide and notes

Content:

```json
{
  "slides": [
    {
      "id": "cover",
      "layout": "title",
      "slots": {
        "title": "Quarterly review"
      }
    },
    {
      "id": "results",
      "layout": "title-content",
      "slots": {
        "title": "Revenue grew 18%",
        "body": {
          "type": "bullets",
          "items": [
            "New region",
            "Upsell"
          ]
        }
      }
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "set_slot",
    "slide": "cover",
    "slot": "subtitle",
    "content": "Board meeting · Q3 2026"
  },
  {
    "op": "add_slide",
    "after": "results",
    "slide": {
      "id": "next",
      "layout": "two-columns",
      "slots": {
        "title": "Two bets for next quarter",
        "left": {
          "type": "bullets",
          "items": [
            "Self-service onboarding",
            "Partner channel"
          ]
        },
        "right": {
          "type": "stats",
          "items": [
            {
              "value": "+12%",
              "label": "expected revenue"
            }
          ]
        }
      }
    }
  },
  {
    "op": "set_notes",
    "slide": "results",
    "notes": "Growth came mostly from the new region."
  },
  {
    "op": "move_slide",
    "slide": "next",
    "position": 2
  }
]
```

### Free elements on a blank slide

Content:

```json
{
  "slides": [
    {
      "id": "cover",
      "layout": "title",
      "slots": {
        "title": "Quarterly review"
      }
    },
    {
      "id": "results",
      "layout": "title-content",
      "slots": {
        "title": "Revenue grew 18%",
        "body": {
          "type": "bullets",
          "items": [
            "New region",
            "Upsell"
          ]
        }
      }
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "add_slide",
    "slide": {
      "id": "custom",
      "layout": "blank",
      "elements": [
        {
          "id": "headline",
          "type": "text",
          "x": 0.6,
          "y": 0.4,
          "w": 12.1,
          "h": 1,
          "paragraphs": [
            "Three markets, one platform"
          ],
          "fontSize": 32,
          "bold": true
        },
        {
          "id": "panel",
          "type": "shape",
          "shape": "roundRect",
          "x": 0.6,
          "y": 1.8,
          "w": 5.8,
          "h": 4.6,
          "fill": "surface"
        },
        {
          "id": "panel-text",
          "type": "text",
          "x": 0.9,
          "y": 2.1,
          "w": 5.2,
          "h": 4,
          "bullets": [
            "Brazil",
            "Mexico",
            "Chile"
          ]
        }
      ]
    }
  },
  {
    "op": "update_element",
    "element": "panel",
    "set": {
      "fill": "info"
    }
  },
  {
    "op": "update_element",
    "element": "panel-text",
    "set": {
      "color": "background"
    }
  },
  {
    "op": "add_element",
    "slide": "custom",
    "element": {
      "type": "text",
      "x": 6.9,
      "y": 1.8,
      "w": 5.8,
      "h": 1,
      "paragraphs": [
        "Rollout starts in March"
      ],
      "color": "muted"
    }
  }
]
```

## Checklist

- [ ] Prefer layouts and slots before free positioning.
- [ ] One idea per slide; the title states the takeaway as a sentence.
- [ ] Keep bullets short and few per slide; move detail to speaker notes.
- [ ] Highlight key numbers with a `big-number` element.
- [ ] Use theme color tokens so contrast stays readable.

## Anti-patterns

- Walls of text copied from a document.
- Overlapping elements placed by absolute position without intent.
- Slides without a title.
