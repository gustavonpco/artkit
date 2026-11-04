# @artkit/core

The runtime-neutral heart of artkit: artifact envelope, kind contract and registry, the atomic operation engine, versioning with automatic rebase, migrations, diff, lint and projection helpers, the error catalog, store/asset/event contracts and the high-level artifact service.

Its only dependency is `zod`. It runs in browsers, Node 22+, edge runtimes and workers (no DOM, no Node APIs).

```bash
npm install @artkit/core
```

## Usage

```ts
import { createArtifactService, createMemoryStore, createRegistry } from '@artkit/core';
import { documentKind } from '@artkit/kind-document';

const registry = createRegistry({ kinds: [documentKind] });
const service = createArtifactService({
  registry,
  store: createMemoryStore(),
  authorize: (action, artifact, scope) => scope.workspaceId === 'acme',
  locale: 'pt-BR',
});

const scope = { workspaceId: 'acme', actor: { type: 'agent', id: 'agent-proposals' } } as const;
const { artifact } = await service.create(scope, {
  kind: 'document',
  title: 'Proposta técnica',
  input: { format: 'markdown', source: '# Proposta\n\n## Escopo\n\nPortal de fornecedores.' },
});

const result = await service.apply(scope, {
  artifactId: artifact.id,
  baseVersion: artifact.version,
  operations: [{ op: 'set_title', title: 'Proposta técnica v2' }],
});
console.log(result.version, result.diff, result.lint);
```

## What is inside

| Area          | API                                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope      | `Artifact`, `envelopeSchema`, statuses and lifecycle transitions                                                                                                                                           |
| Kinds         | `ArtifactKind`, `defineKind`, `createRegistry` (kinds, themes, exporters, limits)                                                                                                                          |
| Engine        | `applyOperations` (validate → clone → apply → derive → revalidate → limits → diff → lint, all or nothing), `prepareContent`, envelope operations `set_title`, `set_theme`, `set_locale`, `replace_content` |
| Service       | `createArtifactService`: authorization hook, `baseVersion` with automatic rebase or `VERSION_CONFLICT`, idempotency keys, locks, approval policy, history and restore, export orchestration with timeout   |
| Projection    | `projectItems`, `paginate` (token budget and cursor), `selectRange`, `delimitProjection`                                                                                                                   |
| Diff          | `diffCollection` (added, removed, changed, moved), `diffFields`                                                                                                                                            |
| Errors        | `ArtifactError`, `toModelError` (never leaks stack traces), pt-BR and English catalogs                                                                                                                     |
| Security      | `sanitizeDeep` (control characters, NFC), `linkSchema`, `checkAsset` (magic-byte MIME sniffing, size, domains), `sanitizeSvg`                                                                              |
| Schemas       | `toJsonSchema` with `default`, `strict` and `compact` profiles; `stripNulls`                                                                                                                               |
| Stores        | `ArtifactStore`, `AssetStore` contracts; `createMemoryStore`, `createMemoryAssetStore` (reference adapters)                                                                                                |
| UI contracts  | `RenderContext`, `EditorBindings`, `themeCssVariables` (shared by renderers, editors and `@artkit/react`)                                                                                                  |
| Events & logs | `createEventBus`, `Logger` (metadata only), metric hooks                                                                                                                                                   |

`@artkit/core/testing` exports `defineStoreContractTests` (every store adapter must pass it) and `defineKindConformanceTests` (every kind, native or third-party).

## Notes

- `apply` is pure and deterministic: no clock, network or randomness. Replays always produce the same content.
- The memory store lives here (not in `@artkit/node`) so it also works in the browser playground and in edge runtimes; `@artkit/node` re-exports it.
- `INTERNAL_ERROR` extends the spec's error catalog for unexpected failures, so details never reach the model.

License: Apache-2.0.
