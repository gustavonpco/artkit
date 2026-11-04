# Diagram (`diagram`)

Schema version 1. Edit with `artifact_apply`.

## Summary

Diagram of nodes, edges and groups for architectures, process flows, integrations and simple org charts. Create it from Mermaid flowchart source (input format "mermaid") or JSON content; then adjust it with operations that reference ids.

## When to use

Structure and flows: architecture, processes, org charts, dependencies.

## Rules

- Pick one dominant direction: TB for layered architectures and hierarchies, LR for processes and pipelines.
- Use groups as layers (TB) or lanes (LR): kind "band" with layout "bands" (or "auto"). Use kind "box" only for loose clusters.
- Keep labels short: nodes up to 60 characters (aim for 2–4 words), edge labels up to 40 (1–3 words).
- Create with Mermaid input; edit an existing diagram with operations (add_node, update_edge, …) instead of resending it.
- Edges must reference existing node ids, node.group an existing group id; ids are unique across nodes, edges and groups.
- Shapes: cylinder for databases, actor for people, diamond for decisions, document for files, round for services, box otherwise.
- Icons (optional, closed set): database, server, user, cloud, queue, api, mobile, web, lock, file, mail, settings, search, chart, bot, shield. Tones are theme tokens (accent, info, success, warning, danger, muted).
- remove_node also removes its edges; remove_group keeps its nodes, ungrouped.
- pin_node fixes a node position and switches to layout "manual"; only pin when the user asks for a specific placement.
- Limits: 300 nodes, 600 edges, 30 groups.

## Content fields

- `direction` ("TB" | "LR"): Main flow direction: TB (top to bottom) or LR (left to right).
- `layout` ("auto" | "bands" | "manual"): auto: automatic (bands when there are band groups, otherwise dagre); bands: groups as layers/lanes; manual: pinned positions are kept.
- `nodes` (array of object)
  - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - `label` (string (length 1–60), required): Short label, at most 60 characters.
  - `shape` ("box" | "round" | "diamond" | "ellipse" | "cylinder" | "document" | "actor"): Node shape. Use cylinder for databases, actor for people, diamond for decisions.
  - `tone` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger"): Theme color token used to tint the node.
  - `group` (string): Id of the group (layer, lane or box) the node belongs to.
  - `icon` ("database" | "server" | "user" | "cloud" | "queue" | "api" | "mobile" | "web" | "lock" | "file" | "mail" | "settings" | "search" | "chart" | "bot" | "shield"): Optional icon: database, server, user, cloud, queue, api, mobile, web, lock, file, mail, settings, search, chart, bot, shield.
  - `position` (object): Pinned top-left position in diagram units. Only honored with layout "manual".
    - `x` (number -100000–100000, required)
    - `y` (number -100000–100000, required)
- `edges` (array of object)
  - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - `from` (string, required): Source node id.
  - `to` (string, required): Target node id.
  - `label` (string (length 1–40)): Optional label, at most 40 characters.
  - `style` ("solid" | "dashed")
  - `arrow` ("end" | "both" | "none")
- `groups` (array of object): Ordered: bands are stacked in this order.
  - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - `label` (string (length 1–60), required)
  - `kind` ("band" | "box"): band: a layer (TB) or lane (LR); box: a plain enclosing box.

## Alternative inputs

Pass `input: { format, source }` to `artifact_create` instead of `content`.

- `mermaid`: Mermaid flowchart subset. First line "flowchart TD" (or graph; TB/TD/BT → TB, LR/RL → LR). Nodes: A[box] A(round) A{diamond} A((ellipse)) A[(cylinder)] or a plain id; quote labels with brackets: A["a [b]"]. Edges: A --> B, A --- B (no arrow), A -.-> B (dashed), A ==> B, A <--> B, labels as A -->|text| B or A -- text --> B; chains A --> B --> C and fan-out A --> B & C. "subgraph id [Label]" … "end" makes groups: at least two non-nested subgraphs whose edges never loop back become bands (layout "bands"), otherwise boxes. %% comments, classDef/class/style/linkStyle/click lines are ignored.

## Operations

### `add_node`

- `id` (string): Optional explicit id; generated when omitted.
- `label` (string (length 1–60), required)
- `shape` ("box" | "round" | "diamond" | "ellipse" | "cylinder" | "document" | "actor"): Node shape. Use cylinder for databases, actor for people, diamond for decisions.
- `tone` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger")
- `group` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `icon` ("database" | "server" | "user" | "cloud" | "queue" | "api" | "mobile" | "web" | "lock" | "file" | "mail" | "settings" | "search" | "chart" | "bot" | "shield"): Optional icon: database, server, user, cloud, queue, api, mobile, web, lock, file, mail, settings, search, chart, bot, shield.
- `position` (object): Pinned top-left position in diagram units. Only honored with layout "manual".
  - `x` (number -100000–100000, required)
  - `y` (number -100000–100000, required)

### `update_node`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `label` (string (length 1–60))
- `shape` ("box" | "round" | "diamond" | "ellipse" | "cylinder" | "document" | "actor"): Node shape. Use cylinder for databases, actor for people, diamond for decisions.
- `tone` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | null): null removes the tone.
- `group` (string | null): null removes the node from its group.
- `icon` ("database" | "server" | "user" | "cloud" | "queue" | "api" | "mobile" | "web" | "lock" | "file" | "mail" | "settings" | "search" | "chart" | "bot" | "shield" | null): null removes the icon.

