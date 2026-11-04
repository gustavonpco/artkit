import { z } from 'zod';
import type { ErrorIssue } from './errors.js';
import type { Theme } from './theme.js';

export type ProjectionMode = 'outline' | 'full' | 'range';

export interface ProjectionOptions {
  mode: ProjectionMode;
  /**
   * Kind-specific range: block ids ("intro..escopo"), A1 range ("Resumo!A1:D20"), slide ids or 1-based
   * indexes ("3-5"), or a group id for diagrams.
   */
  range?: string;
  /** Token budget; text is cut at an item boundary and a cursor is returned. */
  maxTokens?: number;
  /** Continuation cursor returned by a previous truncated projection. */
  cursor?: string;
  /** Characters per token used for the estimate (default 4). */
  charsPerToken?: number;
  locale: string;
  theme?: Theme;
}

export interface Projection {
  text: string;
  truncated: boolean;
  /** Present when truncated: pass it back to continue reading. */
  cursor?: string;
  /** Outline of what was left out, so the model can jump with `range`. */
  remainingOutline?: string;
}

export type LintSeverity = 'warning' | 'info';

export interface LintIssue {
  code: string;
  severity: LintSeverity;
  /** `block:intro`, `cell:Resumo!D14`, `slide:cronograma`, `node:api`… */
  target: string;
  message: string;
  hint?: string;
}

export interface LintContext {
  locale: string;
  theme: Theme;
}

export type ChangeType = 'added' | 'removed' | 'changed' | 'moved';

export interface ChangeSummary {
  type: ChangeType;
  /** `block:premissa-api`, `cell:Resumo!D14`, `slide:cronograma`, `envelope:title`… */
  target: string;
  summary: string;
}

export interface Migration {
  from: number;
  to: number;
  migrate(content: unknown): unknown;
}

/** Limits are plain counters, compared with what `measure` returns under the same keys (spec §6.6). */
export type KindLimits = Record<string, number>;

export interface KindExample {
  title: string;
  /**
   * Alternative input that creates the example (e.g. `{ format: 'mermaid', source: 'flowchart LR…' }`).
   * When `content` is also given, it is the content the input must produce.
   */
  input?: { format: string; source: unknown };
  content?: unknown;
  operations?: unknown[];
}

export interface KindInstructions {
  /** What the kind is and when to use it. */
  summary: string;
  /** Short, verifiable rules. */
  rules: string[];
  examples: KindExample[];
}

export interface ContentInput<Content> {
  /** Shown in model instructions. */
  description: string;
  schema: z.ZodType<unknown>;
  /** Deterministic conversion. Throw `ArtifactError('INVALID_CONTENT')` on bad input. */
  toContent(input: unknown, ctx: InputContext): Content;
}

export interface InputContext {
  locale: string;
  /**
   * Records a non-blocking conversion note (an ignored directive, a mapped shape). Notes are returned
   * to the caller as `info` lint issues with code `input-note`.
   */
  note?(message: string): void;
}

export interface IdContext {
  /** Deterministic id for a new item, e.g. `nextId('p')` → `p12`. */
  nextId(prefix: string): string;
  /** True when the id already exists in the content (including ids created earlier in the batch). */
  hasId(id: string): boolean;
  /** Registers an explicitly provided id so later operations in the batch see it. */
  reserveId(id: string): void;
}

export interface ApplyContext extends IdContext {
  /** Aborts the batch with `OPERATION_FAILED` and a model-facing hint. */
  fail(message: string, options?: { hint?: string; path?: string }): never;
  locale: string;
}

/**
 * Contract every kind implements, native or third-party (spec §7).
 * `apply` mutates a clone and must be pure: no clock, network or randomness.
 */
export interface ArtifactKind<Content = unknown, Operation = unknown> {
  kind: string;
  version: number;
  label: string;

  contentSchema: z.ZodType<Content>;
  operationSchema: z.ZodType<Operation>;

