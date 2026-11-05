# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`artkit` is an Apache-2.0 TypeScript monorepo (pnpm) that lets AI agents create, read, edit and export artifacts stored in their **native formats**. The library is the core only: view, edit and export. It keeps no history, archive or approval; saving is an action the editor emits to the harness, which decides what it means (see the decision note in `docs/rfc/0001-core-sem-historico.md`): Markdown (`markdown`), Univer workbooks (`univer-sheet`) and OpenUI Lang visuals (`openui`). [docs/spec.md](docs/spec.md) (pt-BR, v0.3) is the source of truth; cite it by section (e.g. "§9.2"). [docs/CONVENTIONS.md](docs/CONVENTIONS.md) holds the implementation rules (format adapters, renderer/editor/exporter rules, HTTP contract) — read it before adding code. Changes to the data standard go through an RFC (§25).

## Commands

```bash
pnpm install
pnpm build                          # tsc -b tsconfig.build.json (all packages, project references)
pnpm test                           # Vitest over packages/*/test and examples/*/test
pnpm vitest run packages/kind-sheet                                   # one package
pnpm vitest run packages/core/test/engine.test.ts -t "batch"          # one test
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
- AI SDK 7 names: `ToolLoopAgent`, `isStepCount` (not `stepCountIs`), per-request context via `callOptionsSchema` + `prepareCall` returning `toolsContext`, `MockLanguageModelV4` from `ai/test`.

## Architecture

Each artifact is a JSON **envelope** (§7.1): system fields (`id`, `format`, `formatVersion`, `version`, `meta`) are never agent-writable; only `content` is. The library keeps only the current content and a `version` counter. `content` is the native value of its format (text or `IWorkbookData`), and `apply` is the only way it changes.

- `packages/core`: format-agnostic pipeline. `adapter.ts` (the `FormatAdapter` contract, §8), `engine.ts` (`applyOperations` is async: envelope ops, runs of adapter ops, validation, limits, diff, lint, all or nothing), `service.ts` (authorization, `baseVersion` check with `VERSION_CONFLICT` on any stale base, locks, export with timeout), `registry.ts`, `memory.ts`, `testing/` (store contract and format conformance suites).
- `packages/format-markdown`: dialect and section model (anchors, frontmatter), operations of §10.5, reading, lint, diff; Tiptap (`@tiptap/markdown`) validates the dialect. `./export`: md and html. `./react`: read-only Tiptap view and editor (edits become `replace_section`/`rename_section`, or `replace_content` for structural changes).
- `packages/format-sheet`: `IWorkbookData` validation (no volatile or external functions), A1 reading, operations resolved against the workbook (including `fill_range` with relative reference shifts) and executed by a `SheetEngine`. `./server` is the Univer headless engine (one instance reused per engine, batches serialized, units disposed per batch) and `createUniverPool` (worker threads with a time limit, heap limit and recycling). `./react`: a read-only grid, a plain cell editor, and `./react/univer` (`UniverSheetEditor`), the Univer UI editor whose grid changes become operations: structural commands with positions, other changes by comparing the grid with the last reported state.
- `packages/format-openui` + `packages/openui-components`: OpenUI Lang declarations validated by `@openuidev/lang-core` against the artkit catalog (schemas only, no React). `./react`: `OpenUIRenderer` on the `react-lang` runtime with a React component per catalog entry. `./export`: html export and the headless source for pdf/png.
- `packages/export-docx`, `export-xlsx`, `export-pptx`: binary exporters isolated per file format.
- `packages/react`: framework layer over an `ArtifactClient`; renders each format through loaders registered per format. Three modules: view (`ArtifactView`), editor (`ArtifactEditor`, a local `DraftSession` with undo and redo; the Save action emits `onSave` with the draft and the operations since the base version, and the application persists it), export (`ArtifactPanel` export menu, `useArtifactExport`). Visual identity: the Mouts design system tokens in `packages/core/src/theme.ts` (light and dark).
- `packages/node`: filesystem stores, HTTP routes, export orchestration, headless PDF/PNG.
- `packages/agent` → `ai-sdk` / `mcp`: the seven tools of §15.1 (`artifact_create`, `artifact_read`, `artifact_apply` or `artifact_apply_<format>`, `artifact_export`, `artifact_list`, `artifact_guide`), instructions and skills generated from the adapters.
- `packages/skills` (generated skills, checked in CI) and `packages/evals` (tasks with deterministic checks for the three formats).

Key invariants: `apply` is pure and deterministic (no clock, network or randomness; volatile spreadsheet functions are rejected instead of recalculated from the clock); ids and anchors are stable; operations reference anchors, declarations, cells or sheets, never indexes; errors use the single `ArtifactError` shape with model-facing hints in pt-BR/en; no raw HTML in structured formats; logs carry metadata only; packages never read environment variables.

Visual identity: components and exporters read only theme tokens (`resolveColor`, `--ak-*` variables from `themeCssVariables`), never hard-coded brand values. Sora is embedded for headless export.

Phase status: formats, core, exporters, node, agent, ai-sdk, mcp, skills, evals, the React view and editor modules (Markdown as a word-processor page on Tiptap, Univer grid, OpenUI) and the Univer worker pool are implemented. History, archive, approval, idempotency and rebase were removed from the library; `docs/spec.md` still describes them until the RFC is accepted. `set_validation` and `clear_range` with `all` are implemented too, and the playground (`examples/playground`) runs all three formats. Pending: dropdown rules created in the Univer grid are not read back, number formats outside the named ones, charts beyond the SVG basics, and the Workia adaptation (the sheet editor demo is in `examples/sheet-editor-demo`).

## Repository notes

- `examples/workia-migration` still targets the v0.2 kinds and is out of the workspace (`pnpm-workspace.yaml`) until the Workia project adapts it. Never modify the Workia repository from here.
- `examples/playground` is out of the workspace; `examples/sheet-editor-demo` is the Univer editor demo (`pnpm --filter @artkit-ai/example-sheet-editor-demo dev`).
- Univer's presets log "Attempted to synchronously unmount a root while React was already rendering" on first mount, also in a bare page without artkit code. It is a Univer 1.3.1 warning; the grid works.
- Packages are published under the npm scope `@artkit-ai/*` (`@artkit` belongs to someone else). `docs/spec.md` says `@artkit/*`; the `@artkit/source` export condition keeps its name on purpose.
- The GitHub repository is `gustavonpco/artkit` (public, required for npm provenance). Releases run through changesets in `.github/workflows/release.yml` with the `NPM_TOKEN` secret.
