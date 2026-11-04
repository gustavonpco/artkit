import { describe, expect, it } from 'vitest';
import {
  buildReport,
  createScriptedModel,
  defaultTasks,
  lastArtifactId,
  mentionsNumber,
  reportToMarkdown,
  runEvals,
  runReference,
  runTask,
} from '../src/index.js';

describe('built-in tasks', () => {
  const tasks = defaultTasks();

  it('cover every category and kind of spec §21.2', () => {
    expect(new Set(tasks.map((t) => t.category))).toEqual(
      new Set(['create', 'edit', 'fix', 'restructure', 'large', 'cross']),
    );
    expect(new Set(tasks.flatMap((t) => t.kinds))).toEqual(
      new Set(['document', 'sheet', 'slides', 'diagram']),
    );
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
  });

  for (const task of tasks) {
    it(`reference solution satisfies "${task.id}"`, async () => {
      const run = await runReference(task);
      expect(run.check.failures).toEqual([]);
      expect(run.check.passed).toBe(true);
      expect(run.successWithinTwo).toBe(true);
    });
  }

  it('the conflict task really forces a VERSION_CONFLICT on the first apply', async () => {
    const run = await runReference(tasks.find((t) => t.id === 'diagram-fix-after-conflict')!);
    const applies = run.calls.filter((c) => c.name === 'artifact_apply');
    expect(applies[0]).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(applies[1]?.ok).toBe(true);
    expect(run.corrections).toBe(1);
  });

  it('checks fail on wrong answers', async () => {
    const task = tasks.find((t) => t.id === 'slides-restructure')!;
    const wrong = { ...task, reference: async () => {} };
    const run = await runReference(wrong);
    expect(run.check.passed).toBe(false);
    expect(run.check.score).toBeLessThan(1);
  });
});

describe('runner with a scripted model', () => {
  it('measures a full ToolLoopAgent run end to end', async () => {
    const task = defaultTasks().find((t) => t.id === 'document-edit-point')!;
    const model = createScriptedModel([
      (prompt) => ({
        toolCalls: [{ name: 'artifact_read', input: { id: lastArtifactId(prompt), mode: 'full' } }],
      }),
      // Wrong first attempt (missing anchor) to exercise correction counting.
      (prompt) => ({
        toolCalls: [
          {
            name: 'artifact_apply',
            input: {
              id: lastArtifactId(prompt),
              baseVersion: 1,
              operations: [{ op: 'replace_text', id: 'prazo', find: '99 semanas', replace: 'x' }],
            },
          },
        ],
      }),
      (prompt) => ({
        toolCalls: [
          {
            name: 'artifact_apply',
            input: {
              id: lastArtifactId(prompt),
              baseVersion: 1,
              operations: [
                { op: 'replace_text', id: 'prazo', find: '16 semanas', replace: '18 semanas' },
                {
                  op: 'insert_block',
                  after: 'prazo',
                  block: { type: 'paragraph', runs: [{ text: 'Inclui operação assistida de 4 semanas.' }] },
                },
              ],
            },
          },
        ],
      }),
      () => ({ text: 'Done.' }),
    ]);
    const run = await runTask({
      task,
      model: { name: 'scripted', model },
      profile: 'default',
      skill: false,
      repetition: 0,
    });
    expect(run.error).toBeUndefined();
    expect(run.check.passed).toBe(true);
    expect(run).toMatchObject({
      validFirstTry: false,
      corrections: 1,
      successWithinTwo: true,
      operations: 2,
      toolCalls: 3,
    });
    expect(run.inputTokens).toBeGreaterThan(0);
  });

  it('runs the matrix and builds a report with skill gain and exit criteria', async () => {
    const task = defaultTasks().find((t) => t.id === 'sheet-create-estimate')!;
    const report = await runEvals({
      tasks: [task],
      models: [
        {
          name: 'scripted',
          // A fresh script per run: the model always gives up immediately.
          get model() {
            return createScriptedModel([() => ({ text: 'I cannot do that.' })]);
          },
        },
      ],
      profiles: ['default', 'strict'],
      skill: [true, false],
    });
    expect(report.runs).toHaveLength(4);
    expect(report.rows.map((r) => r.key).sort()).toEqual([
      'sheet|scripted|default|no-skill',
      'sheet|scripted|default|skill',
      'sheet|scripted|strict|no-skill',
      'sheet|scripted|strict|skill',
    ]);
    expect(report.criteria).toEqual([{ kind: 'sheet', model: 'scripted', successRate: 0, passed: false }]);
    expect(report.passed).toBe(false);
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain('| sheet | scripted | default | yes | 1 |');
    expect(markdown).toContain('## Failed runs');
  });

  it('aggregates multi-kind tasks into each kind', () => {
    const report = buildReport(
      [
        {
          taskId: 'x',
          category: 'cross',
          kinds: ['sheet', 'document'],
          model: 'm',
          profile: 'default',
          skill: true,
          repetition: 0,
          check: { passed: true, score: 1, failures: [] },
          validFirstTry: true,
          corrections: 0,
          successWithinTwo: true,
          operations: 2,
          toolCalls: 2,
          inputTokens: 10,
          outputTokens: 5,
          lintWarnings: 0,
          durationMs: 1,
          calls: [],
        },
      ],
      { startedAt: 'now', threshold: 0.9 },
    );
    expect(report.criteria.map((c) => c.kind).sort()).toEqual(['document', 'sheet']);
    expect(report.passed).toBe(true);
  });
});

describe('number mentions', () => {
  it('accepts common number formats', () => {
    for (const text of ['R$ 19.800,00', '19,800', 'total 19800', '19 800'])
      expect(mentionsNumber(text, 19800), text).toBe(true);
    expect(mentionsNumber('198000', 19800)).toBe(false);
  });
});
