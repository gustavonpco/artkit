# @artkit/kind-sheet

Spreadsheet artifact kind for [artkit](../../docs/spec.md) (spec §11.2): a workbook model that AI agents edit
through typed operations, with its own Excel-compatible formula engine, a text projection for models, lint,
diff, a read-only React renderer, a visual editor and xlsx/csv/html exporters.

```bash
pnpm add @artkit/kind-sheet @artkit/core zod
# optional, for /react and /edit
pnpm add react react-dom
```

## Usage

```ts
import { createRegistry, applyOperations, prepareContent } from '@artkit/core';
import { sheetKind, createSheetKind } from '@artkit/kind-sheet';
import { sheetExporters } from '@artkit/kind-sheet/export';

const registry = createRegistry({ kinds: [createSheetKind({ locale: 'pt-BR' })], exporters: sheetExporters });

const { content } = prepareContent(registry, 'sheet', {
  sheets: [
    {
      name: 'Estimativa',
      cells: { A1: { v: 'Horas' }, A2: { v: 10 }, B2: { f: 'A2*valor_hora', fmt: 'currency' } },
    },
    { name: 'Parametros', cells: { A1: { v: 150, fmt: 'currency' } } },
  ],
  names: [{ name: 'valor_hora', ref: 'Parametros!$A$1' }],
});
// content.sheets[0].cells.B2.v === 1500 (computed by the engine)

const result = applyOperations(
  registry,
  { kind: 'sheet', content, title: 'Estimativa', themeId: 'default', locale: 'pt-BR' },
  [
    { op: 'set_cells', sheet: 'estimativa', cells: { A3: { v: 20 } } },
    { op: 'fill_range', sheet: 'estimativa', source: 'B2', target: 'B2:B3' },
  ],
);
```

React:

```tsx
import { SheetRenderer, sheetCss } from '@artkit/kind-sheet/react';
import { SheetEditor, sheetEditorCss } from '@artkit/kind-sheet/edit';

<style>{sheetEditorCss}</style>
<SheetEditor content={content} ctx={{ theme, locale: 'pt-BR', mode: 'screen' }} emit={(ops, opts) => apply(ops, opts)} readOnly={false} lint={lint} />
```

## Subpaths

| Subpath   | Contents                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`       | `sheetKind`, `createSheetKind({ formulaEngine?, locale? })`, schemas and types, operations, projection, lint, diff, inputs (`table`, `csv`), the formula engine (`createFormulaEngine`, `recalculateAll`, `previewFormula`, tokenizer/parser, reference rewriting), display helpers (`formatCellValue`, `xlsxNumberFormat`). Depends only on `@artkit/core` and `zod`; runs in browsers, Node, edge and workers. |
| `/react`  | `SheetRenderer`, `sheetCss`, the virtualized `SheetGrid` and layout helpers.                                                                                                                                                                                                                                                                                                                                     |
| `/edit`   | `SheetEditor`, `sheetEditorCss`, and the pure editor logic (selection model, keys, clipboard, typed input, formula editing, operation builders).                                                                                                                                                                                                                                                                 |
| `/export` | `sheetExporters` (`xlsx` via exceljs, `csv`, `html`).                                                                                                                                                                                                                                                                                                                                                            |

## Model

A workbook is `{ sheets, names?, settings? }`.

- **Sheet**: `id`, `name` (≤ 31 chars, none of `\ / ? * [ ] :`), `cells` keyed by A1 address, `columns` (`{ C: { width } }`, 4–80 characters), `rows` (`{ "3": { height } }`, points), `frozen` (`{ rows, cols }`), `merges` (`["A1:D1"]`), `validations` (`[{ range, values, allowBlank? }]`), `hidden`.
- **Cell**: `v` (literal or cached result; errors are `{ "error": "#DIV/0!" }`), `f` (formula **without** the leading `=`; a leading `=` is accepted and removed), `fmt` (`general`, `integer`, `decimal2`, `percent`, `currency`, `date`, `datetime`, `text`), `s` (`bold`, `italic`, `color`, `background` as theme token or hex, `align`, `valign`, `wrap`, `border`), `note`.
- **Dates** are Excel serial numbers (1900 system, including the 1900 leap-year quirk) with a date format. ISO strings written in `v` (`"2026-11-09"`) are converted.
- **Names**: `[{ name, ref }]`, `ref` always with the sheet (`Parametros!$B$2`), stored absolute.
- **Settings**: `calculationDate` (`YYYY-MM-DD`, read by `TODAY()`), `currency` (ISO 4217; default: currency of the locale).
- Limits (§6.6): 20 sheets, 50,000 filled cells, 16,384 columns, 100,000 rows.

## Operations

`set_cells` (patches merge into cells, `null` removes; text starting with `=` becomes a formula), `set_range_style`, `set_range_format`, `clear_range`, `insert_rows`, `delete_rows`, `insert_columns`, `delete_columns` (cells, merges, validations, sizes, frozen panes, names and every formula in every sheet are rewritten; references to deleted cells become `#REF!`), `add_sheet`, `rename_sheet` (rewrites references), `remove_sheet` (references become `#REF!`), `move_sheet`, `set_sheet_hidden`, `merge_cells`, `unmerge_cells`, `set_column_width`, `set_row_height`, `set_frozen`, `set_name`, `remove_name` (refused while formulas use the name), `set_validation`, `fill_range` (copies a model cell/block adjusting relative references), `set_settings`.

