import { z } from 'zod';
import { diffFields } from './diff.js';
import { type Artifact, localeSchema, titleSchema } from './envelope.js';
import { ArtifactError, type ErrorIssue, formatPath, zodIssuesToErrorIssues } from './errors.js';
import { t } from './i18n.js';
import { findDuplicateIds, IdAllocator } from './ids.js';
import type { AnyArtifactKind, ApplyContext, ChangeSummary, IdContext, LintIssue } from './kind.js';
import type { ArtifactRegistry } from './registry.js';
import { jsonByteSize, jsonDepth, MAX_INPUT_DEPTH, sanitizeDeep } from './sanitize.js';

/** Envelope operations, available for every kind and handled by the core (spec §8.4). */
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

export interface PreparedContent<Content = unknown> {
  content: Content;
  ids: string[];
  lint: LintIssue[];
}

export interface EngineOptions {
  locale?: string;
}

function idContext(allocator: IdAllocator): IdContext {
  return {
    nextId: (prefix) => allocator.next(prefix),
    hasId: (id) => allocator.has(id),
    reserveId: (id) => allocator.reserve(id),
  };
}

function checkDepth(value: unknown, path: string, locale?: string): void {
  if (jsonDepth(value) > MAX_INPUT_DEPTH) {
    throw new ArtifactError(
      'LIMIT_EXCEEDED',
      t(locale, 'LIMIT_EXCEEDED', { limit: 'depth', max: MAX_INPUT_DEPTH, found: `>${MAX_INPUT_DEPTH}` }),
      {
        issues: [
          {
            path,
            message: t(locale, 'LIMIT_EXCEEDED', {
              limit: 'depth',
              max: MAX_INPUT_DEPTH,
              found: `>${MAX_INPUT_DEPTH}`,
            }),
          },
        ],
        details: { limit: 'depth', max: MAX_INPUT_DEPTH },
      },
    );
  }
}

/** Schema + integrity + unique ids + limits. Throws INVALID_CONTENT or LIMIT_EXCEEDED. */
export function validateContent(
  registry: ArtifactRegistry,
  kind: AnyArtifactKind,
  raw: unknown,
  locale?: string,
): unknown {
  const parsed = kind.contentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ArtifactError('INVALID_CONTENT', t(locale, 'INVALID_CONTENT'), {
      issues: zodIssuesToErrorIssues(parsed.error.issues, locale, 'content'),
    });
  }
  // The parsed value carries schema defaults, so stored content is always normalized.
  const content = parsed.data;
  const issues: ErrorIssue[] = [...(kind.validate?.(content, locale) ?? [])].map((issue) => ({
    ...issue,
    path: issue.path.startsWith('content') ? issue.path : issue.path ? `content.${issue.path}` : 'content',
  }));
  for (const id of findDuplicateIds(kind.ids(content))) {
    // Kinds may already report duplicates with a precise path; don't repeat them.
    if (issues.some((issue) => issue.message.includes(`"${id}"`) || issue.message.includes(`'${id}'`)))
      continue;
    issues.push({
      path: 'content',
      message: t(locale, 'DUPLICATE_ID', { id }),
      hint: t(locale, 'DUPLICATE_ID_HINT'),
    });
  }
  if (issues.length > 0) throw new ArtifactError('INVALID_CONTENT', t(locale, 'INVALID_CONTENT'), { issues });
  checkLimits(registry, kind, content, locale);
  return content;
}

