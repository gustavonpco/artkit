# Sheet (`sheet`)

Schema version 1. Edit with `artifact_apply`.

## Summary

Spreadsheet workbook: sheets with cells keyed by A1 address, Excel-style formulas recalculated by the engine, named formats and styles, merges, frozen panes, named ranges and dropdown validations. Use it for estimates, budgets, simple schedules, trackers and calculated tables.

## When to use

Calculations, totals, estimates, budgets and any tabular data that needs formulas.

## Rules

- Operations reference sheets by id ("sheet": "estimativa"); formulas reference sheets by name (Estimativa!C2, 'My sheet'!A1:A9).
- A cell is {v, f, fmt, s, note}. Write formulas in "f" without "=" (a leading "=" is accepted); never write "v" for formula cells: the engine computes and caches it.
- Supported functions only: SUM, SUMIF, SUMIFS, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTIF, COUNTIFS, ROUND, ROUNDUP, ROUNDDOWN; IF, IFS, AND, OR, NOT, IFERROR; VLOOKUP, XLOOKUP, INDEX, MATCH; CONCAT, TEXT, LEFT, RIGHT, LEN, UPPER, LOWER, TRIM; DATE, TODAY, EDATE, EOMONTH, NETWORKDAYS, WEEKDAY. Anything else (SUMPRODUCT, INDIRECT, WEBSERVICE, macros) is rejected.
- Operators: + - * / ^ & = <> < > <= >= and postfix %. Criteria strings like ">10", "<>x", "a*" work in SUMIF/SUMIFS/COUNTIF/COUNTIFS. Whole columns (C:C) and rows (2:2) are allowed.
- Formats (fmt): general, integer, decimal2, percent (0.2 shows 20%), currency (currency of the locale or settings.currency), date, datetime, text. Write dates as ISO strings ("2026-11-09"): they are stored as date serials with fmt date.
- Put parameters (rates, margins) in cells and give them names with set_name; use the name in formulas (C2*valor_hora).
- Write one model formula and copy it with fill_range {source: "D2", target: "D2:D40"}: relative references shift per row, $A$1 stays fixed. This is much shorter than one set_cells entry per row.
- Totals must be formulas (SUM, SUMIF for totals by group), never typed numbers. Lint warns on literal totals, numbers stored as text, references to empty cells and narrow columns.
- TODAY() returns settings.calculationDate (set it with set_settings); without it TODAY() is #N/A, because formulas never read the clock.
- insert_rows/delete_rows/insert_columns/delete_columns and rename_sheet rewrite every affected formula; references to deleted cells become #REF!.
- Like Excel, inserting rows inside a referenced range expands it (SUM(C2:C3) + insert at 3 → SUM(C2:C4)), but inserting right below its last row does not: insert above the last data row, or update the totals in the same batch.
- Read large workbooks with mode "outline" first, then "range" like "Estimativa!A1:F40". Circular references and unknown sheets or names are rejected with the cell path.

## Content fields

- `sheets` (array of object (items ≥ 1), required)
  - `id` (string, required): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
  - `name` (string, required)
  - `cells` (object): Cells keyed by A1 address.
  - `columns` (object): Column widths keyed by letter.
  - `rows` (object): Row heights keyed by 1-based row number.
  - `frozen` (object)
    - `rows` (integer 0–1000)
    - `cols` (integer 0–100)
  - `merges` (array of string (length 5–32)): Merged ranges like "A1:D1".
  - `validations` (array of object)
    - `range` (string (length 2–32), required): A1 range on this sheet, e.g. "C2:C50".
    - `values` (array of string (length 1–255) | number (items 1–500), required): Allowed values (dropdown list).
    - `allowBlank` (boolean)
  - `hidden` (boolean)
- `names` (array of object)
  - `name` (string (length 1–255), required): Workbook name usable in formulas, e.g. "valor_hora".
  - `ref` (string (length 2–300), required): Reference with sheet name, e.g. "Parametros!$B$2" or "'Estimativa 2'!A1:A20".
- `settings` (object)
  - `calculationDate` (string): Date returned by TODAY(). Formulas never read the clock.
  - `currency` (string): Currency for the "currency" format. Defaults to the currency of the locale.

## Alternative inputs

Pass `input: { format, source }` to `artifact_create` instead of `content`.