### `remove_node`

- `id` (string, required): Also removes every edge connected to the node.

### `add_edge`

- `id` (string): Optional explicit id; generated when omitted.
- `from` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `to` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `label` (string (length 1–40))
- `style` ("solid" | "dashed")
- `arrow` ("end" | "both" | "none")

### `update_edge`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `from` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `to` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `label` (string (length 1–40) | null): null removes the label.
- `style` ("solid" | "dashed")
- `arrow` ("end" | "both" | "none")

### `remove_edge`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").

### `add_group`

- `id` (string): Optional explicit id; generated when omitted.
- `label` (string (length 1–60), required)
- `kind` ("band" | "box"): band: a layer (TB) or lane (LR); box: a plain enclosing box.
- `nodes` (array of string (items ≤ 300)): Node ids to move into the new group.
- `after` (string): Insert after this group (bands are stacked in group order). Default: last.

### `update_group`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `label` (string (length 1–60))
- `kind` ("band" | "box"): band: a layer (TB) or lane (LR); box: a plain enclosing box.
- `after` (string | null): Move after this group; null moves it to the first position.

### `remove_group`

- `id` (string, required): Member nodes are kept and become ungrouped.

### `set_direction`

- `direction` ("TB" | "LR", required): Main flow direction: TB (top to bottom) or LR (left to right).

### `set_layout`

- `layout` ("auto" | "bands" | "manual", required): auto: automatic (bands when there are band groups, otherwise dagre); bands: groups as layers/lanes; manual: pinned positions are kept.

### `pin_node`

Pins the node at a top-left position and switches the diagram to layout "manual".

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `position` (object, required): Pinned top-left position in diagram units. Only honored with layout "manual".
  - `x` (number -100000–100000, required)
  - `y` (number -100000–100000, required)

### `unpin_node`

- `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").

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
| `nodes` | 300 |
| `edges` | 600 |
| `groups` | 30 |
| operations per call | 200 |
| serialized artifact | 5120 KB |

## Examples

### Layered architecture with bands, then add a cache

Content:

```json
{
  "direction": "TB",
  "layout": "bands",
  "groups": [
    {
      "id": "channels",
      "label": "Channels",
      "kind": "band"
    },
    {
      "id": "services",
      "label": "Services",
      "kind": "band"
    },
    {
      "id": "data",
      "label": "Data",
      "kind": "band"
    }
  ],
  "nodes": [
    {
      "id": "web",
      "label": "Web portal",
      "shape": "box",
      "icon": "web",
      "group": "channels"
    },
    {
      "id": "app",
      "label": "Mobile app",
      "shape": "box",
      "icon": "mobile",
      "group": "channels"
    },
    {
      "id": "api",
      "label": "API",
      "shape": "round",
      "tone": "accent",
      "group": "services"
    },
    {
      "id": "pg",
      "label": "PostgreSQL",
      "shape": "cylinder",
      "group": "data"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "web",
      "to": "api",
      "label": "HTTPS"
    },
    {
      "id": "e2",
      "from": "app",
      "to": "api",
      "label": "HTTPS"
    },
    {
      "id": "e3",
      "from": "api",
      "to": "pg"
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "add_node",
    "id": "cache",
    "label": "Redis",
    "shape": "cylinder",
    "group": "data"
  },
  {
    "op": "add_edge",
    "from": "api",
    "to": "cache",
    "label": "cache",
    "style": "dashed"
  }
]
```

### Create from Mermaid input

Input (`mermaid`):

```
flowchart LR
  user((Customer)) -->|order| web[Web shop]
  web --> api(Orders API)
  api --> db[(Orders DB)]
```

Content:

```json
{
  "direction": "LR",
  "layout": "auto",
  "nodes": [
    {
      "id": "user",
      "label": "Customer",
      "shape": "ellipse"
    },
    {
      "id": "web",
      "label": "Web shop",
      "shape": "box"
    },
    {
      "id": "api",
      "label": "Orders API",
      "shape": "round"
    },
    {
      "id": "db",
      "label": "Orders DB",
      "shape": "cylinder"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "user",
      "to": "web",
      "label": "order",
      "style": "solid",
      "arrow": "end"
    },
    {
      "id": "e2",
      "from": "web",
      "to": "api",
      "style": "solid",
      "arrow": "end"
    },
    {
      "id": "e3",
      "from": "api",
      "to": "db",
      "style": "solid",
      "arrow": "end"
    }
  ],
  "groups": []
}
```

### Rename a node, regroup and change direction

Content:

```json
{
  "nodes": [
    {
      "id": "a",
      "label": "Request"
    },
    {
      "id": "b",
      "label": "Approve?",
      "shape": "diamond"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "a",
      "to": "b"
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "update_node",
    "id": "a",
    "label": "Purchase request"
  },
  {
    "op": "add_group",
    "id": "buyer",
    "label": "Buyer",
    "kind": "band",
    "nodes": [
      "a"
    ]
  },
  {
    "op": "set_direction",
    "direction": "LR"
  }
]
```

## Checklist

- [ ] Groups represent layers or swimlanes.
- [ ] Labels are short (a few words).
- [ ] Keep one dominant direction (left→right or top→bottom).
- [ ] Create from Mermaid (`input.format: "mermaid"`); adjust with operations.
- [ ] Every edge points to existing nodes; no isolated nodes without reason.

## Anti-patterns

- Long sentences inside node labels.
- Duplicate edges between the same nodes.
- Empty groups.
