import type { ArtifactToolkit } from '@artkit-ai/agent';
import type { Artifact, ArtifactService, SchemaProfile, Scope } from '@artkit-ai/core';
import type { LanguageModel } from 'ai';

/** Task categories from spec §21.2. */
export type TaskCategory = 'create' | 'edit' | 'fix' | 'restructure' | 'large' | 'cross';

/** One recorded tool call made by the model during a run. */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  /** Error code when the tool returned `{ ok: false }`. */
  code?: string;
  durationMs: number;
}

export interface TaskContext {
  service: ArtifactService;
  /** Scope the model acts in (an agent actor). */
  scope: Scope;
  /** Scope of a human user in the same workspace, for setup and concurrent edits. */
  userScope: Scope;
  /** Values returned by `setup`, also interpolated into the prompt as `{{name}}`. */
  vars: Record<string, string>;
}

export interface CheckContext extends TaskContext {
  calls: readonly ToolCallRecord[];
  /** Latest version of every artifact in the workspace. */
  artifacts(format?: string): Promise<Artifact[]>;
}

export interface CheckResult {
  passed: boolean;
  /** Fraction of the task's assertions that held (0 to 1). */
  score: number;
  /** Failed assertions, written for humans reading the report. */
  failures: string[];
}

/** Calls toolkit tools directly, as a model would. Used by reference solutions. */
export interface ToolCaller {
  call<T = Record<string, unknown>>(name: string, input: unknown): Promise<T & { ok: boolean }>;
}

export interface EvalTask {
  id: string;
  title: string;
  category: TaskCategory;
  /** Formats the task exercises (used to aggregate results per format). */
  formats: string[];
  /** User prompt; `{{var}}` placeholders are filled from `setup`. */
  prompt: string;
  setup?(ctx: TaskContext): Promise<Record<string, string>>;
  /** Called after every tool call of the model, e.g. to simulate a concurrent human edit. */
  afterToolCall?(ctx: TaskContext, call: ToolCallRecord, index: number): Promise<void>;
  check(ctx: CheckContext): Promise<CheckResult>;
  /** Correct solution through the tools; proves the check is satisfiable and drives replay tests. */
  reference(tools: ToolCaller, ctx: TaskContext): Promise<void>;
}

export interface ModelEntry {
  /** Label used in reports, e.g. `anthropic/claude-sonnet-5-5`. */
  name: string;
  model: LanguageModel;
}

export interface EvalConfig {
  models: ModelEntry[];
  tasks?: EvalTask[];
  /** Task ids to run (default: all). */
  only?: string[];
  /** Schema profiles to compare (default `['default', 'strict']`, spec §21.2). */
  profiles?: SchemaProfile[];
  /** Run with and/or without the `artkit-artefatos` skill (default `[true, false]`). */
  skill?: boolean[];
  /** Repetitions of each combination (default 1). */
  repeat?: number;
  /** Maximum model steps per run (default 24). */
  maxSteps?: number;
  /** Locale of tool messages (default `en`). */
  locale?: string;
  /** Concurrent runs (default 2). */
  concurrency?: number;
  /** Exit criterion (spec §21.2): success within two corrections, per format and model (default 0.9). */
  threshold?: number;
  onRun?(run: RunResult): void;
}

export interface RunResult {
  taskId: string;
  category: TaskCategory;
  formats: string[];
  model: string;
  profile: SchemaProfile;
  skill: boolean;
  repetition: number;
  check: CheckResult;
  /** First create/apply call succeeded. */
  validFirstTry: boolean;
  /** Failed create/apply calls before the task ended. */
  corrections: number;
  /** Task passed with at most two failed mutation calls. */
  successWithinTwo: boolean;
  /** Operations in successful apply calls plus one per successful create. */
  operations: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  lintWarnings: number;
  durationMs: number;
  /** Set when the run crashed outside the model loop. */
  error?: string;
  calls: ToolCallRecord[];
}

export interface AggregateRow {
  key: string;
  format: string;
  model: string;
  profile: SchemaProfile;
  skill: boolean;
  runs: number;
  validFirstTry: number;
  successWithinTwo: number;
  meanScore: number;
  meanOperations: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanLintWarnings: number;
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  runs: RunResult[];
  rows: AggregateRow[];
  /** Skill gain in success rate per format and model (with skill minus without). */
  skillGain: { format: string; model: string; profile: SchemaProfile; gain: number }[];
  /** Exit criteria per format and model (spec §25.1). */
  criteria: { format: string; model: string; successRate: number; passed: boolean }[];
  passed: boolean;
}

export type { ArtifactToolkit };
