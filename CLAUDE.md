# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`artkit` is an Apache-2.0 TypeScript monorepo (pnpm) that lets AI agents create, read, edit, render and export rich artifacts (document, sheet, slides, diagram). [docs/spec.md](docs/spec.md) (pt-BR) is the source of truth; cite it by section (e.g. "§8.2"). [docs/CONVENTIONS.md](docs/CONVENTIONS.md) holds the implementation rules (package layout, kind contract usage, renderer/editor/exporter rules, HTTP contract) — read it before adding code. Phase 1 of the spec is implemented; phase 2 (`app` kind, sandbox, CLI) and phase 3 (collaboration, Office import) are not. Changes to the data standard go through an RFC (§23.2).

## Commands

```bash
pnpm install
pnpm build                          # tsc -b tsconfig.build.json (all packages, project references)
pnpm test                           # Vitest over packages/*/test and examples/*/test
pnpm vitest run packages/kind-sheet                                   # one package
pnpm vitest run packages/core/test/engine.test.ts -t "rebase"         # one test
pnpm exec tsc -b packages/kind-sheet  # typecheck/build one package (and its references)
pnpm lint                           # Biome (pnpm biome check --write <path> to fix)
pnpm check:deps                     # dependency rules of spec §5.3
pnpm check:licenses                 # production dependency licenses (Apache-2.0 compatible)
pnpm check:publish                  # npm readiness (--release makes placeholders fatal)
pnpm skills:generate                # regenerate packages/skills/skills after build
pnpm verify                         # everything CI runs
pnpm --filter @artkit-ai/example-playground dev   # browser playground on :5287
```

Tests import workspace packages through the `@artkit/source` export condition (configured in `vitest.config.ts`), so they run against TypeScript sources without a build. Scripts and examples that import `dist/` (skills generator, `examples/node-script`, `examples/mcp-server`) need `pnpm build` first.

## Toolchain gotchas

- TypeScript is 7.x (native compiler): **there is no TypeScript JS API**, so tools like tsup's dts or typescript-eslint don't work. Builds are plain `tsc -b`; `.d.ts` files inside `src` are ignored by composite projects (use `.ts` with `declare global` instead, see `packages/core/src/runtime-globals.ts`).
- Imports between files use the `.js` extension even from `.ts`/`.tsx`.
- `packages/core` compiles without the DOM lib on purpose; only web-standard globals are declared.
- Biome's formatter rewrites Markdown tables and some regexes; `docs/spec.md` is excluded from Biome — never reformat it. Use `/\p{M}/gu` instead of `[̀-ͯ]` (Biome turns the latter into literal combining characters).
- AI SDK 7 names: `ToolLoopAgent`, `isStepCount` (not `stepCountIs`), per-request context via `callOptionsSchema` + `prepareCall` returning `toolsContext`, agent-level `toolApproval`, `MockLanguageModelV4` from `ai/test`.

## Architecture

Each artifact is a JSON **envelope** (§6.1): system fields (`id`, `kind`, `schemaVersion`, `version`, `status`, `meta`) are never agent-writable; only `content` is. The same content drives renderers, editors, the text projection read by models and the exporters.

- `packages/core`: everything kind-agnostic. `kind.ts` (the `ArtifactKind` contract every kind implements, incl. `normalize`, `targets`, `derive`, `measure`), `engine.ts` (pure `applyOperations`/`prepareContent`: sanitize → validate each op → clone → apply → derive → revalidate → limits → diff → lint, all or nothing), `service.ts` (`createArtifactService`: authorization hook, `baseVersion` with automatic rebase or `VERSION_CONFLICT`, idempotency, locks, approval lifecycle, export with timeout), `memory.ts` (reference stores; they live in core so they run in browsers/edge), `testing/` (store contract suite and kind conformance suite every adapter/kind must pass), `ui.ts` (`RenderContext`, `EditorBindings` shared by renderers, editors and `@artkit-ai/react`).
- `packages/kind-*`: each kind has subpaths `.` (model; may only import core, zod and pure parsers — mdast for document, dagre for diagram), `/react` (renderer + CSS string), `/edit` (controlled editor that only emits operations), `/export` (exporters). Sheet has its own formula engine (`src/formula`); slides layouts are registrable via `createSlidesKind({ layouts })`.
- `packages/react`: never touches a store; talks to an `ArtifactClient` (HTTP client or in-process `createServiceClient`). `ArtifactEditor` + framework-free `editor-session.ts` own batching, optimistic apply, undo/redo, rebase/conflict UI and locks for every kind.
- `packages/node`: filesystem stores, fetch-standard HTTP routes (`createArtifactRoutes`, contract in CONVENTIONS), export orchestration, `/headless` PNG/PDF via Playwright (optional peer).
- `packages/agent` → `ai-sdk` / `mcp`: the neutral toolkit (tools, instructions, guides, skills generation) and thin adapters. Scope (workspace, actor) always comes from execution context, never from model arguments.
- `packages/skills` (generated Agent Skills, checked in CI) and `packages/evals` (tasks with deterministic checks and reference solutions, run through a real `ToolLoopAgent`).

Visual identity: the default theme (`defaultTheme`/`defaultDarkTheme` in `packages/core/src/theme.ts`) is the Mouts design system; components and exporters read only theme tokens (`--ak-color-*`, `--ak-gradient-*`, `--ak-radius-*`, `--ak-font-*` from `themeCssVariables`), never hard-coded brand values. Icons are Lucide (`lucide-react` in UI code; diagram node icons are generated data, `pnpm icons:generate`). Sora is embedded as base64 in `@artkit-ai/core/fonts` (`pnpm fonts:generate`) so headless export works offline.

Editor and viewer chrome is shared, so every kind looks the same in light and dark: toolbars use `Toolbar`/`ToolbarGroup`/`ToolbarButton`/`ToolbarMenu`/`ToolbarSelect`/`ToolbarColor`, and side panels use the controls in `packages/react/src/controls.tsx` (`Inspector`, `InspectorSection`, `Button`, `IconButton`, `TextField`, `NumberField`, `SelectField`, `ColorPicker`, `Switch`, `Segmented`). Each kind's CSS string starts with `kitCss`. Do not add element-level rules like `.ak-x-editor button {…}`: they override the shared classes. Plain unclassed controls inside an `.ak-ctl-scope` root get the standard look with zero specificity. Editors lay out with container queries, not media queries, because they are often embedded in narrow panels. Inside `<ArtifactProvider>` the host sets the theme variables (with dark mode); kinds set inline theme variables only when standalone (`useOptionalArtkit()`).

Key invariants: `apply` is pure and deterministic (no clock, network or randomness — sheet `TODAY()` reads `settings.calculationDate`); ids are unique across the whole artifact and stable; operations reference ids, not indexes; errors use the single `ArtifactError` shape with model-facing hints in pt-BR/en; no raw HTML in structured kinds; logs carry metadata only; packages never read environment variables.

## Repository notes

- `examples/workia-migration` converts the artifact model of `/Users/gustavo/Codes/21-workia` (the first consumer, which artkit will replace) and runs the import end to end; read its README for the mapping and known gaps. Never modify the Workia repository from here.
- Packages are published under the npm scope `@artkit-ai/*` (`@artkit` belongs to someone else). `docs/spec.md` still says `@artkit/*` and is left as is; the `@artkit/source` export condition keeps its name on purpose.
- The GitHub repository is `gustavonpco/artkit` (public, required for npm provenance). Releases run through changesets in `.github/workflows/release.yml` with the `NPM_TOKEN` secret.
