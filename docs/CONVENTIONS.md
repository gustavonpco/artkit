# artkit implementation conventions

Read with [spec.md](spec.md) (the source of truth, pt-BR) and the root `CLAUDE.md`.

## Monorepo

- pnpm workspace, packages in `packages/*`, examples in `examples/*`.
- TypeScript 7 (native compiler, **no JS API**: tools needing `typescript` programmatically do not work). Build is plain `tsc -b` with project references; every package emits ESM + `.d.ts` to `dist/`.
- Imports between files use the `.js` extension (`./model.js`), even from `.ts`/`.tsx` files.
- Strict mode with `noUncheckedIndexedAccess`; `verbatimModuleSyntax` (use `import type`).
- Tests: Vitest from the root config. Test files live in `packages/<pkg>/test/**/*.test.ts(x)`. Packages resolve each other through the `@artkit/source` export condition, so tests never need a build. React tests start with the docblock `// @vitest-environment jsdom`.
- Lint/format: Biome (`pnpm lint`). `dangerouslySetInnerHTML` is a lint error.

Commands:

```bash
pnpm vitest run packages/<pkg>        # tests of one package
pnpm vitest run packages/<pkg>/test/x.test.ts -t "name"   # one test
pnpm exec tsc -b packages/<pkg>       # typecheck/build one package (and its references)
pnpm biome check packages/<pkg>       # lint one package
pnpm build && pnpm test               # everything
```

Dependencies are declared per package; versions are pinned in the lockfile. Adding a dependency requires a license compatible with Apache-2.0 (checked by `pnpm check:licenses`).

## Core API map (`packages/core/src`)

| File            | What you use from it                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind.ts`       | `ArtifactKind` contract, `defineKind`, `ProjectionOptions`, `Projection`, `LintIssue`, `ChangeSummary`, `ApplyContext` (`nextId`, `hasId`, `reserveId`, `fail`), `ContentInput`, `KindInstructions` |
| `engine.ts`     | `applyOperations`, `prepareContent` (sanitize → normalize ids → derive → validate → limits), envelope operations                                                                                    |
| `projection.ts` | `projectItems`, `paginate`, `selectRange`, `ellipsis`, `estimateTokens`                                                                                                                             |
| `diff.ts`       | `diffCollection` (added/removed/changed/moved by id), `diffFields`, `deepEqual`, `stableStringify`                                                                                                  |
| `ids.ts`        | `itemIdSchema`, `IdAllocator`, `findDuplicateIds`                                                                                                                                                   |
| `theme.ts`      | `colorSchema` (token or hex), `resolveColor`, `defaultTheme`, `contrastRatio`                                                                                                                       |
| `sanitize.ts`   | `linkSchema` (https/http/mailto/#anchor), `sanitizeString`                                                                                                                                          |
| `assets.ts`     | `assetRefSchema` (`asset://id`), `AssetResolver`, `toDataUrl`                                                                                                                                       |
| `registry.ts`   | `ArtifactExporter`, `ExportContext` (`warn()` for fidelity degradations)                                                                                                                            |
| `ui.ts`         | `RenderContext`, `EditorBindings`, `themeCssVariables`, `themeCssText`                                                                                                                              |
| `service.ts`    | `createArtifactService` (full pipeline: auth, rebase, idempotency, locks, lifecycle, export)                                                                                                        |
| `memory.ts`     | `createMemoryStore`, `createMemoryAssetStore`                                                                                                                                                       |
| `testing/`      | `defineKindConformanceTests`, `defineStoreContractTests`                                                                                                                                            |

## Kind packages (`@artkit/kind-*`)

```
src/index.ts            "."        model: schemas, operations, apply, projection, lint, diff,
                                   parsePartial, inputs, instructions, limits, migrations
src/*.ts (non-UI)       "."        split the model freely (schema.ts, operations.ts, projection.ts…)
src/react/index.ts      "/react"   <XRenderer content ctx /> + `xCss` string
src/edit/index.ts       "/edit"    <XEditor {...EditorBindings} />
src/export/index.ts     "/export"  exporters (`xExporters: ArtifactExporter[]`)
```

Rules:

- The `.` entry (everything outside `react/`, `edit/`, `export/`) imports only `@artkit/core`, `zod` and pure-JS parsers the kind needs (document: mdast). No `window`, `document`, React or Node APIs. Checked by `pnpm check:deps`.
- Export a ready instance (`documentKind`) and a factory when the kind is configurable (`createSheetKind({ formulaEngine })`, `createSlidesKind({ layouts })`).
- `version: 1`, `migrations: []` for the first schema.
- Item ids follow `itemIdSchema` and are unique across the whole artifact. Ids are optional on creation: implement `normalize(raw, ctx)` to fill missing ids with `ctx.nextId(prefix)`; in operations, optional `id` fields fall back to `ctx.nextId`. Reserve explicit ids with `ctx.reserveId` and reject collisions with `ctx.fail`.
- Operations reference items by id, never index (except when the position is the intent). Implement `targets(op)` returning the item targets an operation touches (`block:intro`, `cell:Resumo!A1`, `slide:s3`), so automatic rebase is precise.
- Use `ctx.fail(message, { hint, path })` for valid operations that cannot be applied; write the message and hint so a model can fix the call. Provide pt-BR and English text (choose by `ctx.locale.startsWith('pt')`).
- Integrity rules that a schema cannot express go in `validate(content)` and return issues with paths relative to the content.
- `measure(content)` returns counters with the same keys as `limits` (spec §6.6).
- Projection formats follow spec §9.3 and always expose ids. Support `outline`, `full` and `range`, cut on item boundaries with `projectItems`/`paginate`.
- `diff` returns `ChangeSummary[]` with targets in the same vocabulary as `targets`.
- `parsePartial` must accept complete content and drop incomplete trailing items from streamed JSON (it receives an already-parsed partial object).
- `instructions` are in English: short summary, verifiable rules, minimal examples whose content and operations validate (the conformance suite checks them).
- Tests must include `defineKindConformanceTests(kind, fixtures, { describe, it })` plus unit tests per operation, including rejections with expected code and path.

