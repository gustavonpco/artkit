import { z } from 'zod';
import type { AdapterContext, AnyFormatAdapter, ChangeSummary, LintIssue } from './adapter.js';
import { diffFields } from './diff.js';
import { type Artifact, localeSchema, titleSchema } from './envelope.js';
import { ArtifactError, type ErrorIssue, formatPath, zodIssuesToErrorIssues } from './errors.js';
import { t } from './i18n.js';
import type { ArtifactRegistry } from './registry.js';
import { jsonByteSize, jsonDepth, MAX_INPUT_DEPTH, sanitizeDeep } from './sanitize.js';

/** Envelope operations, available for every format and handled by the core (spec §9.3). */
export const envelopeOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_title'), title: titleSchema }).strict(),
  z.object({ op: z.literal('set_theme'), themeId: z.string().min(1).max(64) }).strict(),
  z.object({ op: z.literal('set_locale'), locale: localeSchema }).strict(),
  z
    .object({
      op: z.literal('replace_content'),
      content: z.unknown().describe('Whole new content. Allowed but discouraged for large artifacts.'),
    })
    .strict(),
]);

export type EnvelopeOperation = z.infer<typeof envelopeOperationSchema>;

export const ENVELOPE_OPERATIONS = ['set_title', 'set_theme', 'set_locale', 'replace_content'] as const;

export function isEnvelopeOperation(op: unknown): boolean {
  return (
    typeof op === 'object' &&
    op !== null &&
    (ENVELOPE_OPERATIONS as readonly string[]).includes(String((op as { op?: unknown }).op))
  );
}

/** Lists the `op` names of a discriminated union schema (best effort, used for hints). */
export function operationNames(schema: z.ZodType): string[] {
  const options = (schema as unknown as { options?: z.ZodType[] }).options;
  if (!Array.isArray(options)) return [];
  const names: string[] = [];
  for (const option of options) {
    const shape = (option as unknown as { shape?: Record<string, unknown> }).shape;
    const literal = shape?.op as { value?: unknown } | undefined;
    if (typeof literal?.value === 'string') names.push(literal.value);
  }
  return names;
}

function checkDepth(value: unknown, path: string, locale?: string): void {
  if (jsonDepth(value) > MAX_INPUT_DEPTH) {
    const message = t(locale, 'LIMIT_EXCEEDED', {
      limit: 'depth',
      max: MAX_INPUT_DEPTH,
      found: `>${MAX_INPUT_DEPTH}`,
    });
    throw new ArtifactError('LIMIT_EXCEEDED', message, {
      issues: [{ path, message }],
      details: { limit: 'depth', max: MAX_INPUT_DEPTH },
    });
  }
}

/** Adapter validation + limits. Throws INVALID_CONTENT or LIMIT_EXCEEDED. Returns the normalized content. */
export function validateContent(
  registry: ArtifactRegistry,
  adapter: AnyFormatAdapter,
  raw: unknown,
  ctx: AdapterContext,
): unknown {
  const result = adapter.validate(raw, ctx);
  if (!result.ok) {
    throw new ArtifactError('INVALID_CONTENT', t(ctx.locale, 'INVALID_CONTENT'), {
      issues: result.issues.map((issue) => ({
        ...issue,
        path: issue.path.startsWith('content')
          ? issue.path
          : issue.path
            ? `content.${issue.path}`
            : 'content',
      })),
    });
  }
  checkLimits(registry, adapter, result.content, ctx.locale);
  return result.content;
}

export function checkLimits(
  registry: ArtifactRegistry,
  adapter: AnyFormatAdapter,
  content: unknown,
  locale?: string,
): void {
  const limits = registry.limits(adapter.format);
  const measured = adapter.measure?.(content) ?? {};
  for (const [key, max] of Object.entries(limits)) {
    const found = measured[key];
    if (found !== undefined && found > max) {
      const message = t(locale, 'LIMIT_EXCEEDED', { limit: key, max, found });
      throw new ArtifactError('LIMIT_EXCEEDED', message, {
        issues: [{ path: 'content', message, hint: t(locale, 'LIMIT_EXCEEDED_HINT') }],
        details: { limit: key, max, found },
      });
    }
  }
}