- `table`: One sheet from {"header": [...], "rows": [[...]]}. Text values are typed by locale (numbers, "15%", "R$ 10", dates, TRUE/FALSE); "=..." is a formula. Header is bold and frozen.
- `csv`: One sheet from CSV text (RFC 4180; delimiter "," ";" or tab detected). Pass a string or {"text", "delimiter"?, "name"?, "header"?}.

## Operations

### `set_cells`

Sets values, formulas, formats, styles and notes of many cells.

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `cells` (object, required): Cells keyed by A1 address. A patch merges into the cell; null removes the whole cell.

### `set_range_style`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): A1 range on the sheet, e.g. "B2:D9" (a single cell like "B2" is fine).
- `style` (object, required): Style properties to set; null removes a property.
  - `bold` (boolean | null)
  - `italic` (boolean | null)
  - `underline` (boolean | null)
  - `strike` (boolean | null)
  - `fontSize` (integer 6–48 | null)
  - `color` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `background` ("text" | "muted" | "accent" | "background" | "surface" | "info" | "warning" | "success" | "danger" | string | null)
  - `align` ("left" | "center" | "right" | null)
  - `valign` ("top" | "middle" | "bottom" | null)
  - `wrap` (boolean | null)
  - `border` (object | null)

### `set_range_format`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): A1 range on the sheet, e.g. "B2:D9" (a single cell like "B2" is fine).
- `fmt` ("general" | "integer" | "decimal2" | "percent" | "currency" | "date" | "datetime" | "text" | null, required)

### `sort_range`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): Rows to sort, e.g. "A2:D20" (include every column of the rows).
- `by` (array of object (items 1–3), required): Sort keys in priority order.
  - `column` (string, required)
  - `descending` (boolean)
- `header` (boolean): The first row of the range is a header and stays in place.

### `clear_range`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): A1 range on the sheet, e.g. "B2:D9" (a single cell like "B2" is fine).
- `what` ("contents" | "formats" | "all"): contents: values and formulas; formats: fmt and style; all.

### `insert_rows`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `at` (integer 1–100000, required): 1-based row where the new rows start; that row and below move down.
- `count` (integer 1–10000)

### `delete_rows`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `at` (integer 1–100000, required): First 1-based row to delete.
- `count` (integer 1–100000)

### `insert_columns`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `at` (string, required): Column letter where the new columns start; it and the following move right.
- `count` (integer 1–1000)

### `delete_columns`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `at` (string, required): First column letter to delete.
- `count` (integer 1–16384)

### `add_sheet`

- `id` (string): Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").
- `name` (string, required)
- `position` (integer 1–9007199254740991): 1-based tab position (default: last).
- `cells` (object)
- `columns` (object)
- `rows` (object)
- `frozen` (object)
  - `rows` (integer 0–1000)
  - `cols` (integer 0–100)
- `merges` (array of string (length 2–32))
- `validations` (array of object)
  - `range` (string (length 2–32), required): A1 range on this sheet, e.g. "C2:C50".
  - `values` (array of string (length 1–255) | number (items 1–500), required): Allowed values (dropdown list).
  - `allowBlank` (boolean)
- `hidden` (boolean)

### `rename_sheet`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `name` (string, required)

### `remove_sheet`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").

### `move_sheet`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `position` (integer 1–9007199254740991, required): 1-based tab position.

### `set_sheet_hidden`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `hidden` (boolean, required)

### `merge_cells`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): A1 range on the sheet, e.g. "B2:D9" (a single cell like "B2" is fine).

### `unmerge_cells`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): Every merge intersecting this range is removed.

### `set_column_width`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `column` (string, required)
- `count` (integer 1–1000)
- `width` (number 4–80 | null, required): Width in characters (4–80); null restores the default.

### `set_row_height`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `row` (integer 1–100000, required)
- `count` (integer 1–10000)
- `height` (number 6–409 | null, required): Height in points (6–409); null restores the default.

### `set_frozen`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `rows` (integer 0–1000, required): Rows frozen at the top (0 for none).
- `cols` (integer 0–100, required): Columns frozen at the left (0 for none).

### `set_name`

- `name` (string (length 1–255), required)
- `ref` (string (length 2–300), required): Reference with the sheet name, e.g. "Parametros!B2" (stored absolute).

