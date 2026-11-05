# @artkit-ai/format-sheet

Spreadsheet native format on Univer `IWorkbookData`: A1 reading, operations executed on Univer headless, lint and diff.

- `@artkit-ai/format-sheet`: the adapter. Validation rejects volatile (`TODAY`, `NOW`, `RAND`) and external functions.
- `@artkit-ai/format-sheet/server`: `createUniverEngine` (one reused instance per engine) and `createUniverPool` / `createPooledSheetFormat` (worker threads, time and heap limits, recycling).
- `@artkit-ai/format-sheet/react`: read-only grid and a plain cell editor.
- `@artkit-ai/format-sheet/react/univer`: `UniverSheetEditor`, the Univer UI editor. Import `@univerjs/preset-sheets-core/lib/index.css` in the application.

Part of [artkit](../../README.md). The normative description is in [docs/spec.md](../../docs/spec.md) (v0.3).
