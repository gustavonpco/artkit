# @artkit-ai/evals

Evaluation suite that measures how easy the artkit standard is for models (spec §21.2). It runs built-in tasks per kind through a real AI SDK 7 `ToolLoopAgent` with the artkit tools and reports, per kind × model × schema profile × with/without the `artkit-artefatos` skill:

- valid artifact on the first try;
- success within two corrections (the release exit criterion, default 90%);
- operations per task, input/output tokens and lint warnings;
- the skill gain (success with the skill minus without it).

```bash
npm install -D @artkit-ai/evals ai @ai-sdk/anthropic @ai-sdk/openai
```

## Built-in tasks

| Id                            | Category                                     | Kinds           |
| ----------------------------- | -------------------------------------------- | --------------- |
| `document-create-proposal`    | create                                       | document        |
| `document-edit-point`         | edit                                         | document        |
| `document-large-paginated`    | large (paginated read of 480 blocks)         | document        |
| `sheet-create-estimate`       | create                                       | sheet           |
| `sheet-edit-insert-row`       | edit                                         | sheet           |
| `slides-create-deck`          | create                                       | slides          |
| `slides-restructure`          | restructure                                  | slides          |
| `diagram-create-architecture` | create                                       | diagram         |
| `diagram-fix-after-conflict`  | fix (a human edit forces `VERSION_CONFLICT`) | diagram         |
| `cross-estimate-proposal`     | cross (sheet and document must agree)        | sheet, document |

Every task has a deterministic `check` and a `reference` solution; the test suite proves each check is satisfiable and that wrong answers fail.

## Run

Create a config module (it may read your API keys; the packages never read environment variables):

```js
// evals.config.mjs
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

export default {
  models: [
    { name: 'anthropic/claude-sonnet-5-5', model: anthropic('claude-sonnet-5-5') },
    { name: 'openai/gpt-5', model: openai('gpt-5') },
  ],
  profiles: ['default', 'strict'],
  skill: [true, false],
  repeat: 3,
};
```

```bash
npx artkit-evals --config evals.config.mjs --out evals-report
```

It writes `evals-report/report.json` and `report.md` and exits with code 2 when the exit criteria fail.

## Programmatic use

```ts
import { defaultTasks, runEvals, reportToMarkdown } from '@artkit-ai/evals';

const report = await runEvals({
  models,
  tasks: [...defaultTasks(), myTask],
  only: ['sheet-create-estimate'],
});
console.log(reportToMarkdown(report));
```

Custom tasks implement `EvalTask` (`prompt`, optional `setup` and `afterToolCall` hooks, `check`, `reference`). `createScriptedModel` plays a fixed script without network access, for testing harnesses.

License: Apache-2.0.
