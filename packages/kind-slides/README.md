# @artkit/kind-slides

Slide deck artifact kind for [artkit](../../docs/spec.md) (spec §11.3). It ships the model the agent reads and edits through
operations, a React renderer, a visual editor and an editable PowerPoint exporter. All of them share one geometry.

```bash
pnpm add @artkit/kind-slides @artkit/core zod
# renderer and editor: react@19 react-dom@19 (optional peers)
```

## Subpaths

| Import                       | Contents                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@artkit/kind-slides`        | `slidesKind`, `createSlidesKind({ layouts })`, schemas, operations, projection, lint, diff, `parsePartial`, the `outline` input, and pure helpers: `composeSlide`, text metrics, chart scales. Depends only on `@artkit/core` and `zod`. |
| `@artkit/kind-slides/react`  | `SlidesRenderer`, `SlideView`, `SlideThumbnails`, `SlideNotes`, `SlidesPresentation`, `ChartSvg`, and `slidesCss`                                                                                                                        |
| `@artkit/kind-slides/edit`   | `SlidesEditor` (`EditorBindings`), pure geometry (`snapMove`, `snapResize`, `resizeRect`, `alignRects`, `distributeRects`), rich-text helpers, and `slidesEditorCss`                                                                     |
| `@artkit/kind-slides/export` | `slidesExporters` and `createSlidesExporters({ layouts })`, a pptx exporter built on pptxgenjs (`runtime: 'any'`)                                                                                                                        |

```ts
import { createRegistry } from '@artkit/core';
import { slidesKind } from '@artkit/kind-slides';
import { slidesExporters } from '@artkit/kind-slides/export';

const registry = createRegistry({ kinds: [slidesKind], exporters: slidesExporters });
```

```tsx
import { SlidesRenderer, slidesCss } from '@artkit/kind-slides/react';
import { SlidesEditor, slidesEditorCss } from '@artkit/kind-slides/edit';

<style>{slidesEditorCss}</style>
<SlidesRenderer content={content} ctx={ctx} />            // viewer: thumbnails, notes, "Present"
<SlidesRenderer content={content} ctx={ctx} slideId="kpis" />  // a single slide
<SlidesEditor content={content} ctx={ctx} emit={emit} readOnly={false} lint={lint} uploadImage={upload} />
```

## Model

The canvas is 16:9 and measures 13.333 × 7.5 inches. A deck is `{ size: '16:9', slides, footer?: { text?, slideNumber? } }`. Each slide is
`{ id, layout, slots, elements, background?, notes?, hidden? }`. Two levels coexist:

- **Semantic (default):** a layout with named slots. A slot holds a string (text) or a typed content:
  `text`, `bullets`, `image`, `table`, `chart`, `stats` (big numbers), `steps`, `cards` or `quote`.
- **Free:** `elements` positioned in inches (`text`, `shape`, `image`, `table`, `chart`), drawn above the slots.

Colors are theme tokens or hex values. Ids are unique across the deck. An element outside the canvas fails validation.
The limits are 100 slides and 60 elements per slide.

Operations: `add_slide`, `remove_slide`, `move_slide`, `duplicate_slide`, `set_layout` (migrates equivalent slots and turns
orphans into free elements unless `orphans: 'drop'`), `set_slot`, `set_notes`, `set_background`, `set_hidden`, `add_element`,
`update_element` (`null` removes a field; `id` and `type` cannot change), `remove_element`, `reorder_element`, and `set_footer`.
Targets: `slide:<id>`, `slot:<slideId>.<slot>`, `element:<id>` and `deck`, the same vocabulary `diff` uses.

Lint codes: `text-overflow` (average glyph width of the theme font, wrapping, line height), `table-overflow`, `overlap`,
`low-contrast` (WCAG AA against the real background), `missing-title`, `empty-slot`, `too-many-bullets` and `missing-alt`.

## Layouts

The built-in layouts are `title`, `section`, `title-content`, `two-columns`, `title-image`, `comparison`, `big-number`, `quote`
and `blank`. Applications register their own layouts (spec §20). Each slot declares its name, the content kinds it accepts,
its box in inches and a typography role. Renderer, exporter, projection, instructions and lint all derive from that one
declaration:

```ts
const kind = createSlidesKind({
  layouts: [
    {
      name: 'kpis',
      label: 'KPIs',
      description: 'Up to four indicators.',
      slots: [
        {
          name: 'title',
          accepts: ['text'],
          box: { x: 0.6, y: 0.4, w: 12.133, h: 0.9 },
          role: 'title',
          required: true,
        },
        {
          name: 'body',
          accepts: ['stats'],
          box: { x: 0.6, y: 2, w: 12.133, h: 4.8 },
          role: 'body',
          columns: 4,
        },
      ],
    },
  ],
});
// Pass kind.layouts to <SlidesRenderer layouts>, <SlidesEditor layouts> and createSlidesExporters({ layouts }).
```

Repeatable contents (`stats`, `steps`, `cards`) lay out in a grid, with at most `columns` per row. `test/workia.test.ts` registers
layouts equivalent to a real consumer's (cover, KPIs, steps, cards, two columns). It converts that consumer's deck and exports it.

## Rendering and editing

- Slides keep their aspect ratio and position everything in percent. Font sizes use `cqw`, so a thumbnail is an exact
  scaled copy. Charts are inline SVG in the theme palette. With `ctx.mode === 'print'`, each visible slide gets its own
  13.333in × 7.5in page.
- The editor draws on top of the renderer, so what you edit is what you export. Move and resize use `react-moveable`; Shift
  keeps the aspect ratio, and images always keep it. Snapping uses smart guides against other elements' edges and centers
  and against the slide, plus an optional grid. Other features:
  - align, distribute and layer order
  - keyboard nudge (arrows, Shift for larger steps, Alt to resize), Tab, Enter, Delete and Ctrl+D
  - in-place rich-text editing: paragraphs, lists with levels, bold, italic, underline and token colors
  - grid editors for tables and for chart data, with a live preview
  - item editors for stats, steps and cards
  - a token-only color picker (hex with `allowHexColors`), notes, background and the deck footer
  - a thumbnail panel with drag reorder, duplicate, hide, delete and insert by layout
  - lint overflow indicators
- A drag or resize emits one `update_element` at the end with `{ kind: 'continuous' }`. Typing and nudges use `{ kind: 'typing' }`.

## Limitations

- pptx: SVG images become a placeholder (pptxgenjs needs a browser canvas to build the PNG fallback). Missing assets
  also become placeholders. Both cases call `ctx.warn`. Text overflow is not auto-fitted.
- The overflow lint is an estimate. It uses average character widths, not real glyph shaping.
- The renderer draws `stackedBar` as horizontal stacked bars, the same as PowerPoint's stacked bar.
- Only the 16:9 size exists in schema version 1.