export interface PreparedContent<Content = unknown> {
  content: Content;
  lint: LintIssue[];
}

/**
 * Turns raw content (from the model, a user or an alternative input) into valid content:
 * sanitize → validate → limits → lint. Pure.
 */
export function prepareContent(
  registry: ArtifactRegistry,
  formatName: string,
  raw: unknown,
  options: { locale?: string; themeId?: string } = {},
): PreparedContent {
  const locale = options.locale ?? 'en';
  const adapter = registry.get(formatName, locale);
  const theme = registry.theme(options.themeId ?? 'default', locale);
  checkDepth(raw, 'content', locale);
  const ctx: AdapterContext = { locale, theme, fail: failIn(locale, 0) };
  const content = validateContent(registry, adapter, sanitizeDeep(raw), ctx);
  return { content, lint: adapter.lint(content as never, { locale, theme }) };
}

function failIn(locale: string, index: number) {
  return (message: string, options?: { hint?: string; path?: string }): never => {
    throw new ArtifactError('OPERATION_FAILED', t(locale, 'OPERATION_FAILED', { index }), {
      issues: [
        {
          path: options?.path ? `operations[${index}].${options.path}` : `operations[${index}]`,
          message,
          ...(options?.hint ? { hint: options.hint } : {}),
        },
      ],
      details: { index },
    });
  };
}

export type ParsedOperation = { kind: 'envelope'; op: EnvelopeOperation } | { kind: 'content'; op: unknown };

export interface BatchResult<Content = unknown> {
  content: Content;
  formatVersion: string;
  title: string;
  themeId: string;
  locale: string;
  /** Anchors, declarations, ranges or sheets created by the batch. */
  createdRefs: string[];
  diff: ChangeSummary[];
  lint: LintIssue[];
}

/** Parses and sanitizes a batch. Throws INVALID_OPERATION with the index of the first bad operation. */
export function parseOperations(
  registry: ArtifactRegistry,
  formatName: string,
  operations: unknown,
  locale?: string,
): ParsedOperation[] {
  const adapter = registry.get(formatName, locale);
  if (!Array.isArray(operations)) {
    throw new ArtifactError('INVALID_OPERATION', t(locale, 'INVALID_OPERATIONS'), {
      issues: [
        {
          path: 'operations',
          message: t(locale, 'ZOD_INVALID_TYPE', { expected: 'array' }),
          hint: t(locale, 'ZOD_INVALID_TYPE_HINT', { expected: 'array' }),
        },
      ],
    });
  }
  if (operations.length === 0) {
    throw new ArtifactError('INVALID_OPERATION', t(locale, 'INVALID_OPERATIONS'), {
      issues: [
        {
          path: 'operations',
          message: t(locale, 'ZOD_TOO_SMALL', { minimum: 1 }),
          hint: t(locale, 'ZOD_TOO_SMALL_HINT', { minimum: 1 }),
        },
      ],
    });
  }
  const max = registry.batch.maxOperations;
  if (operations.length > max) {
    const message = t(locale, 'LIMIT_EXCEEDED', {
      limit: 'operationsPerBatch',
      max,
      found: operations.length,
    });
    throw new ArtifactError('LIMIT_EXCEEDED', message, {
      issues: [{ path: 'operations', message, hint: t(locale, 'LIMIT_EXCEEDED_HINT') }],
      details: { limit: 'operationsPerBatch', max, found: operations.length },
    });
  }
  checkDepth(operations, 'operations', locale);
  const names = [...ENVELOPE_OPERATIONS, ...operationNames(adapter.operationSchema)];
  return operations.map((raw, index) => {
    const op = sanitizeDeep(raw);
    if (isEnvelopeOperation(op)) {
      const parsed = envelopeOperationSchema.safeParse(op);
      if (parsed.success) return { kind: 'envelope', op: parsed.data };
      throw invalidOperation(
        index,
        zodIssuesToErrorIssues(parsed.error.issues, locale, `operations[${index}]`),
        locale,
      );
    }
    const parsed = adapter.operationSchema.safeParse(op);
    if (parsed.success) return { kind: 'content', op: parsed.data };
    const issues = zodIssuesToErrorIssues(parsed.error.issues, locale, `operations[${index}]`);
    const opName = (op as { op?: unknown } | null)?.op;
    if (typeof opName !== 'string' || !names.includes(opName)) {
      issues.unshift({
        path: `operations[${index}].op`,
        message: t(locale, 'ZOD_INVALID_VALUE'),
        hint: t(locale, 'ZOD_INVALID_VALUE_HINT', { values: names.join(', ') }),
      });
    }
    throw invalidOperation(index, dedupeIssues(issues), locale);
  });
}

