# @artkit/kind-diagram

`diagram` artifact kind for [artkit](../../docs/spec.md): nodes, edges and groups for architectures, process
flows, integrations and simple org charts. Includes a small Mermaid flowchart parser, a deterministic layout
(dagre or bands), a read-only SVG renderer, a React Flow editor and a static SVG exporter.

```bash
pnpm add @artkit/kind-diagram @artkit/core
# renderer and editor
pnpm add react react-dom
```

## Subpaths

| Import                        | Contents                                                                                    | Runs in                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| `@artkit/kind-diagram`        | `diagramKind`, schemas, operations, projection, lint, diff, `parseMermaid`, `layoutDiagram` | browser, Node, edge, workers |
| `@artkit/kind-diagram/react`  | `DiagramRenderer`, `diagramCss`                                                             | React 19                     |
| `@artkit/kind-diagram/edit`   | `DiagramEditor`, `diagramEditorCss`, pure editor conversions                                | React 19 (React Flow)        |
| `@artkit/kind-diagram/export` | `diagramExporters` (`svg`), `renderDiagramSvg`                                              | anywhere (`runtime: 'any'`)  |

PNG and PDF come from headless rendering of the renderer in `@artkit/node`, not from this package.

## Usage

```ts
import { createArtifactService, createRegistry } from '@artkit/core';
import { diagramKind } from '@artkit/kind-diagram';
import { diagramExporters } from '@artkit/kind-diagram/export';

const registry = createRegistry({ kinds: [diagramKind], exporters: diagramExporters });

await service.create(scope, {
  kind: 'diagram',
  title: 'Checkout',
  input: {
    format: 'mermaid',
    source: 'flowchart LR\n  web[Web shop] -->|order| api(Orders API)\n  api --> db[(Orders DB)]',
  },
});
```

```tsx
import { DiagramRenderer, diagramCss } from '@artkit/kind-diagram/react';
import { DiagramEditor, diagramEditorCss } from '@artkit/kind-diagram/edit';

<style>{diagramCss}</style>
<DiagramRenderer content={content} ctx={{ theme, locale: 'en', mode: 'screen' }} />

<style>{diagramEditorCss}</style>
<DiagramEditor content={content} ctx={ctx} emit={emit} readOnly={false} lint={lint} />
```

## Model

- **Diagram**: `direction` (`TB` | `LR`), `layout` (`auto` | `bands` | `manual`), `nodes`, `edges`, `groups`.
- **Node**: `id`, `label` (≤ 60), `shape` (`box`, `round`, `diamond`, `ellipse`, `cylinder`, `document`, `actor`),
  `tone` (theme color token), `group`, `icon`, `position` (pinned top-left, honored only with `manual`).
- **Edge**: `id`, `from`, `to`, `label` (≤ 40), `style` (`solid` | `dashed`), `arrow` (`end` | `both` | `none`).
- **Group**: `id`, `label`, `kind` (`band` for layers/lanes, `box` for a plain enclosure). Group order is band order.
- **Icons** (closed set, Lucide line icons in `ICON_ELEMENTS`): database, server, user, cloud, queue, api, mobile, web,
  lock, file, mail, settings, search, chart, bot, shield.
- **Limits**: 300 nodes, 600 edges, 30 groups. Ids are unique across nodes, edges and groups.

Operations: `add_node`, `update_node`, `remove_node` (removes connected edges), `add_edge`, `update_edge`,
`remove_edge`, `add_group` (optional `nodes` and `after`), `update_group` (optional `after` to reorder),
`remove_group` (ungroups its nodes), `set_direction`, `set_layout`, `pin_node` (also switches to `manual`),
`unpin_node`. Optional fields are cleared with `null` (`tone`, `icon`, `group`, edge `label`).
Targets: `node:<id>`, `edge:<id>`, `group:<id>`, `diagram:direction`, `diagram:layout`.

Projection (keywords follow the locale):

```
direção: TB
layout: bands
grupo canais "Canais" [band]: web(box, icon=web) "Portal web", app(round) "App mobile"
grupo dados "Dados" [band]: pg(cylinder) "PostgreSQL"
aresta e1: web -> api "HTTPS"
```

`outline` lists counts, groups and node ids; `range` takes comma-separated group ids and returns those groups
with every edge touching them. Lint: `isolated-node`, `duplicate-edge`, `label-too-long`, `empty-group` and
`pins-ignored` (info).

## Mermaid subset

