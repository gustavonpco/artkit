import { createArtifactToolkit, OVERVIEW_TOPIC } from '@artkit-ai/agent';
import {
  artifactContextSchema,
  artifactInstructions,
  artifactTools,
  artifactToolsContext,
} from '@artkit-ai/ai-sdk';
import {
  type Artifact,
  type ArtifactRegistry,
  createMemoryStore,
  createRegistry,
  type SchemaProfile,
  type Scope,
} from '@artkit-ai/core';
import { markdownFormat } from '@artkit-ai/format-markdown';
import { openuiFormat } from '@artkit-ai/format-openui';
import { sheetFormat } from '@artkit-ai/format-sheet/server';
import { isStepCount, ToolLoopAgent } from 'ai';
import { createToolCaller, instrumentToolkit, isMutation } from './instrument.js';
import { buildReport } from './report.js';
import { defaultTasks } from './tasks.js';
import type {
  EvalConfig,
  EvalReport,
  EvalTask,
  ModelEntry,
  RunResult,
  TaskContext,
  ToolCallRecord,
} from './types.js';

const AGENT: Scope['actor'] = { type: 'agent', id: 'eval-agent' };
const USER: Scope['actor'] = { type: 'user', id: 'eval-user' };

export function evalRegistry(): ArtifactRegistry {
  return createRegistry({ formats: [markdownFormat, sheetFormat, openuiFormat] });
}