Sheets are referenced by id in operations and by name in formulas. Rebase targets are `cell:<sheetId>!A1`, `sheet:<id>`, `layout:<id>`, `name:<NAME>` and `settings`.

## Formulas

Own engine (tokenizer, Pratt parser, evaluator, dependency graph with topological recalculation), identical in the browser and on the server. Syntax: numbers, strings, booleans, error literals, A1 references with `$`, ranges, whole columns/rows (`C:C`, `2:2`), cross-sheet references (`'Estimativa 2'!A1`), defined names, `+ - * / ^ & = <> < > <= >=`, postfix `%`, unary minus (Excel precedence: `-2^2 = 4`), function calls (`,` or `;` separators).

Supported functions:

- Math: `SUM SUMIF SUMIFS AVERAGE MIN MAX COUNT COUNTA COUNTIF COUNTIFS ROUND ROUNDUP ROUNDDOWN`
- Logical: `IF IFS AND OR NOT IFERROR`
- Lookup: `VLOOKUP XLOOKUP INDEX MATCH`
- Text: `CONCAT TEXT LEFT RIGHT LEN UPPER LOWER TRIM`
- Date: `DATE TODAY EDATE EOMONTH NETWORKDAYS WEEKDAY`

Criteria strings (`">10"`, `"<>x"`, wildcards `* ? ~`), error propagation (`#REF! #DIV/0! #NAME? #VALUE! #N/A #NUM!`) and type coercion follow Excel. Anything else is rejected at validation with a hint listing similar functions; `WEBSERVICE`, `HYPERLINK`, `INDIRECT`, `OFFSET`, macro functions and similar are prohibited. Circular references are an `INVALID_CONTENT` error with the cell path. The pipeline's `derive` step recalculates every formula and caches `v`, so the agent never computes values.

## Projection, lint, diff

```
Settings: currency BRL
Sheet "Resumo" (id: resumo) A1:D4
A1 "Perfil" | B1 "Horas" | C1 "Valor hora" | D1 "Total"
A2 "Tech Lead" | B2 =SUMIF('Estimativa 2'!A:A,A2,'Estimativa 2'!B:B) → 120 | C2 165 [currency] | D2 =B2*C2 → 19800 [currency]
```

Modes `outline` (sheets, used ranges, counts, names), `full` and `range` (`"Resumo!A1:D20"`, a sheet id or name), cut at row boundaries with a cursor. Labels follow the locale (`Aba`/`Sheet`).

Lint: formula referencing an empty cell, number stored as text, column too narrow (estimate), total-like label with a literal number, `TODAY()` without calculation date, formula errors, values outside a validation list. Diff summaries format values by locale (`"R$ 159.810,00 para R$ 162.910,00."`); bulk changes (more than 50 edited cells in a sheet) are summarized per sheet.

## Inputs

