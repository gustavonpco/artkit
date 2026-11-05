import type { SchemaProfile } from '@artkit-ai/core';
import type { AggregateRow, EvalReport, RunResult } from './types.js';

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
const rate = (runs: RunResult[], pick: (run: RunResult) => boolean) =>
  mean(runs.map((run) => (pick(run) ? 1 : 0)));

/** Aggregates runs per format × model × profile × skill, computes the skill gain and the exit criteria. */
export function buildReport(
  runs: RunResult[],
  options: { startedAt: string; threshold: number },
): EvalReport {
  const groups = new Map<string, RunResult[]>();
  for (const run of runs) {
    for (const format of run.formats) {
      const key = `${format}|${run.model}|${run.profile}|${run.skill ? 'skill' : 'no-skill'}`;
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
  }
  const rows: AggregateRow[] = [...groups.entries()]
    .map(([key, group]) => {
      const [format, model, profile] = key.split('|') as [string, string, SchemaProfile];
      return {
        key,
        format,
        model,
        profile,
        skill: key.endsWith('|skill'),
        runs: group.length,
        validFirstTry: rate(group, (r) => r.validFirstTry),
        successWithinTwo: rate(group, (r) => r.successWithinTwo),
        meanScore: mean(group.map((r) => r.check.score)),
        meanOperations: mean(group.map((r) => r.operations)),
        meanInputTokens: mean(group.map((r) => r.inputTokens)),
        meanOutputTokens: mean(group.map((r) => r.outputTokens)),
        meanLintWarnings: mean(group.map((r) => r.lintWarnings)),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const skillGain: EvalReport['skillGain'] = [];
  for (const row of rows.filter((r) => r.skill)) {
    const without = rows.find(
      (r) => !r.skill && r.format === row.format && r.model === row.model && r.profile === row.profile,
    );
    if (without)
      skillGain.push({
        format: row.format,
        model: row.model,
        profile: row.profile,
        gain: row.successWithinTwo - without.successWithinTwo,
      });
  }

  const criteria: EvalReport['criteria'] = [];
  const pairs = new Set(rows.map((r) => `${r.format}|${r.model}`));
  for (const pair of pairs) {
    const [format, model] = pair.split('|') as [string, string];
    const relevant = runs.filter((r) => r.formats.includes(format) && r.model === model);
    const withSkill = relevant.filter((r) => r.skill);
    const successRate = rate(withSkill.length > 0 ? withSkill : relevant, (r) => r.successWithinTwo);
    criteria.push({ format, model, successRate, passed: successRate >= options.threshold });
  }

  return {
    startedAt: options.startedAt,
    finishedAt: new Date().toISOString(),
    runs,
    rows,
    skillGain,
    criteria: criteria.sort((a, b) => `${a.format}${a.model}`.localeCompare(`${b.format}${b.model}`)),
    passed: criteria.length > 0 && criteria.every((c) => c.passed),
  };
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const num = (value: number) => (value >= 100 ? Math.round(value).toString() : value.toFixed(1));

/** Markdown summary for the documentation site and release notes (spec §21.2). */
export function reportToMarkdown(report: EvalReport): string {
  const lines = [
    '# artkit evals',
    '',
    `Runs: ${report.runs.length} · ${report.startedAt} → ${report.finishedAt} · exit criteria: ${report.passed ? 'passed' : 'FAILED'}`,
    '',
    '## Results per format',
    '',
    '| Format | Model | Profile | Skill | Runs | Valid 1st try | Success ≤2 corrections | Score | Ops | Tokens in | Tokens out | Lint |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.rows.map(
      (r) =>
        `| ${r.format} | ${r.model} | ${r.profile} | ${r.skill ? 'yes' : 'no'} | ${r.runs} | ${pct(r.validFirstTry)} | ${pct(r.successWithinTwo)} | ${pct(r.meanScore)} | ${num(r.meanOperations)} | ${num(r.meanInputTokens)} | ${num(r.meanOutputTokens)} | ${num(r.meanLintWarnings)} |`,
    ),
    '',
    '## Skill gain (success with skill minus without)',
    '',
    '| Format | Model | Profile | Gain |',
    '|---|---|---|---|',
    ...report.skillGain.map(
      (g) => `| ${g.format} | ${g.model} | ${g.profile} | ${g.gain >= 0 ? '+' : ''}${pct(g.gain)} |`,
    ),
    '',
    '## Exit criteria',
    '',
    '| Format | Model | Success rate | Passed |',
    '|---|---|---|---|',
    ...report.criteria.map(
      (c) => `| ${c.format} | ${c.model} | ${pct(c.successRate)} | ${c.passed ? 'yes' : 'no'} |`,
    ),
  ];
  const failures = report.runs.filter((r) => !r.check.passed);
  if (failures.length > 0) {
    lines.push('', '## Failed runs', '');
    for (const run of failures) {
      const why = run.error ? `error: ${run.error}` : run.check.failures.join('; ');
      lines.push(
        `- \`${run.taskId}\` · ${run.model} · ${run.profile} · ${run.skill ? 'skill' : 'no skill'}: ${why}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