  /** Smallest valid content, used for skeleton creation. */
  empty(): Content;
  /**
   * Prepares raw content before validation: fills missing ids deterministically (ids are optional on
   * creation, spec §6.2). Must not throw on malformed input; validation reports problems afterwards.
   */
  normalize?(raw: unknown, ctx: IdContext): unknown;
  apply(draft: Content, op: Operation, ctx: ApplyContext): void;
  /** Every item id in the content (unique across the whole artifact). */
  ids(content: Content): Iterable<string>;
  /** Integrity rules beyond the schema (references, unique ids, table widths). Empty array means valid. */
  validate?(content: Content, locale?: string): ErrorIssue[];
  /** Counters checked against `limits`. */
  measure?(content: Content): Record<string, number>;
  /** Derived step after operations (e.g. formula recalculation). Mutates the draft; must stay deterministic. */
  derive?(draft: Content): void;
  /** Item targets an operation touches, used for automatic rebase. Defaults to diff-based detection. */
  targets?(op: Operation): string[];

  project(content: Content, options: ProjectionOptions): Projection;
  lint(content: Content, ctx: LintContext): LintIssue[];
  /** `locale` selects the language of the summaries (pt-BR or English). */
  diff(before: Content, after: Content, locale?: string): ChangeSummary[];
  /** Best-effort preview while the model is still streaming; drops incomplete trailing items. */
  parsePartial(raw: unknown): Content | undefined;

  inputs?: Record<string, ContentInput<Content>>;
  migrations: Migration[];
  limits: KindLimits;
  instructions: KindInstructions;
}

// biome-ignore lint/suspicious/noExplicitAny: registry stores heterogeneous kinds.
export type AnyArtifactKind = ArtifactKind<any, any>;

export class KindDefinitionError extends Error {
  constructor(kind: string, problem: string) {
    super(`Invalid kind "${kind}": ${problem}`);
    this.name = 'KindDefinitionError';
  }
}

const KIND_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Validates a kind definition and returns it unchanged. Use it for third-party kinds (spec §20);
 * the registry runs the same checks on `register`.
 */
export function defineKind<Content, Operation>(
  kind: ArtifactKind<Content, Operation>,
): ArtifactKind<Content, Operation> {
  assertKindContract(kind);
  return kind;
}

export function assertKindContract(kind: AnyArtifactKind): void {
  const name = typeof kind?.kind === 'string' ? kind.kind : '<unnamed>';
  if (!KIND_NAME.test(name)) throw new KindDefinitionError(name, 'kind must match /^[a-z][a-z0-9-]{0,63}$/');
  if (!Number.isInteger(kind.version) || kind.version < 1)
    throw new KindDefinitionError(name, 'version must be an integer >= 1');
  if (!(kind.contentSchema instanceof z.ZodType))
    throw new KindDefinitionError(name, 'contentSchema must be a zod schema');
  if (!(kind.operationSchema instanceof z.ZodType))
    throw new KindDefinitionError(name, 'operationSchema must be a zod schema');
  for (const fn of ['empty', 'apply', 'ids', 'project', 'lint', 'diff', 'parsePartial'] as const) {
    if (typeof kind[fn] !== 'function') throw new KindDefinitionError(name, `${fn} must be a function`);
  }
  if (!Array.isArray(kind.migrations)) throw new KindDefinitionError(name, 'migrations must be an array');
  let expected = 1;
  for (const migration of [...kind.migrations].sort((a, b) => a.from - b.from)) {
    if (migration.from !== expected || migration.to !== migration.from + 1) {
      throw new KindDefinitionError(name, `migrations must form a chain 1→2→…→${kind.version}`);
    }
    expected = migration.to;
  }
  if (kind.migrations.length > 0 && expected !== kind.version) {
    throw new KindDefinitionError(name, `migrations end at ${expected} but version is ${kind.version}`);
  }
  if (
    !kind.instructions ||
    typeof kind.instructions.summary !== 'string' ||
    !Array.isArray(kind.instructions.rules)
  ) {
    throw new KindDefinitionError(name, 'instructions need summary, rules and examples');
  }
  const empty = kind.contentSchema.safeParse(kind.empty());
  if (!empty.success) throw new KindDefinitionError(name, 'empty() does not satisfy contentSchema');
}
