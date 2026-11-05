# Planilha (`univer-sheet`)

Univer workbook for calculations, totals and comparisons. Read the outline, write inputs as values and totals as formulas, and check the computed values in the next read.

Version: `univer-sheet@1.3.1`

## Regras

- Address cells by sheet name and A1 address; read the outline before writing.
- Write totals as formulas (=SUM, =B2*C2) so they recalculate when inputs change.
- Keep inputs and assumptions in their own sheet and reference them from calculations.
- Do not use TODAY(), NOW(), RAND() or RANDBETWEEN(): store dates as fixed values in an assumptions sheet.
- Do not use functions with external effects (WEBSERVICE, IMPORTDATA, INDIRECT, OFFSET).
- Use set_format for money (currency), percentages and dates; never type a computed total as a number.

## Limites

- sheets: 20
- cells: 50000

## Exemplo: Estimate with a total

```json
[
  {
    "op": "add_sheet",
    "name": "Estimativa"
  },
  {
    "op": "set_values",
    "sheet": "Estimativa",
    "at": "A1",
    "values": [
      [
        "Perfil",
        "Horas",
        "Valor hora",
        "Total"
      ]
    ]
  },
  {
    "op": "set_values",
    "sheet": "Estimativa",
    "at": "A2",
    "values": [
      [
        "Tech Lead",
        120,
        165,
        "=B2*C2"
      ]
    ]
  },
  {
    "op": "set_format",
    "sheet": "Estimativa",
    "range": "D2",
    "format": "currency"
  }
]
```
