import type { z } from 'zod';
import type { ErrorIssue } from './errors.js';
import type { Theme } from './theme.js';

/** Contract every native format implements (spec §8). Adapters own all knowledge about their format. */
export interface FormatAdapter<Content = unknown, Operation = unknown> {
  /** Format name stored in the envelope: `markdown`, `univer-sheet`, `openui`. */
  format: string;
  /** Version of the native format or third-party library the content is written with (e.g. `univer-sheet@0.x`). */
  formatVersion: string;
  /** Format versions this adapter can read; `formatVersion` is the one it writes. */
  readableVersions: string[];
  label: string;

  /** Smallest valid content, used when an artifact is created from operations only. */
  empty(): Content;
  /** Validates content (already parsed from the store or from the model). Throws nothing; reports issues. */
  validate(content: unknown, ctx: AdapterContext): ValidationResult<Content>;
  operationSchema: z.ZodType<Operation>;
  /**
   * Applies a run of content operations on a draft. The draft is a private copy; mutations are kept only when the
   * whole batch succeeds. Must not read the clock, the network or randomness.
   */
  apply(content: Content, operations: Operation[], ctx: AdapterContext): Promise<ApplyResult<Content>>;

  /** Compact reading for the model (outline, section, range, full), with budget and cursor. */
  read(content: Content, request: ReadRequest): ReadResult;
  diff(before: Content, after: Content, locale?: string): ChangeSummary[];
  lint(content: Content, ctx: LintContext): LintIssue[];
  /** Best-effort preview while the model streams; drops incomplete trailing items. Returns undefined when unusable. */
  parsePartial(raw: string): Content | undefined;

  migrations: FormatMigration[];
  /** Counters checked against `limits` (same keys as `measure`). */
  limits: FormatLimits;
  measure?(content: Content): Record<string, number>;
  instructions: FormatInstructions;
}

export interface AdapterContext {
  locale: string;
  theme: Theme;
  /** Fails the batch with `OPERATION_FAILED`; the message and hint are written for the model to fix the call. */
  fail(message: string, options?: { hint?: string; path?: string }): never;
}

export type ValidationResult<Content> = { ok: true; content: Content } | { ok: false; issues: ErrorIssue[] };

export interface ApplyResult<Content> {
  content: Content;
  /** Anchors, declarations, ranges or sheets created by the batch (e.g. `escopo`, `kpi1`, `Resumo!A1:D3`). */
  createdRefs: string[];
  warnings: LintIssue[];
}

export type ReadMode = 'outline' | 'section' | 'statements' | 'range' | 'full';

export interface ReadRequest {
  mode: ReadMode;
  /** Format-specific selection: anchors, A1 range, declaration names. */
  range?: string;
  /** Token budget; text is cut at an item boundary and a cursor is returned. */
  maxTokens?: number;
  cursor?: string;
  locale: string;
  charsPerToken?: number;
}

export interface ReadResult {
  text: string;
  truncated: boolean;
  /** Present when truncated: pass it back to continue reading. */
  cursor?: string;
}

export type LintSeverity = 'warning' | 'info';

export interface LintIssue {
  code: string;
  severity: LintSeverity;
  /** `section:cronograma`, `cell:Resumo!D14`, `slide:cronograma`, `node:api`… */
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
  /** Same vocabulary as lint targets; the core compares these to detect rebase conflicts. */
  target: string;
  summary: string;
}

export interface FormatMigration {
  from: string;
  to: string;
  migrate(content: unknown): unknown;
}

export type FormatLimits = Record<string, number>;

export interface FormatExample {
  title: string;
  operations?: unknown[];
  content?: unknown;
}

export interface FormatInstructions {
  /** What the format is and when to use it. */
  summary: string;
  /** Short, verifiable rules. */
  rules: string[];
  examples: FormatExample[];
}

// biome-ignore lint/suspicious/noExplicitAny: the registry stores heterogeneous adapters.
export type AnyFormatAdapter = FormatAdapter<any, any>;

export class FormatDefinitionError extends Error {
  constructor(format: string, problem: string) {
    super(`Invalid format "${format}": ${problem}`);
    this.name = 'FormatDefinitionError';
  }
}

const FORMAT_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_NAME = /^[a-z0-9][a-z0-9.+@-]{0,63}$/i;

/** Checks an adapter's shape. The registry runs it on `register`; third-party adapters can call it directly. */
export function defineFormat<Content, Operation>(
  adapter: FormatAdapter<Content, Operation>,
): FormatAdapter<Content, Operation> {
  assertFormatContract(adapter);
  return adapter;
}

export function assertFormatContract(adapter: AnyFormatAdapter): void {
  const name = typeof adapter?.format === 'string' ? adapter.format : '<unnamed>';
  if (!FORMAT_NAME.test(name))
    throw new FormatDefinitionError(name, 'format must match /^[a-z][a-z0-9-]{0,63}$/');
  if (typeof adapter.formatVersion !== 'string' || !VERSION_NAME.test(adapter.formatVersion)) {
    throw new FormatDefinitionError(name, 'formatVersion must be a non-empty version string');
  }
  if (!Array.isArray(adapter.readableVersions) || !adapter.readableVersions.includes(adapter.formatVersion)) {
    throw new FormatDefinitionError(name, 'readableVersions must include formatVersion');
  }
  if (!(adapter.operationSchema && typeof adapter.operationSchema.safeParse === 'function')) {
    throw new FormatDefinitionError(name, 'operationSchema must be a zod schema');
  }
  for (const fn of ['empty', 'validate', 'apply', 'read', 'diff', 'lint', 'parsePartial'] as const) {
    if (typeof adapter[fn] !== 'function') throw new FormatDefinitionError(name, `${fn} must be a function`);
  }
  if (!Array.isArray(adapter.migrations))
    throw new FormatDefinitionError(name, 'migrations must be an array');
  for (const migration of adapter.migrations) {
    if (
      !adapter.readableVersions.includes(migration.from) ||
      !adapter.readableVersions.includes(migration.to)
    ) {
      throw new FormatDefinitionError(
        name,
        `migration ${migration.from}→${migration.to} must use readable versions`,
      );
    }
  }
  if (
    !adapter.instructions ||
    typeof adapter.instructions.summary !== 'string' ||
    !Array.isArray(adapter.instructions.rules)
  ) {
    throw new FormatDefinitionError(name, 'instructions need summary, rules and examples');
  }
}