### `remove_name`

- `name` (string (length 1–255), required)

### `set_validation`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `range` (string (length 2–32), required): A1 range on the sheet, e.g. "B2:D9" (a single cell like "B2" is fine).
- `values` (array of string (length 1–255) | number (items 1–500) | null, required): Allowed values (dropdown); null removes validation from the range.
- `allowBlank` (boolean)

### `fill_range`

- `sheet` (string, required): Sheet id (from the projection header "(id: …)").
- `source` (string (length 2–32), required): Model cell or block, e.g. "D2".
- `target` (string (length 2–32), required): Range to fill, e.g. "D2:D40". Relative references shift per row/column; $ keeps them.

### `set_settings`

- `calculationDate` (string | null): Date returned by TODAY() (YYYY-MM-DD); null unsets it.
- `currency` (string | null): ISO 4217 code for the currency format; null uses the locale currency.

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
| `sheets` | 20 |
| `cells` | 50000 |
| `columns` | 16384 |
| `rows` | 100000 |
| operations per call | 200 |
| serialized artifact | 5120 KB |

## Examples

### Estimate with parameters, computed column and totals

Content:

```json
{
  "sheets": [
    {
      "id": "parametros",
      "name": "Parametros",
      "cells": {
        "A1": {
          "v": "Valor hora",
          "s": {
            "bold": true
          }
        },
        "B1": {
          "v": 150,
          "fmt": "currency"
        },
        "A2": {
          "v": "Margem",
          "s": {
            "bold": true
          }
        },
        "B2": {
          "v": 0.2,
          "fmt": "percent"
        }
      }
    },
    {
      "id": "estimativa",
      "name": "Estimativa",
      "frozen": {
        "rows": 1,
        "cols": 0
      },
      "columns": {
        "A": {
          "width": 24
        }
      },
      "cells": {
        "A1": {
          "v": "Atividade",
          "s": {
            "bold": true
          }
        },
        "B1": {
          "v": "Grupo",
          "s": {
            "bold": true
          }
        },
        "C1": {
          "v": "Horas",
          "s": {
            "bold": true
          }
        },
        "D1": {
          "v": "Subtotal",
          "s": {
            "bold": true
          }
        },
        "A2": {
          "v": "Login"
        },
        "B2": {
          "v": "Construção"
        },
        "C2": {
          "v": 10
        },
        "D2": {
          "f": "C2*valor_hora",
          "fmt": "currency"
        },
        "A3": {
          "v": "Relatórios"
        },
        "B3": {
          "v": "Construção"
        },
        "C3": {
          "v": 20.5
        },
        "D3": {
          "f": "C3*valor_hora",
          "fmt": "currency"
        },
        "A4": {
          "v": "Total",
          "s": {
            "bold": true
          }
        },
        "C4": {
          "f": "SUM(C2:C3)"
        },
        "D4": {
          "f": "SUM(D2:D3)",
          "fmt": "currency",
          "s": {
            "bold": true
          }
        }
      }
    }
  ],
  "names": [
    {
      "name": "valor_hora",
      "ref": "Parametros!$B$1"
    },
    {
      "name": "margem",
      "ref": "Parametros!$B$2"
    }
  ]
}
```

### Add rows, fill a computed column and total by group

Content:

```json
{
  "sheets": [
    {
      "id": "parametros",
      "name": "Parametros",
      "cells": {
        "A1": {
          "v": "Valor hora",
          "s": {
            "bold": true
          }
        },
        "B1": {
          "v": 150,
          "fmt": "currency"
        },
        "A2": {
          "v": "Margem",
          "s": {
            "bold": true
          }
        },
        "B2": {
          "v": 0.2,
          "fmt": "percent"
        }
      }
    },
    {
      "id": "estimativa",
      "name": "Estimativa",
      "frozen": {
        "rows": 1,
        "cols": 0
      },
      "columns": {
        "A": {
          "width": 24
        }
      },
      "cells": {
        "A1": {
          "v": "Atividade",
          "s": {
            "bold": true
          }
        },
        "B1": {
          "v": "Grupo",
          "s": {
            "bold": true
          }
        },
        "C1": {
          "v": "Horas",
          "s": {
            "bold": true
          }
        },
        "D1": {
          "v": "Subtotal",
          "s": {
            "bold": true
          }
        },
        "A2": {
          "v": "Login"
        },
        "B2": {
          "v": "Construção"
        },
        "C2": {
          "v": 10
        },
        "D2": {
          "f": "C2*valor_hora",
          "fmt": "currency"
        },
        "A3": {
          "v": "Relatórios"
        },
        "B3": {
          "v": "Construção"
        },
        "C3": {
          "v": 20.5
        },
        "D3": {
          "f": "C3*valor_hora",
          "fmt": "currency"
        },
        "A4": {
          "v": "Total",
          "s": {
            "bold": true
          }
        },
        "C4": {
          "f": "SUM(C2:C3)"
        },
        "D4": {
          "f": "SUM(D2:D3)",
          "fmt": "currency",
          "s": {
            "bold": true
          }
        }
      }
    }
  ],
  "names": [
    {
      "name": "valor_hora",
      "ref": "Parametros!$B$1"
    },
    {
      "name": "margem",
      "ref": "Parametros!$B$2"
    }
  ]
}
```

Operations:

```json
[
  {
    "op": "insert_rows",
    "sheet": "estimativa",
    "at": 3,
    "count": 1
  },
  {
    "op": "set_cells",
    "sheet": "estimativa",
    "cells": {
      "A3": {
        "v": "Treinamento"
      },
      "B3": {
        "v": "Implantação"
      },
      "C3": {
        "v": 8
      }
    }
  },
  {
    "op": "fill_range",
    "sheet": "estimativa",
    "source": "D2",
    "target": "D3"
  },
  {
    "op": "set_cells",
    "sheet": "estimativa",
    "cells": {
      "F1": {
        "v": "Grupo",
        "s": {
          "bold": true
        }
      },
      "G1": {
        "v": "Subtotal",
        "s": {
          "bold": true
        }
      },
      "F2": {
        "v": "Construção"
      },
      "G2": {
        "f": "SUMIF(B:B,F2,D:D)",
        "fmt": "currency"
      },
      "F3": {
        "v": "Implantação"
      },
      "G3": {
        "f": "SUMIF(B:B,F3,D:D)",
        "fmt": "currency"
      },
      "F4": {
        "v": "Total com margem"
      },
      "G4": {
        "f": "D5*(1+margem)",
        "fmt": "currency"
      }
    }
  },
  {
    "op": "set_column_width",
    "sheet": "estimativa",
    "column": "F",
    "width": 18
  }
]
```

### Create a sheet with a dropdown and a dated schedule

Operations:

```json
[
  {
    "op": "add_sheet",
    "name": "Cronograma",
    "cells": {
      "A1": {
        "v": "Tarefa",
        "s": {
          "bold": true
        }
      },
      "B1": {
        "v": "Início",
        "s": {
          "bold": true
        }
      },
      "C1": {
        "v": "Fim",
        "s": {
          "bold": true
        }
      },
      "D1": {
        "v": "Dias úteis",
        "s": {
          "bold": true
        }
      },
      "E1": {
        "v": "Status",
        "s": {
          "bold": true
        }
      },
      "A2": {
        "v": "Descoberta"
      },
      "B2": {
        "v": "2026-11-02"
      },
      "C2": {
        "v": "2026-11-06"
      },
      "D2": {
        "f": "NETWORKDAYS(B2,C2)"
      },
      "E2": {
        "v": "Em andamento"
      }
    },
    "frozen": {
      "rows": 1,
      "cols": 0
    }
  },
  {
    "op": "set_validation",
    "sheet": "cronograma",
    "range": "E2:E50",
    "values": [
      "A fazer",
      "Em andamento",
      "Concluído"
    ]
  },
  {
    "op": "set_settings",
    "calculationDate": "2026-11-04"
  }
]
```

## Checklist

- [ ] Totals are always formulas, never typed numbers.
- [ ] Input values live apart from calculations; keep an assumptions sheet.
- [ ] Use named number formats (currency, percent, date) instead of formatted text.
- [ ] Use `fill_range` for series instead of one operation per cell.
- [ ] Numbers are stored as numbers, not as text.

## Anti-patterns

- Hard-coding a computed total that will go stale.
- Mixing units or currencies in one column.
- Formulas pointing at empty cells.