function invalidOperation(index: number, issues: ErrorIssue[], locale?: string): ArtifactError {
  return new ArtifactError('INVALID_OPERATION', t(locale, 'INVALID_OPERATION', { index }), {
    issues,
    details: { index },
  });
}

function dedupeIssues(issues: ErrorIssue[]): ErrorIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Applies a batch atomically (spec §9.1, steps 4–7). Operations run in order: runs of content operations go to the
 * adapter, envelope operations and `replace_content` are handled here. Any failure throws and leaves the input
 * untouched, since everything works on copies.
 */
export async function applyOperations(
  registry: ArtifactRegistry,
  artifact: Pick<Artifact, 'format' | 'content' | 'title' | 'themeId' | 'locale'>,
  operations: unknown,
  options: { locale?: string } = {},
): Promise<BatchResult> {
  const locale = options.locale ?? artifact.locale;
  const adapter = registry.get(artifact.format, locale);
  const parsed = parseOperations(registry, artifact.format, operations, locale);

  const before = artifact.content;
  const envelope = { title: artifact.title, themeId: artifact.themeId, locale: artifact.locale };
  let draft: unknown = structuredClone(before);
  const createdRefs: string[] = [];
  const warnings: LintIssue[] = [];

  let index = 0;
  while (index < parsed.length) {
    const item = parsed[index];
    if (item?.kind === 'envelope') {
      const envelopeOp = item.op;
      if (envelopeOp.op === 'replace_content') {
        checkDepth(envelopeOp.content, `operations[${index}].content`, locale);
        draft = replaceContent(registry, adapter, sanitizeDeep(envelopeOp.content), locale, index);
      } else {
        applyEnvelopeOperation(registry, envelope, envelopeOp, index, locale);
      }
      index += 1;
      continue;
    }
    // Consecutive content operations form one run for the adapter.
    const run: unknown[] = [];
    while (index < parsed.length && parsed[index]?.kind === 'content') {
      run.push(parsed[index]?.op);
      index += 1;
    }
    const theme = registry.theme(envelope.themeId, locale);
    const ctx: AdapterContext = { locale, theme, fail: failIn(locale, index - run.length) };
    try {
      const result = await adapter.apply(draft as never, run as never[], ctx);
      draft = result.content;
      createdRefs.push(...result.createdRefs);
      warnings.push(...result.warnings);
    } catch (error) {
      if (error instanceof ArtifactError) throw error;
      throw new ArtifactError(
        'OPERATION_FAILED',
        t(locale, 'OPERATION_FAILED', { index: index - run.length }),
        {
          issues: [
            {
              path: `operations[${index - run.length}]`,
              message: t(locale, 'OPERATION_FAILED', { index: index - run.length }),
            },
          ],
          details: { index: index - run.length },
          cause: error,
        },
      );
    }
  }

  const finalTheme = registry.theme(envelope.themeId, locale);
  const finalCtx: AdapterContext = { locale: envelope.locale, theme: finalTheme, fail: failIn(locale, 0) };
  draft = validateContent(registry, adapter, draft, finalCtx);
  const envelopeBytes = jsonByteSize({ ...envelope, content: draft });
  if (envelopeBytes > registry.batch.maxEnvelopeBytes) {
    const message = t(locale, 'LIMIT_EXCEEDED', {
      limit: 'envelopeBytes',
      max: registry.batch.maxEnvelopeBytes,
      found: envelopeBytes,
    });
    throw new ArtifactError('LIMIT_EXCEEDED', message, {
      issues: [{ path: 'content', message, hint: t(locale, 'LIMIT_EXCEEDED_HINT') }],
      details: { limit: 'envelopeBytes', max: registry.batch.maxEnvelopeBytes, found: envelopeBytes },
    });
  }

  return {
    content: draft,
    formatVersion: adapter.formatVersion,
    ...envelope,
    createdRefs: [...new Set(createdRefs)],
    diff: [
      ...diffFields(
        'envelope',
        artifact as unknown as Record<string, unknown>,
        envelope,
        ['title', 'themeId', 'locale'],
        locale,
      ),
      ...adapter.diff(before as never, draft as never, locale),
    ],
    lint: [...warnings, ...adapter.lint(draft as never, { locale: envelope.locale, theme: finalTheme })],
  };
}

