#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { reportToMarkdown } from './report.js';
import { runEvals } from './runner.js';
import type { EvalConfig } from './types.js';

const USAGE = `Usage: artkit-evals --config <file.mjs> [--out <dir>] [--only id,id] [--repeat n] [--concurrency n]

The config module default-exports an EvalConfig: { models: [{ name, model }], profiles?, skill?, ... }.
Models come from AI SDK providers created in the config (that file may read your API keys).`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      out: { type: 'string', default: 'evals-report' },
      only: { type: 'string' },
      repeat: { type: 'string' },
      concurrency: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.config) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const loaded = (await import(pathToFileURL(resolve(values.config)).href)) as { default?: EvalConfig };
  if (!loaded.default || !Array.isArray(loaded.default.models) || loaded.default.models.length === 0) {
    console.error('The config module must default-export an EvalConfig with at least one model.');
    return 1;
  }
  const config: EvalConfig = {
    ...loaded.default,
    ...(values.only ? { only: values.only.split(',').map((id) => id.trim()) } : {}),
    ...(values.repeat ? { repeat: Number(values.repeat) } : {}),
    ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
    onRun(run) {
      const status = run.check.passed ? 'pass' : 'fail';
      console.log(
        `${status}  ${run.taskId}  ${run.model}  ${run.profile}  ${run.skill ? 'skill' : 'no-skill'}`,
      );
      loaded.default?.onRun?.(run);
    },
  };
  const report = await runEvals(config);
  const outDir = resolve(values.out ?? 'evals-report');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(outDir, 'report.md'), reportToMarkdown(report));
  console.log(`\n${report.passed ? 'Exit criteria passed' : 'Exit criteria FAILED'} — report in ${outDir}`);
  return report.passed ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