`parseMermaid(source)` returns `{ content, notes }`; the `mermaid` input of the kind uses it and throws
`INVALID_CONTENT` with the line number, message and hint.

- Header: `flowchart` or `graph` with `TB`/`TD` (→ TB), `BT` (→ TB), `LR`, `RL` (→ LR). `;` separates statements.
- Nodes: `A`, `A[box]`, `A(round)`, `A{diamond}`, `A((ellipse))`, `A[(cylinder)]`; quoted labels `A["a [b]"]`.
  Stadium `([ ])` maps to round, `(((x)))` to ellipse; subroutine, hexagon, parallelogram and asymmetric shapes are
  drawn as boxes (with a note). `A@{ shape: … }` is rejected.
- Edges: `-->`, `---`, `-.->`, `-.-`, `==>`, `===`, `<-->`; labels `A -->|text| B`, `A -- text --> B`,
  `A -. text .-> B`; chains `A --> B --> C`; fan-out `A & B --> C & D`. Thick links are drawn solid, `o`/`x` ends
  as arrows, `~~~` is ignored.
- `subgraph id [Label]` … `end` (also `subgraph "Label"` and `subgraph Label words`) become groups. **Rule**:
  subgraphs become `band` groups (and the layout `bands`) when there are at least two, none is nested and the
  edges between them form no cycle; bands are then ordered along the flow. Otherwise they are `box` groups with
  layout `auto`. Nested subgraphs are flattened (a node belongs to the innermost one). Edges to a subgraph id
  are rejected.
- `%%` comments, front matter, `classDef`, `class`, `:::class`, `style`, `linkStyle`, `click` are ignored and
  recorded in `notes`.

## Layout

`layoutDiagram(content, options?)` is pure and deterministic and is shared by the renderer, the editor and the
exporter. It returns positioned nodes (with estimated sizes), edge polylines with label boxes, group rectangles
and `bounds` (pinned coordinates are never shifted, so `bounds.x/y` may be non-zero).

- `auto`: dagre (MIT) for graphs without band groups, with `box` groups as clusters; as soon as a group is a
  `band`, the bands engine is used.
- `bands`: own layered layout. Groups become horizontal bands (TB, label on top) or vertical lanes (LR, label on
  the side); ungrouped nodes form an unlabeled band first or last depending on their edges. Nodes stay in their
  band (sub-rows follow internal edges), crossings are reduced with barycenter sweeps, positions are balanced with
  an isotonic solver, edges are routed orthogonally through free channels between rows and bands with
  separate tracks, and labels sit on the last segment.
- `manual`: pinned nodes keep their position; the others keep their automatic position and are only nudged away
  from overlaps. Edges touching moved nodes are re-routed; groups grow to keep their members.
- `LayoutEngine` adapter: pass `{ engine }` with `layout(graph) → { nodes, edges?, groups? }` (sync, or async
  via `layoutDiagramAsync`, whose result can be given to `DiagramRenderer` as `layout`). This is how an app
  plugs elkjs (EPL-2.0, not a dependency of this package).

## Renderer and editor

`DiagramRenderer` draws SVG with theme variables (`--ak-color-*`, set from `ctx.theme` on the root), arrow
markers, icons and dashed edges, and an accessible description (`role="img"`, `<title>`, `<desc>`). In
`screen` mode it zooms and pans with the wheel, drag, toolbar buttons and keyboard (`+`, `-`, `0`, arrows); in
`print` mode it is static at natural size.

`DiagramEditor` (React Flow) turns every interaction into kind operations: dragging a node emits one `pin_node`
per moved node at the end with `{ kind: 'continuous' }` (also for arrow-key moves, on key release); connecting
handles emits `add_edge`; double-click or F2 renames nodes, edges and groups inline; Delete/Backspace removes the
selection; the toolbar adds nodes, groups/ungroups the selection and changes direction and layout; the inspector
edits shape, tone, icon, group, edge style and arrows. `diagramEditorCss` includes the React Flow structure
styles it needs, so `@xyflow/react/dist/style.css` is optional.

## Limitations

- Node sizes come from a character-width estimate, not font measurement; very unusual fonts may look loose or
  tight.
- dagre routes are polylines, not orthogonal; only the bands engine routes orthogonally. Manual and custom-engine
  edges use simple elbows and can cross nodes.
- Bands are not nested, and Mermaid nested subgraphs are flattened.
- `notes` from the Mermaid parser are not surfaced through `ContentInput.toContent` (the core contract returns
  content only); call `parseMermaid` directly to read them.
