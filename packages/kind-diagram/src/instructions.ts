import type { KindInstructions } from '@artkit-ai/core';
import { parseMermaid } from './mermaid.js';
import { DIAGRAM_LIMITS, NODE_ICONS } from './schema.js';

export const MERMAID_INPUT_DESCRIPTION = [
  'Mermaid flowchart subset. First line "flowchart TD" (or graph; TB/TD/BT → TB, LR/RL → LR).',
  'Nodes: A[box] A(round) A{diamond} A((ellipse)) A[(cylinder)] or a plain id; quote labels with brackets: A["a [b]"].',
  'Edges: A --> B, A --- B (no arrow), A -.-> B (dashed), A ==> B, A <--> B, labels as A -->|text| B or A -- text --> B;',
  'chains A --> B --> C and fan-out A --> B & C.',
  '"subgraph id [Label]" … "end" makes groups: at least two non-nested subgraphs whose edges never loop back become',
  'bands (layout "bands"), otherwise boxes. %% comments, classDef/class/style/linkStyle/click lines are ignored.',
].join(' ');

const mermaidExample =
  'flowchart LR\n  user((Customer)) -->|order| web[Web shop]\n  web --> api(Orders API)\n  api --> db[(Orders DB)]';

export const diagramInstructions: KindInstructions = {
  summary:
    'Diagram of nodes, edges and groups for architectures, process flows, integrations and simple org charts. ' +
    'Create it from Mermaid flowchart source (input format "mermaid") or JSON content; then adjust it with operations that reference ids.',
  rules: [
    'Pick one dominant direction: TB for layered architectures and hierarchies, LR for processes and pipelines.',
    'Use groups as layers (TB) or lanes (LR): kind "band" with layout "bands" (or "auto"). Use kind "box" only for loose clusters.',
    'Keep labels short: nodes up to 60 characters (aim for 2–4 words), edge labels up to 40 (1–3 words).',
    'Create with Mermaid input; edit an existing diagram with operations (add_node, update_edge, …) instead of resending it.',
    'Edges must reference existing node ids, node.group an existing group id; ids are unique across nodes, edges and groups.',
    'Shapes: cylinder for databases, actor for people, diamond for decisions, document for files, round for services, box otherwise.',
    `Icons (optional, closed set): ${NODE_ICONS.join(', ')}. Tones are theme tokens (accent, info, success, warning, danger, muted).`,
    'remove_node also removes its edges; remove_group keeps its nodes, ungrouped.',
    'pin_node fixes a node position and switches to layout "manual"; only pin when the user asks for a specific placement.',
    `Limits: ${DIAGRAM_LIMITS.nodes} nodes, ${DIAGRAM_LIMITS.edges} edges, ${DIAGRAM_LIMITS.groups} groups.`,
  ],
  examples: [
    {
      title: 'Layered architecture with bands, then add a cache',
      content: {
        direction: 'TB',
        layout: 'bands',
        groups: [
          { id: 'channels', label: 'Channels', kind: 'band' },
          { id: 'services', label: 'Services', kind: 'band' },
          { id: 'data', label: 'Data', kind: 'band' },
        ],
        nodes: [
          { id: 'web', label: 'Web portal', shape: 'box', icon: 'web', group: 'channels' },
          { id: 'app', label: 'Mobile app', shape: 'box', icon: 'mobile', group: 'channels' },
          { id: 'api', label: 'API', shape: 'round', tone: 'accent', group: 'services' },
          { id: 'pg', label: 'PostgreSQL', shape: 'cylinder', group: 'data' },
        ],
        edges: [
          { id: 'e1', from: 'web', to: 'api', label: 'HTTPS' },
          { id: 'e2', from: 'app', to: 'api', label: 'HTTPS' },
          { id: 'e3', from: 'api', to: 'pg' },
        ],
      },
      operations: [
        { op: 'add_node', id: 'cache', label: 'Redis', shape: 'cylinder', group: 'data' },
        { op: 'add_edge', from: 'api', to: 'cache', label: 'cache', style: 'dashed' },
      ],
    },
    {
      title: 'Create from Mermaid input',
      input: { format: 'mermaid', source: mermaidExample },
      content: parseMermaid(mermaidExample).content,
    },
    {
      title: 'Rename a node, regroup and change direction',
      content: {
        nodes: [
          { id: 'a', label: 'Request' },
          { id: 'b', label: 'Approve?', shape: 'diamond' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b' }],
      },
      operations: [
        { op: 'update_node', id: 'a', label: 'Purchase request' },
        { op: 'add_group', id: 'buyer', label: 'Buyer', kind: 'band', nodes: ['a'] },
        { op: 'set_direction', direction: 'LR' },
      ],
    },
  ],
};