### Renderers (`/react`)

- Props: `{ content: Content; ctx: RenderContext; className?: string }`. Read-only, semantic HTML (headings, tables with `<th>`, lists, `alt`).
- Never `dangerouslySetInnerHTML`. Links: only `isSafeLink` targets, external ones with `rel="noopener noreferrer"` and `target="_blank"`.
- Colors through CSS variables (`var(--ak-color-accent)`) or `resolveColor(ctx.theme, color)`; the host sets variables with `themeCssVariables`.
- Export the CSS as a string (`documentCss`), class names prefixed `ak-<kind>-`. No CSS imports (works without a bundler and in headless export).
- `ctx.mode === 'print'` renders the print layout used by headless PDF/PNG (page breaks, fixed slide size).
- Assets: `ctx.resolveAssetUrl(ref)`; render a placeholder when it returns undefined.

### Editors (`/edit`)

- Props: `EditorBindings<Content, Operation>` (`content`, `ctx`, `emit`, `readOnly`, `lint`).
- Controlled: render the given content; every interaction becomes kind operations via `emit`. Never emit `replace_content` for normal editing.
- A continuous gesture (drag, resize) emits one operation at the end with `{ kind: 'continuous' }`; text typing uses `{ kind: 'typing' }` so the host can batch.
- Keyboard accessible, visible focus, `aria-*` labels on controls.
- The host (`@artkit/react` `ArtifactEditor`) owns batching, optimistic apply, undo/redo, conflict handling and locks.

### Exporters (`/export`)

- `ArtifactExporter` with `runtime: 'any'` when the library runs in browsers too, `'node'` otherwise.
- Resolve assets with `ctx.assets.resolve(ref)`; report lossy conversions with `ctx.warn(message)`.
- Tests re-read the produced file with the format library when possible (spec §21.1).
- PDF and PNG come from headless rendering of the `/react` renderer in `@artkit/node/headless`, not from kind packages.

## HTTP contract (`@artkit/node` routes ↔ `@artkit/react` client)

Base path configurable (default `/api/artifacts`). JSON bodies; errors return the `ModelErrorPayload` body.

| Method & path              | Body / query                                                                | Response                                                                                        |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET {base}`               | `kind,status,title,tag,limit,cursor`                                        | `Page<ArtifactSummary>`                                                                         |
| `POST {base}`              | `CreateRequest`                                                             | `CommitResult`                                                                                  |
| `GET {base}/{id}`          | `version?`                                                                  | `Artifact`                                                                                      |
| `GET {base}/{id}/read`     | `mode,range,maxTokens,cursor,version`                                       | `ReadResult`                                                                                    |
| `POST {base}/{id}/apply`   | `{ baseVersion, operations, idempotencyKey?, message? }`                    | `CommitResult`                                                                                  |
| `POST {base}/{id}/preview` | same as apply                                                               | `BatchResult`                                                                                   |
| `GET {base}/{id}/history`  | `limit,cursor`                                                              | `Page<VersionEntry>`                                                                            |
| `POST {base}/{id}/restore` | `{ version, message? }`                                                     | `CommitResult`                                                                                  |
| `POST {base}/{id}/status`  | `{ action: 'submit'\|'approve'\|'reject'\|'publish'\|'archive', message? }` | `Artifact`                                                                                      |
| `GET {base}/{id}/lock`     |                                                                             | `Lock \| null`                                                                                  |
| `POST {base}/{id}/lock`    | `{ ttlMs? }`                                                                | `Lock`                                                                                          |
| `DELETE {base}/{id}/lock`  | `Lock`                                                                      | `204`                                                                                           |
| `POST {base}/{id}/export`  | `{ format, version?, options? }`                                            | file bytes; `Content-Type`, `Content-Disposition`, `X-Artkit-Warnings` (URI-encoded JSON array) |

Error status by code: `NOT_FOUND` 404, `PERMISSION_DENIED` 403, `APPROVAL_REQUIRED` 403, `VERSION_CONFLICT` 409, `LOCKED` 423, `LIMIT_EXCEEDED` 413, `INVALID_*`/`UNSUPPORTED_VERSION`/`MIGRATION_FAILED`/`OPERATION_FAILED`/`UNKNOWN_KIND`/`ASSET_REJECTED` 422, `EXPORT_FAILED`/`INTERNAL_ERROR` 500.

The server never trusts workspace or user ids from the body: the application passes `resolveScope(request)`.