export function checkLimits(
  registry: ArtifactRegistry,
  kind: AnyArtifactKind,
  content: unknown,
  locale?: string,
): void {
  const limits = registry.limits(kind.kind);
  const measured = kind.measure?.(content) ?? {};
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

/**
 * Turns raw content (from the model, a user or an alternative input) into valid content:
 * sanitize → normalize ids → derive → validate → limits. Pure.
 */
export function prepareContent(
  registry: ArtifactRegistry,
  kindName: string,
  raw: unknown,
  options: EngineOptions & { theme?: string } = {},
): PreparedContent {
  const locale = options.locale;
  const kind = registry.get(kindName, locale);
  checkDepth(raw, 'content', locale);
  const sanitized = sanitizeDeep(raw);
  const allocator = new IdAllocator(collectExplicitIds(sanitized));
  let content = kind.normalize
    ? kind.normalize(structuredClone(sanitized), idContext(allocator))
    : structuredClone(sanitized);
  const parsed = kind.contentSchema.safeParse(content);
  if (!parsed.success) {
    throw new ArtifactError('INVALID_CONTENT', t(locale, 'INVALID_CONTENT'), {
      issues: zodIssuesToErrorIssues(parsed.error.issues, locale, 'content'),
    });
  }
  content = parsed.data;
  kind.derive?.(content);
  content = validateContent(registry, kind, content, locale);
  const theme = registry.theme(options.theme ?? 'default', locale);
  return {
    content,
    ids: [...kind.ids(content)],
    lint: kind.lint(content, { locale: locale ?? 'en', theme }),
  };
}

/** Collects string values of `id` fields anywhere in raw input, so generated ids never collide with them. */
function collectExplicitIds(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > MAX_INPUT_DEPTH) return out;
  if (Array.isArray(value)) for (const item of value) collectExplicitIds(item, out, depth + 1);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'id' && typeof item === 'string') out.push(item);
      else collectExplicitIds(item, out, depth + 1);
    }
  }
  return out;
}

export interface BatchResult<Content = unknown> {
  content: Content;
  schemaVersion: number;
  title: string;
  themeId: string;
  locale: string;
  /** Ids that exist after the batch and did not exist before. */
  createdIds: string[];
  diff: ChangeSummary[];
  lint: LintIssue[];
}

