# artkit implementation conventions

Read with [spec.md](spec.md) (the source of truth, pt-BR, v0.3) and the root `CLAUDE.md`.

## Monorepo

- pnpm workspace, packages in `packages/*`, examples in `examples/*` (Workia and the playground are out of the workspace for now).
- TypeScript 7 (native compiler, **no JS API**). Build is plain `tsc -b` with project references (`tsconfig.build.json`).
- Imports between files use the `.js` extension (`./model.js`), even from `.ts`/`.tsx` files.
- Strict mode with `noUncheckedIndexedAccess`; `verbatimModuleSyntax` (use `import type`).
- Tests: Vitest from the root config. Test files live in `packages/<pkg>/test/**/*.test.ts(x)`. Packages resolve each other through the `@artkit/source` export condition, so tests never need a build.
- Lint/format: Biome (`pnpm lint`). `dangerouslySetInnerHTML` is a lint error.

Commands:

```bash
pnpm vitest run packages/<pkg>        # tests of one package
pnpm exec tsc -b packages/<pkg>       # typecheck/build one package (and its references)
pnpm biome check packages/<pkg>       # lint one package
pnpm build && pnpm test               # everything
```

## The format contract (spec §8)

A format is a `FormatAdapter` (`packages/core/src/adapter.ts`): `format`, `formatVersion`, `readableVersions`, `empty()`, `validate()` (returns normalized content or issues; never throws), `operationSchema`, `apply()` (async, on a copy, all or nothing), `read()` (outline, section/statements/range, full, with budget and cursor), `diff()` (targets in the same vocabulary as lint), `lint()`, `parsePartial()`, `migrations` (a chain of `formatVersion` steps), `limits` and `measure()`, and `instructions` (English, verifiable rules and examples whose operations the conformance suite runs).

Rules:

- `apply` never reads the clock, network or randomness. Functions that do (`TODAY`, `NOW`, `RAND`, `RANDBETWEEN`) and external ones (`WEBSERVICE`, `IMPORTDATA`, …) are rejected in validation.
- Ids are semantic and stable: heading anchors (`{#id}` keeps a section across renames), declaration names, sheet ids. Operations reference them, never positions, except where the position is the intent (`insert_rows`).
- Failures use `ctx.fail(message, { path, hint })`; write the message and hint so a model can fix the call, in pt-BR and English (choose by `ctx.locale.startsWith('pt')`).
- Raw HTML is stripped on validation (Markdown) or rejected (OpenUI, which only accepts registered components).
- `formatVersion` pins third-party libraries (Univer `1.3.1`, OpenUI `1.1.0`, Tiptap `3.32.x`); a library upgrade adds a migration.

## Each format package

```
src/index.ts          "."        the adapter (no React, no Node-only APIs unless the engine needs them)
src/server/           "./server" engines that need Node (Univer headless)
src/export/           "./export" exporters that need nothing extra (markdown: md, html)
test/                           adapter tests + defineFormatConformanceTests(adapter, fixtures, { describe, it })
```

Exporters are `ArtifactExporter` objects with `format` (the native source), `target` (the file format), `runtime` and `export()`. Binary exporters live in their own `export-*` packages.

## React (`@artkit-ai/react`)

- Renderers and editors are loaded per format through the provider's loaders (`renderers[format]`, `editors[format]`, `exporters[format]`).
- Controlled editors emit operations; they never write whole content, except through `replace_content`.
- The Univer editor (`@artkit-ai/format-sheet/react/univer`) needs the preset stylesheet, imported by the application: `import '@univerjs/preset-sheets-core/lib/index.css'`. Renderers and editors do not import CSS themselves.
- Servers run Univer through `createPooledSheetFormat` (worker threads, `pnpm build` first); tests of the pool use the compiled worker.
- The editor works on a local `DraftSession`: every batch is applied with the same pure engine as the server (`applyOperations`), the draft and the operations since the base version are kept in memory, and undo and redo are local. Nothing reaches the server while the user edits. The Save action (button or Ctrl/Cmd+S) calls `onSave` with `{ artifactId, format, baseVersion, title, locale, themeId, content, operations }`; the application decides what saving means (persist as a version, store, sync) and passes the saved artifact back. A rejected batch leaves the draft untouched and shows the error.

## HTTP contract (`@artkit-ai/node` routes ↔ `@artkit-ai/react` client)

Base path configurable (default `/api/artifacts`). JSON bodies; errors return the `ModelErrorPayload` body. Create takes `{ format, title, content?, operations?, locale?, themeId?, tags? }`; lists filter by `format`, `title`, `tag`. Apply takes `{ baseVersion, operations }`: any base other than the current version answers `VERSION_CONFLICT` (409) with `details.currentVersion`; the client reloads and redoes the batch. There are no history, restore, status or approval routes.

Error status by code: `NOT_FOUND` 404, `PERMISSION_DENIED` 403, `VERSION_CONFLICT` 409, `LOCKED` 423, `LIMIT_EXCEEDED` 413, `INVALID_*`/`UNSUPPORTED_FORMAT_VERSION`/`MIGRATION_FAILED`/`OPERATION_FAILED`/`UNKNOWN_FORMAT`/`ASSET_REJECTED` 422, `EXPORT_FAILED`/`ENGINE_UNAVAILABLE`/`INTERNAL_ERROR` 500.

The server never trusts workspace or user ids from the body: the application passes `resolveScope(request)`.