- `table`: `{ name?, header, rows }`; text is typed by locale (`"1.234,56"`, `"15%"`, `"R$ 10"`, dates, `TRUE`/`VERDADEIRO`, `"=…"` formulas); a column whose values share a format gets it; header bold and frozen.
- `csv`: RFC 4180 text (string or `{ text, delimiter?, name?, header? }`), delimiter detection for `,` `;` and tab.

## Renderer and editor

`SheetRenderer`: virtualized grid (rows and columns windowing), sheet tabs, merges, wrap, Intl formats by locale (currency of the locale), frozen panes, formula bar with colored reference outlines on selection, table semantics (`role="grid"`, row/column headers, `aria-rowcount`), print mode with plain `<table>`s for headless PDF.

`SheetEditor` (controlled, emits operations only): typing and formula bar, `=` starts a formula, autocomplete limited to supported functions with signature and description, colored reference highlighting, range selection with the mouse while editing a formula, live formula result preview, error explanation for the active cell, multi-range selection (Shift/Ctrl/Cmd), headers select rows/columns, keyboard navigation (arrows, Tab, Enter, Ctrl+arrows, Shift to extend, Home, PageUp/Down, F2, Delete, Escape, Ctrl+A/B/I), copy/cut/paste (TSV, HTML tables, internal payload with relative-reference shifting), fill handle → `fill_range`, toolbar (formats, bold, italic, text/fill color by theme token, alignment, wrap, borders, merge/unmerge, insert/delete rows and columns, freeze panes, named ranges dialog), column/row resize by dragging, sheet tabs (add, rename, reorder by drag or Alt+Shift+arrows, hide/unhide, delete with confirmation), dropdowns for validated cells, lint markers in cells. Typing emits `{ kind: 'typing' }`; drags emit one `{ kind: 'continuous' }` operation at the end.

## Exporters

| Format | Supported                                                                                                                                                                                                                                  | Not supported / degraded                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| xlsx   | formulas with cached results, number formats (currency of the locale), fonts, fills, alignment, wrap, borders, merges, frozen panes, column widths, row heights, defined names, list validations, notes, hidden sheets, `fullCalcOnLoad`   | list values with commas/quotes or longer than 255 chars (warning), names whose ref is `#REF!` (warning) |
| csv    | one sheet (`options.sheet`: id or name, default first visible), `options.delimiter` (`,` `;` tab), `options.bom`; invariant numbers, ISO dates, formula-injection protection (text starting with `= + - @` tab or CR is prefixed with `'`) | other sheets (warning)                                                                                  |
| html   | static document, one table per visible sheet, merges as spans, locale formats, inline styles                                                                                                                                               | hidden sheets (warning)                                                                                 |

PDF/PNG come from headless rendering of `SheetRenderer` in `@artkit/node`.

## Deviations and limitations

- The formula engine is a dependency-free implementation of the spec subset (spec §27 left IronCalc vs fast-formula-parser open).
- The editor uses its own DOM virtualized grid instead of Glide Data Grid, whose peer range excludes React 19.
- `TODAY()` reads `settings.calculationDate` because `apply` must not read the clock; without it the result is `#N/A` plus a lint warning.
- Rebase targets use sheet ids (`cell:<sheetId>!A1`): `targets(op)` receives no content, so it cannot map ids to names.
- `validate` and `diff` messages use the locale given to `createSheetKind` (the core does not pass one).
- No array formulas or spilling, no constant arrays, no implicit intersection (a multi-cell range where one value is expected is `#VALUE!`); `XLOOKUP` returns one cell (one-column/one-row `return_array`).
- `TEXT` format codes use the invariant convention of xlsx files (`.` decimal, `,` thousands) and English month/day names.
- Arithmetic results are normalized to 15 significant digits (so `0.1+0.2=0.3` is `TRUE`).
- `merge_cells` refuses to hide content (the editor clears the other cells first); validations are not enforced on write (lint warns).
- `WORKDAY` is not in the subset: schedules can count working days with `NETWORKDAYS` but cannot derive end dates from durations.
- Recalculation is full on every batch (about 250 ms for 20,000 formulas in Node); incremental recalculation is available through `FormulaEngine.recalculate(content, changed)`.

License: Apache-2.0.
