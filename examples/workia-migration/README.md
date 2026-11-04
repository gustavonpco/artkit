# Workia → artkit migration

Converts the four artifact types of the Workia workspace (`documento`, `planilha`, `deck`, `cronograma`) into artkit artifacts and imports them through the artkit pipeline (validated creation, then a versioned follow-up batch). It is the starting point for replacing Workia's artifact system with artkit; it is not published.

```ts
import { createArtifactService, createMemoryStore } from '@artkit/core';
import { createWorkiaRegistry, importWorkiaArtifact } from './src/index.ts';

const service = createArtifactService({
  registry: createWorkiaRegistry(),
  store: createMemoryStore(),
  locale: 'pt-BR',
});
const result = await importWorkiaArtifact(service, scope, workiaJson, {
  assets: { in_arquitetura: 'asset://3fa9…' },
});
```

## Mapping

| Workia                                                               | artkit                                                         | How                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `documento` front matter (`titulo`, `subtitulo`, `campos`)           | `document.cover`                                               | title, subtitle, fields                                                                           |
| `documento` body (Markdown)                                          | `document.blocks`                                              | the kind's `markdown` input; tables, lists, quotes, code, dividers and links convert without loss |
| `{{campo:x}}`, `{{ref:x\|moeda}}` placeholders                       | literal text                                                   | resolving them is the application's job (it owns the referenced data)                             |
| `planilha.parametros`                                                | `Parametros` sheet + named ranges (`valor_hora`)               | formulas use the names                                                                            |
| computed columns (`horas * param(valor_hora)`)                       | one model formula + `fill_range`                               | recalculated by the sheet engine                                                                  |
| `totais` `soma` / `agruparPor` / `formula`                           | `SUM`, bounded `SUMIF`, plain formula                          | cached values written by the engine                                                               |
| `deck` layouts (`capa`, `indicadores`, `etapas`, `lista-cartoes`, …) | layouts registered with `createSlidesKind({ layouts })`        | `workiaLayouts`; blocks become `stats`, `steps`, `cards`, `text` slots                            |
| deck images (`inputId`)                                              | `asset://` references                                          | upload the inputs first and pass `{ inputId: assetRef }`                                          |
| `cronograma`                                                         | `sheet` with a `Calendario` sheet and a `feriados` named range | dates from a forward pass over working days; `NETWORKDAYS` column checks durations                |

## Known gaps

- **Cronograma dates are values, not formulas.** The sheet formula subset (spec §11.2) has no `WORKDAY`, so moving a task does not cascade to its successors. A dedicated `timeline` kind (spec §24, phase 3) is the proper home for schedules with dependencies.
- **Placeholders are not resolved.** Cross-artifact references (`{{ref:estimativa.totais.total}}`) map naturally to the artifact links planned for phase 3; until then the application resolves them before or after import.
- **Workia-specific layouts** are registered by the application. Keep `workiaLayouts` in the consuming project if the visual identity changes.

`pnpm vitest run examples/workia-migration` runs the end-to-end tests with the fictitious "Acme" fixtures copied from Workia (`fixtures/`).