function replaceContent(
  registry: ArtifactRegistry,
  adapter: ReturnType<ArtifactRegistry['get']>,
  content: unknown,
  locale: string,
  index: number,
): unknown {
  const theme = registry.theme('default', locale);
  const result = adapter.validate(content, { locale, theme, fail: failIn(locale, index) });
  if (!result.ok) {
    throw new ArtifactError('INVALID_OPERATION', t(locale, 'INVALID_OPERATION', { index }), {
      issues: result.issues.map((issue) => ({
        ...issue,
        path: `operations[${index}].content.${issue.path}`,
      })),
      details: { index },
    });
  }
  checkLimits(registry, adapter, result.content, locale);
  return result.content;
}

function applyEnvelopeOperation(
  registry: ArtifactRegistry,
  envelope: { title: string; themeId: string; locale: string },
  op: Exclude<EnvelopeOperation, { op: 'replace_content' }>,
  index: number,
  locale: string,
): void {
  switch (op.op) {
    case 'set_title':
      envelope.title = op.title;
      return;
    case 'set_theme':
      if (!registry.hasTheme(op.themeId)) {
        throw new ArtifactError('OPERATION_FAILED', t(locale, 'OPERATION_FAILED', { index }), {
          issues: [
            {
              path: `operations[${index}].themeId`,
              message: t(locale, 'THEME_NOT_FOUND', { themeId: op.themeId }),
              hint: t(locale, 'ZOD_INVALID_VALUE_HINT', {
                values: registry
                  .themes()
                  .map((theme) => theme.id)
                  .join(', '),
              }),
            },
          ],
          details: { index },
        });
      }
      envelope.themeId = op.themeId;
      return;
    case 'set_locale':
      envelope.locale = op.locale;
      return;
  }
}

/**
 * Areas a batch touches, for automatic rebase (spec §9.2). Derived from the diff produced by applying the batch on
 * its base, plus the envelope fields it sets. `replace_content` touches everything.
 */
export function batchTargets(operations: ParsedOperation[], baseDiff: ChangeSummary[]): Set<string> {
  const targets = new Set<string>();
  for (const item of operations) {
    if (item.kind === 'envelope') {
      const op = item.op;
      if (op.op === 'replace_content') targets.add('*');
      else
        targets.add(
          `envelope:${op.op === 'set_title' ? 'title' : op.op === 'set_theme' ? 'themeId' : 'locale'}`,
        );
    }
  }
  for (const change of baseDiff) targets.add(change.target);
  return targets;
}

/** True when two target sets overlap. `*` overlaps everything. */
export function targetsOverlap(a: Set<string>, b: Set<string>): boolean {
  if ((a.has('*') && b.size > 0) || (b.has('*') && a.size > 0)) return true;
  for (const target of a) if (b.has(target)) return true;
  return false;
}

export { formatPath };