/** Parses and sanitizes a batch. Throws INVALID_OPERATION with the index of the first bad operation. */
export function parseOperations(
  registry: ArtifactRegistry,
  kindName: string,
  operations: unknown,
  locale?: string,
): unknown[] {
  const kind = registry.get(kindName, locale);
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
  const names = [...ENVELOPE_OPERATIONS, ...operationNames(kind.operationSchema)];
  return operations.map((raw, index) => {
    const op = sanitizeDeep(raw);
    const schema: z.ZodType = isEnvelopeOperation(op) ? envelopeOperationSchema : kind.operationSchema;
    const parsed = schema.safeParse(op);
    if (parsed.success) return parsed.data;
    const issues = zodIssuesToErrorIssues(parsed.error.issues, locale, `operations[${index}]`);
    const opName = (op as { op?: unknown } | null)?.op;
    if (typeof opName !== 'string' || !names.includes(opName)) {
      issues.unshift({
        path: `operations[${index}].op`,
        message: t(locale, 'ZOD_INVALID_VALUE'),
        hint: t(locale, 'ZOD_INVALID_VALUE_HINT', { values: names.join(', ') }),
      });
    }
    throw new ArtifactError('INVALID_OPERATION', t(locale, 'INVALID_OPERATION', { index }), {
      issues: dedupeIssues(issues),
      details: { index },
    });
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
 * Applies a batch atomically and purely (spec §8.2 steps 4–8): validate every operation, clone,
 * apply in sequence, derive, revalidate the whole content and limits, then diff and lint.
 * Any failure throws and leaves the input untouched.
 */
export function applyOperations(
  registry: ArtifactRegistry,
  artifact: Pick<Artifact, 'kind' | 'content' | 'title' | 'themeId' | 'locale'>,
  operations: unknown,
  options: EngineOptions = {},
): BatchResult {
  const locale = options.locale ?? artifact.locale;
  const kind = registry.get(artifact.kind, locale);
  const parsedOps = parseOperations(registry, artifact.kind, operations, locale);

  const before = artifact.content;
  let draft: unknown = structuredClone(before);
  const envelope = { title: artifact.title, themeId: artifact.themeId, locale: artifact.locale };
  const beforeIds = new Set<string>(kind.ids(before));
  const allocator = new IdAllocator(beforeIds);

  parsedOps.forEach((op, index) => {
    // `hasId` reflects the draft as it is now, so an id removed earlier in the batch can be reused
    // explicitly; `nextId` still never hands out an id seen in this batch, keeping generated ids stable.
    const present = new Set<string>(kind.ids(draft));
    const ctx: ApplyContext = {
      nextId: (prefix) => {
        const id = allocator.next(prefix);
        present.add(id);
        return id;
      },
      hasId: (id) => present.has(id),
      reserveId: (id) => {
        allocator.reserve(id);
        present.add(id);
      },
      locale,
      fail(message, failOptions) {
        throw new ArtifactError('OPERATION_FAILED', t(locale, 'OPERATION_FAILED', { index }), {
          issues: [
            {
              path: failOptions?.path ? `operations[${index}].${failOptions.path}` : `operations[${index}]`,
              message,
              ...(failOptions?.hint ? { hint: failOptions.hint } : {}),
            },
          ],
          details: { index },
        });
      },
    };
    if (isEnvelopeOperation(op)) {
      draft = applyEnvelopeOperation(
        registry,
        kind,
        draft,
        envelope,
        op as EnvelopeOperation,
        index,
        allocator,
        locale,
      );
      return;
    }
    try {
      kind.apply(draft, op, ctx);
    } catch (error) {
      if (error instanceof ArtifactError) throw error;
      throw new ArtifactError('OPERATION_FAILED', t(locale, 'OPERATION_FAILED', { index }), {
        issues: [{ path: `operations[${index}]`, message: t(locale, 'OPERATION_FAILED', { index }) }],
        details: { index },
        cause: error,
      });
    }
  });

  kind.derive?.(draft);
  draft = validateContent(registry, kind, draft, locale);
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

  const afterIds = [...kind.ids(draft)];
  const theme = registry.theme(envelope.themeId, locale);
  return {
    content: draft,
    schemaVersion: kind.version,
    ...envelope,
    createdIds: afterIds.filter((id) => !beforeIds.has(id)),
    diff: [
      ...diffFields(
        'envelope',
        artifact as unknown as Record<string, unknown>,
        envelope,
        ['title', 'themeId', 'locale'],
        locale,
      ),
      ...kind.diff(before, draft, locale),
    ],
    lint: kind.lint(draft, { locale: envelope.locale, theme }),
  };
}

function applyEnvelopeOperation(
  registry: ArtifactRegistry,
  kind: AnyArtifactKind,
  draft: unknown,
  envelope: { title: string; themeId: string; locale: string },
  op: EnvelopeOperation,
  index: number,
  allocator: IdAllocator,
  locale: string,
): unknown {
  switch (op.op) {
    case 'set_title':
      envelope.title = op.title;
      return draft;
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
      return draft;
    case 'set_locale':
      envelope.locale = op.locale;
      return draft;
    case 'replace_content': {
      checkDepth(op.content, `operations[${index}].content`, locale);
      const raw = sanitizeDeep(op.content);
      for (const id of collectExplicitIds(raw)) allocator.reserve(id);
      const normalized = kind.normalize
        ? kind.normalize(structuredClone(raw), idContext(allocator))
        : structuredClone(raw);
      const parsed = kind.contentSchema.safeParse(normalized);
      if (!parsed.success) {
        throw new ArtifactError('INVALID_OPERATION', t(locale, 'INVALID_OPERATION', { index }), {
          issues: zodIssuesToErrorIssues(parsed.error.issues, locale, `operations[${index}].content`),
          details: { index },
        });
      }
      return parsed.data;
    }
  }
}

/**
 * Targets an operation batch touches, for automatic rebase (spec §8.3). Uses the kind's `targets` when it
 * covers every operation, otherwise the diff produced by applying the batch on its base.
 */
export function batchTargets(
  kind: AnyArtifactKind,
  operations: unknown[],
  baseDiff: ChangeSummary[],
): Set<string> {
  const targets = new Set<string>();
  const kindOps = operations.filter((op) => !isEnvelopeOperation(op));
  for (const op of operations) {
    if (!isEnvelopeOperation(op)) continue;
    const name = (op as EnvelopeOperation).op;
    if (name === 'replace_content') targets.add('*');
    else
      targets.add(`envelope:${name === 'set_title' ? 'title' : name === 'set_theme' ? 'themeId' : 'locale'}`);
  }
  if (kind.targets && kindOps.length > 0) {
    for (const op of kindOps) for (const target of kind.targets(op)) targets.add(target);
  } else {
    for (const change of baseDiff) targets.add(change.target);
  }
  return targets;
}

/** True when two target sets overlap. `*` overlaps everything. */
export function targetsOverlap(a: Set<string>, b: Set<string>): boolean {
  if ((a.has('*') && b.size > 0) || (b.has('*') && a.size > 0)) return true;
  for (const target of a) {
    if (b.has(target)) return true;
    // A target nested in another (`cell:Resumo!A1` vs `sheet:Resumo`) is handled by kinds emitting both.
  }
  return false;
}

export { formatPath };
