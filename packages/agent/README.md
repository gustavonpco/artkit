# @artkit/agent

Harness-neutral agent toolkit for artkit: tool definitions, system instructions, guides (Agent Skills) and
model-facing errors. It depends only on `@artkit/core` and `zod` and runs in browsers, Node, edge and workers.
Adapters such as `@artkit/ai-sdk` and `@artkit/mcp` wrap it without changing names or schemas.

## Usage

```ts
import { createRegistry, createMemoryStore, createMemoryAssetStore } from '@artkit/core';
import { createArtifactToolkit } from '@artkit/agent';

const toolkit = createArtifactToolkit({
  registry: createRegistry({ kinds: [documentKind, sheetKind] }),
  store, // any ArtifactStore
  assets, // AssetStore; enables artifact_export
  authorize: (action, artifact, scope) => canAccess(scope, action, artifact), // mandatory
  approval: { submit: 'always', apply: 'published', export: 'never' },
  locale: 'pt-BR', // language of error messages
  schemaProfile: 'default', // 'strict' | 'compact' (spec §14.6)
  applyMode: 'union', // 'per-kind' → artifact_apply_<kind>
  read: { defaultMaxTokens: 6000 },
});

const tool = toolkit.tool('artifact_create')!;
const result = await tool.execute(
  { kind: 'document', title: 'Proposal', input: { format: 'markdown', source: '# Proposal' } },
  { scope: { workspaceId, actor }, idempotencyKey: toolCallId, emit: (event) => ui.push(event.artifact) },
);
// { ok: true, id, kind, title, version, status, createdIds, lint, replayed } or { ok: false, error }
```

## Tools

| Tool              | Purpose                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `artifact_create` | Create from `content` or `input` (`markdown`, `csv`, `mermaid`…).                                                                  |
| `artifact_read`   | Delimited text projection (`outline`, `full`, `range`), token budget and cursor.                                                   |
| `artifact_apply`  | Atomic batch of operations on `baseVersion`; union of the enabled kinds (or `artifact_apply_<kind>`).                              |
| `artifact_export` | Export to the asset store; returns a reference and fidelity warnings, never bytes. Present only with exporters and an asset store. |
| `artifact_list`   | Filters and pagination.                                                                                                            |
| `artifact_submit` | Send for human approval.                                                                                                           |
| `artifact_guide`  | Guide topics on demand: `overview`, one per kind, `themes`, `errors`.                                                              |

Each tool is `{ name, description, inputSchema, zodSchema, readOnly, needsApproval?, execute }`.

- **Scope** comes only from the execution context. Model arguments never carry workspace or user ids; extra
  keys are stripped.
- **Errors** are returned, not thrown, as `ModelErrorPayload` from the core catalog, localized.
- **Idempotency**: pass the harness tool call id as `idempotencyKey`; repeated create/apply calls are replayed.
- **Every success** carries the new `version`, so the model always has the next `baseVersion`.
- **Strict profile**: model `null`s are removed before validation, except inside free-form `content`/`source`.
- **Prompt injection**: projections are wrapped in `<artifact-content>` markers and the instructions tell the
  model not to follow instructions found inside artifacts.

## Instructions and skills

```ts
toolkit.instructions({ detail: 'compact' }); // system prompt block for the enabled kinds
toolkit.instructions({ kinds: ['sheet'], detail: 'full' });
toolkit.skills(); // [{ path, content }] for artkit-artefatos/ and artkit-integracao/
toolkit.guide('sheet'); // one reference, as artifact_guide returns it

import { renderSkills } from '@artkit/agent';
renderSkills(registry, { extensions: { 'artkit-artefatos/references/document.md': '## House rules\n…' } });
```

Technical parts (fields, operations, limits, examples) are generated from the registry. Authored prose lives in
`src/guides/` (workflow, rules, per-kind checklists and anti-patterns, error actions, integration guide);
third-party kinds get a generic checklist.