function fill(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

function tokens(value: unknown): number {
  if (typeof value === 'number') return value;
  const total = (value as { total?: unknown } | undefined)?.total;
  return typeof total === 'number' ? total : 0;
}

async function workspaceArtifacts(ctx: TaskContext, format?: string): Promise<Artifact[]> {
  const out: Artifact[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.service.list(ctx.userScope, format ? { format } : {}, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const item of page.items) out.push(await ctx.service.get(ctx.userScope, item.id));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

interface RunSpec {
  task: EvalTask;
  model: ModelEntry;
  profile: SchemaProfile;
  skill: boolean;
  repetition: number;
}

/** Runs one task with one model and configuration in a fresh, isolated workspace. */
export async function runTask(
  spec: RunSpec,
  config: Pick<EvalConfig, 'maxSteps' | 'locale'> = {},
): Promise<RunResult> {
  const started = Date.now();
  const registry = evalRegistry();
  const workspaceId = `eval-${spec.task.id}-${spec.repetition}`;
  const scope: Scope = { workspaceId, actor: AGENT };
  const userScope: Scope = { workspaceId, actor: USER };
  const toolkit = createArtifactToolkit({
    registry,
    store: createMemoryStore(),
    authorize: (_action, _artifact, s) => s.workspaceId === workspaceId,
    schemaProfile: spec.profile,
    locale: config.locale ?? 'en',
  });
  const ctx: TaskContext = { service: toolkit.service, scope, userScope, vars: {} };
  const calls: ToolCallRecord[] = [];
  const base: Omit<
    RunResult,
    | 'check'
    | 'validFirstTry'
    | 'corrections'
    | 'successWithinTwo'
    | 'operations'
    | 'toolCalls'
    | 'inputTokens'
    | 'outputTokens'
    | 'lintWarnings'
    | 'durationMs'
    | 'calls'
  > = {
    taskId: spec.task.id,
    category: spec.task.category,
    formats: spec.task.formats,
    model: spec.model.name,
    profile: spec.profile,
    skill: spec.skill,
    repetition: spec.repetition,
  };
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;
  try {
    ctx.vars = (await spec.task.setup?.(ctx)) ?? {};
    const perTool = new Map<string, number>();
    const instrumented = instrumentToolkit(toolkit, async (record) => {
      calls.push(record);
      const index = perTool.get(record.name) ?? 0;
      perTool.set(record.name, index + 1);
      await spec.task.afterToolCall?.(ctx, record, index);
    });
    const include = instrumented.tools
      .map((t) => t.name)
      .filter((name) => spec.skill || name !== 'artifact_guide');
    const tools = artifactTools(instrumented, { include, dataParts: false });
    const instructions = [
      artifactInstructions(instrumented, { detail: spec.skill ? 'full' : 'compact' }),
      spec.skill ? instrumented.guide(OVERVIEW_TOPIC) : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
    const agent = new ToolLoopAgent({
      model: spec.model.model,
      instructions,
      tools,
      callOptionsSchema: artifactContextSchema,
      prepareCall: ({ options, ...settings }) => ({
        ...settings,
        toolsContext: artifactToolsContext(tools, options),
      }),
      stopWhen: isStepCount(config.maxSteps ?? 24),
    });
    const result = await agent.generate({
      prompt: fill(spec.task.prompt, ctx.vars),
      options: { workspaceId, actor: AGENT },
    });
    inputTokens = tokens(result.totalUsage.inputTokens);
    outputTokens = tokens(result.totalUsage.outputTokens);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return finishRun(
    base,
    ctx,
    calls,
    registry,
    { inputTokens, outputTokens, started, ...(error ? { error } : {}) },
    spec.task,
  );
}

async function finishRun(
  base: Pick<RunResult, 'taskId' | 'category' | 'formats' | 'model' | 'profile' | 'skill' | 'repetition'>,
  ctx: TaskContext,
  calls: ToolCallRecord[],
  registry: ArtifactRegistry,
  extra: { inputTokens: number; outputTokens: number; started: number; error?: string },
  task: EvalTask,
): Promise<RunResult> {
  const artifacts = await workspaceArtifacts(ctx).catch(() => [] as Artifact[]);
  const check = await task
    .check({ ...ctx, calls, artifacts: (format) => workspaceArtifacts(ctx, format) })
    .catch((cause) => ({ passed: false, score: 0, failures: [`check crashed: ${String(cause)}`] }));
  const mutations = calls.filter((call) => isMutation(call.name));
  const corrections = mutations.filter((call) => !call.ok).length;
  const operations = mutations
    .filter((call) => call.ok)
    .reduce((sum, call) => {
      const ops = (call.input as { operations?: unknown[] } | undefined)?.operations;
      return sum + (Array.isArray(ops) ? ops.length : 1);
    }, 0);
  const lintWarnings = artifacts.reduce((sum, artifact) => {
    const format = registry.get(artifact.format);
    return (
      sum +
      format
        .lint(artifact.content, { locale: artifact.locale, theme: registry.theme(artifact.themeId) })
        .filter((i) => i.severity === 'warning').length
    );
  }, 0);
  return {
    ...base,
    check,
    validFirstTry: mutations[0]?.ok === true,
    corrections,
    successWithinTwo: check.passed && corrections <= 2,
    operations,
    toolCalls: calls.length,
    inputTokens: extra.inputTokens,
    outputTokens: extra.outputTokens,
    lintWarnings,
    durationMs: Date.now() - extra.started,
    ...(extra.error ? { error: extra.error } : {}),
    calls,
  };
}

/**
 * Runs the reference solution of a task through the real tools (no model) and returns the run result.
 * Used to prove every check is satisfiable and to smoke-test the pipeline.
 */
export async function runReference(task: EvalTask): Promise<RunResult> {
  const started = Date.now();
  const registry = evalRegistry();
  const workspaceId = `ref-${task.id}`;
  const scope: Scope = { workspaceId, actor: AGENT };
  const userScope: Scope = { workspaceId, actor: USER };
  const toolkit = createArtifactToolkit({ registry, store: createMemoryStore(), authorize: () => true });
  const ctx: TaskContext = { service: toolkit.service, scope, userScope, vars: {} };
  ctx.vars = (await task.setup?.(ctx)) ?? {};
  const calls: ToolCallRecord[] = [];
  const perTool = new Map<string, number>();
  const instrumented = instrumentToolkit(toolkit, async (record) => {
    calls.push(record);
    const index = perTool.get(record.name) ?? 0;
    perTool.set(record.name, index + 1);
    await task.afterToolCall?.(ctx, record, index);
  });
  await task.reference(createToolCaller(instrumented, scope), ctx);
  return finishRun(
    {
      taskId: task.id,
      category: task.category,
      formats: task.formats,
      model: 'reference',
      profile: 'default',
      skill: true,
      repetition: 0,
    },
    ctx,
    calls,
    registry,
    { inputTokens: 0, outputTokens: 0, started },
    task,
  );
}

/** Runs the whole matrix (spec §21.2): tasks × models × schema profiles × with/without skill × repetitions. */
export async function runEvals(config: EvalConfig): Promise<EvalReport> {
  const startedAt = new Date().toISOString();
  const tasks = (config.tasks ?? defaultTasks).filter(
    (task) => !config.only || config.only.includes(task.id),
  );
  const specs: RunSpec[] = [];
  for (const model of config.models)
    for (const profile of config.profiles ?? (['default', 'strict'] as SchemaProfile[]))
      for (const skill of config.skill ?? [true, false])
        for (const task of tasks)
          for (let repetition = 0; repetition < (config.repeat ?? 1); repetition++)
            specs.push({ task, model, profile, skill, repetition });

  const runs: RunResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < specs.length) {
      const spec = specs[next++]!;
      const run = await runTask(spec, config);
      runs.push(run);
      config.onRun?.(run);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, config.concurrency ?? 2) }, worker));
  return buildReport(runs, { startedAt, threshold: config.threshold ?? 0.9 });
}
