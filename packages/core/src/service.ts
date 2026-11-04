import type { AssetRef, AssetResolver } from './assets.js';
import { deepEqual } from './diff.js';
import {
  applyOperations,
  type BatchResult,
  batchTargets,
  envelopeOperationSchema,
  parseOperations,
  prepareContent,
  targetsOverlap,
} from './engine.js';
import {
  type Artifact,
  type ArtifactStatus,
  type ArtifactSummary,
  canTransition,
  summarize,
  titleSchema,
} from './envelope.js';
import { ArtifactError, zodIssuesToErrorIssues } from './errors.js';
import { createEventBus, type EventBus } from './events.js';
import { t } from './i18n.js';
import type { ChangeSummary, LintIssue, Projection, ProjectionOptions } from './kind.js';
import { type LogFields, type Logger, type MetricsHooks, silentLogger } from './logger.js';
import { migrateContent } from './migrations.js';
import { delimitProjection } from './projection.js';
import type { ArtifactRegistry } from './registry.js';
import { sanitizeDeep } from './sanitize.js';
import type {
  ArtifactFilter,
  ArtifactStore,
  AssetStore,
  Lock,
  Page,
  PageRequest,
  Scope,
  VersionEntry,
} from './store.js';

export type ArtifactAction =
  | 'create'
  | 'read'
  | 'apply'
  | 'export'
  | 'list'
  | 'history'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'archive'
  | 'restore'
  | 'lock';

/** Mandatory authorization hook in toolkits (spec §16). Return false to deny. */
export type AuthorizeFn = (
  action: ArtifactAction,
  artifact: ArtifactSummary | null,
  scope: Scope,
) => boolean | Promise<boolean>;

export interface ApprovalPolicy {
  /** Publishing goes through submit → approve (default true). */
  requireApprovalToPublish: boolean;
  /** Only published artifacts can be exported (default false). */
  requireApprovalToExport: boolean;
  /** Agents cannot edit published artifacts without approval (default false). Edits create a new draft. */
  requireApprovalToEditPublished: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requireApprovalToPublish: true,
  requireApprovalToExport: false,
  requireApprovalToEditPublished: false,
};

export interface ArtifactServiceOptions {
  registry: ArtifactRegistry;
  store: ArtifactStore;
  assets?: AssetStore;
  authorize?: AuthorizeFn;
  events?: EventBus;
  logger?: Logger;
  metrics?: MetricsHooks;
  /** Locale for model-facing messages (pt-BR or en). */
  locale?: string;
  /** Default locale of new artifacts. */
  defaultArtifactLocale?: string;
  defaultThemeId?: string;
  policy?: Partial<ApprovalPolicy>;
  /** Times a commit is retried when another writer wins the race (default 3). */
  commitRetries?: number;
  /** Default export timeout (default 60s). */
  exportTimeoutMs?: number;
}

export interface CreateRequest {
  kind: string;
  title: string;
  content?: unknown;
  /** Alternative input, e.g. `{ format: 'markdown', source: '# Title' }`. */
  input?: { format: string; source: unknown };
  locale?: string;
  themeId?: string;
  tags?: string[];
  message?: string;
  idempotencyKey?: string;
}

export interface CommitResult {
  artifact: Artifact;
  version: number;
  createdIds: string[];
  diff: ChangeSummary[];
  lint: LintIssue[];
  /** True when the batch was applied on a newer version than its baseVersion. */
  rebased: boolean;
  /** True when an earlier call with the same idempotency key was replayed. */
  replayed: boolean;
}

export interface ApplyRequest {
  artifactId: string;
  baseVersion: number;
  operations: unknown[];
  idempotencyKey?: string;
  message?: string;
}

export interface ReadResult {
  artifact: ArtifactSummary;
  version: number;
  projection: Projection;
  /** Projection wrapped in data delimiters, ready to hand to a model. */
  text: string;
}

export interface ExportRequest {
  artifactId: string;
  format: string;
  version?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Store the result in the AssetStore and return its reference. */
  saveToAssets?: boolean;
  options?: Record<string, unknown>;
}

export interface ExportResult {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
  filename: string;
  warnings: string[];
  asset?: { ref: AssetRef; size: number; hash: string };
}

export interface ArtifactService {
  readonly registry: ArtifactRegistry;
  readonly events: EventBus;
  create(scope: Scope, request: CreateRequest): Promise<CommitResult>;
  get(scope: Scope, id: string, opts?: { version?: number }): Promise<Artifact>;
  read(
    scope: Scope,
    id: string,
    options?: Partial<ProjectionOptions> & { version?: number },
  ): Promise<ReadResult>;
  apply(scope: Scope, request: ApplyRequest): Promise<CommitResult>;
  /** Pure dry run on the current version: validates and returns diff/lint without committing. */
  preview(scope: Scope, request: ApplyRequest): Promise<BatchResult>;
  list(scope: Scope, filter?: ArtifactFilter, page?: PageRequest): Promise<Page<ArtifactSummary>>;
  history(scope: Scope, id: string, page?: PageRequest): Promise<Page<VersionEntry>>;
  restore(scope: Scope, id: string, version: number, message?: string): Promise<CommitResult>;
  submit(scope: Scope, id: string, message?: string): Promise<Artifact>;
  approve(scope: Scope, id: string, message?: string): Promise<Artifact>;
  reject(scope: Scope, id: string, reason?: string): Promise<Artifact>;
  publish(scope: Scope, id: string): Promise<Artifact>;
  archive(scope: Scope, id: string): Promise<Artifact>;
  lock(scope: Scope, id: string, ttlMs?: number): Promise<Lock>;
  unlock(scope: Scope, lock: Lock): Promise<void>;
  /** Current lock holder, or null; lets UIs show who is editing before trying to write. */
  getLock(scope: Scope, id: string): Promise<Lock | null>;
  export(scope: Scope, request: ExportRequest): Promise<ExportResult>;
  /** Resolver over the asset store, scoped (used by exporters and renderers). */
  assetResolver(scope: Scope): AssetResolver;
}

/**
 * The high-level pipeline (spec §8.2): authorization, migration, baseVersion check with automatic rebase,
 * atomic apply, optimistic commit with retries, idempotency, events and metadata-only logging.
 */
export function createArtifactService(options: ArtifactServiceOptions): ArtifactService {
  const { registry, store } = options;
  const locale = options.locale ?? 'en';
  const logger = options.logger ?? silentLogger;
  const metrics = options.metrics ?? {};
  const events =
    options.events ??
    createEventBus((error) => logger.error('event handler failed', { code: String(error) }));
  const policy: ApprovalPolicy = { ...DEFAULT_APPROVAL_POLICY, ...options.policy };
  const retries = options.commitRetries ?? 3;

  async function authorize(
    action: ArtifactAction,
    artifact: ArtifactSummary | null,
    scope: Scope,
  ): Promise<void> {
    if (!options.authorize) return;
    const allowed = await options.authorize(action, artifact, scope);
    if (!allowed) {
      metrics.rejection?.('PERMISSION_DENIED', { actorType: scope.actor.type });
      throw new ArtifactError('PERMISSION_DENIED', t(locale, 'PERMISSION_DENIED', { action }));
    }
  }

  async function load(scope: Scope, id: string, version?: number): Promise<Artifact> {
    const found = await store.get(scope, id, version === undefined ? undefined : { version });
    if (!found) {
      throw new ArtifactError(
        'NOT_FOUND',
        t(locale, 'NOT_FOUND', { what: version ? `Version ${version}` : 'Artifact', id }),
        {
          issues: [
            {
              path: 'id',
              message: t(locale, 'NOT_FOUND', { what: 'Artifact', id }),
              hint: t(locale, 'NOT_FOUND_HINT'),
            },
          ],
        },
      );
    }
    return migrated(found);
  }

  function migrated(artifact: Artifact): Artifact {
    const kind = registry.get(artifact.kind, locale);
    const result = migrateContent(kind, artifact.content, artifact.schemaVersion, locale);
    return result.migrated
      ? { ...artifact, content: result.content, schemaVersion: result.schemaVersion }
      : artifact;
  }

  function fields(
    artifact: Pick<Artifact, 'id' | 'kind' | 'version'>,
    scope: Scope,
    extra: LogFields = {},
  ): LogFields {
    return {
      artifactId: artifact.id,
      kind: artifact.kind,
      version: artifact.version,
      actorType: scope.actor.type,
      ...extra,
    };
  }

  async function assertNotLocked(scope: Scope, id: string): Promise<void> {
    const lock = await store.getLock(scope, id);
    if (!lock) return;
    if (lock.holder.type === scope.actor.type && lock.holder.id === scope.actor.id) return;
    throw new ArtifactError(
      'LOCKED',
      t(locale, 'LOCKED', { holder: `${lock.holder.type}:${lock.holder.id}`, expiresAt: lock.expiresAt }),
      {
        issues: [
          {
            path: 'artifactId',
            message: t(locale, 'LOCKED', { holder: lock.holder.type, expiresAt: lock.expiresAt }),
            hint: t(locale, 'LOCKED_HINT'),
          },
        ],
        details: { expiresAt: lock.expiresAt },
      },
    );
  }

  async function replay(
    scope: Scope,
    id: string,
    key: string | undefined,
  ): Promise<CommitResult | undefined> {
    if (!key) return undefined;
    const entry = await store.findByIdempotencyKey(scope, id, key);
    if (!entry) return undefined;
    const artifact = await load(scope, id, entry.version);
    const kind = registry.get(artifact.kind, locale);
    return {
      artifact,
      version: entry.version,
      createdIds: entry.createdIds,
      diff: entry.diff,
      lint: kind.lint(artifact.content, {
        locale: artifact.locale,
        theme: registry.theme(artifact.themeId, locale),
      }),
      rebased: false,
      replayed: true,
    };
  }

  /** Applies on the current version, rebasing from an older base when the touched items did not change. */
  async function computeBatch(
    scope: Scope,
    current: Artifact,
    request: ApplyRequest,
  ): Promise<{ result: BatchResult; rebased: boolean }> {
    if (request.baseVersion === current.version) {
      return { result: applyOperations(registry, current, request.operations, { locale }), rebased: false };
    }
    const conflict = (changes: ChangeSummary[]) => {
      metrics.conflict?.(fields(current, scope));
      events.emit({
        type: 'artifact.conflict',
        artifactId: current.id,
        baseVersion: request.baseVersion,
        currentVersion: current.version,
        actor: scope.actor,
      });
      return new ArtifactError(
        'VERSION_CONFLICT',
        t(locale, 'VERSION_CONFLICT', { baseVersion: request.baseVersion, currentVersion: current.version }),
        {
          issues: [
            {
              path: 'baseVersion',
              message: t(locale, 'VERSION_CONFLICT', {
                baseVersion: request.baseVersion,
                currentVersion: current.version,
              }),
              hint: t(locale, 'VERSION_CONFLICT_HINT'),
            },
          ],
          details: { currentVersion: current.version, changesSinceBase: changes },
        },
      );
    };
    if (request.baseVersion > current.version || request.baseVersion < 1) throw conflict([]);
    const base = await load(scope, current.id, request.baseVersion);
    const kind = registry.get(current.kind, locale);
    // Validate against the base first: an invalid batch is the model's error, not a conflict.
    const onBase = applyOperations(registry, base, request.operations, { locale });
    const changedSince = [
      ...(base.title !== current.title
        ? [
            {
              type: 'changed' as const,
              target: 'envelope:title',
              summary: `'${base.title}' → '${current.title}'`,
            },
          ]
        : []),
      ...(base.themeId !== current.themeId
        ? [
            {
              type: 'changed' as const,
              target: 'envelope:themeId',
              summary: `${base.themeId} → ${current.themeId}`,
            },
          ]
        : []),
      ...(base.locale !== current.locale
        ? [
            {
              type: 'changed' as const,
              target: 'envelope:locale',
              summary: `${base.locale} → ${current.locale}`,
            },
          ]
        : []),
      ...kind.diff(base.content, current.content, locale),
    ];
    const parsed = parseOperations(registry, current.kind, request.operations, locale);
    const touched = batchTargets(kind, parsed, onBase.diff);
    const changed = new Set(changedSince.map((change) => change.target));
    if (targetsOverlap(touched, changed)) throw conflict(changedSince);
    try {
      return { result: applyOperations(registry, current, request.operations, { locale }), rebased: true };
    } catch (error) {
      if (
        error instanceof ArtifactError &&
        (error.code === 'OPERATION_FAILED' || error.code === 'INVALID_CONTENT')
      ) {
        throw conflict(changedSince);
      }
      throw error;
    }
  }

  async function changeStatus(
    scope: Scope,
    id: string,
    to: ArtifactStatus,
    action: ArtifactAction,
    message?: string,
  ): Promise<Artifact> {
    const current = await load(scope, id);
    await authorize(action, summarize(current), scope);
    if (!canTransition(current.status, to)) {
      throw new ArtifactError(
        'PERMISSION_DENIED',
        t(locale, 'INVALID_STATUS_TRANSITION', { from: current.status, to }),
        {
          details: { from: current.status, to },
        },
      );
    }
    const updated = await store.setStatus(scope, id, to, scope.actor, message);
    events.emit({
      type: 'artifact.status_changed',
      artifact: summarize(updated),
      from: current.status,
      to,
      actor: scope.actor,
      ...(message ? { message } : {}),
    });
    logger.info('artifact.status_changed', fields(updated, scope, { from: current.status, to }));
    return updated;
  }

  const service: ArtifactService = {
    registry,
    events,

    async create(scope, request) {
      await authorize('create', null, scope);
      const kind = registry.get(request.kind, locale);
      if (request.idempotencyKey && store.findCreatedByIdempotencyKey) {
        const existing = await store.findCreatedByIdempotencyKey(scope, request.idempotencyKey);
        if (existing) {
          const first = await load(scope, existing.id, 1);
          const prepared = [...registry.get(first.kind, locale).ids(first.content)];
          return {
            artifact: first,
            version: 1,
            createdIds: prepared,
            diff: [
              { type: 'added', target: `artifact:${first.id}`, summary: `${kind.label} "${first.title}"` },
            ],
            lint: kind.lint(first.content, {
              locale: first.locale,
              theme: registry.theme(first.themeId, locale),
            }),
            rebased: false,
            replayed: true,
          };
        }
      }
      const title = titleSchema.safeParse(sanitizeDeep(request.title));
      if (!title.success) {
        throw new ArtifactError('INVALID_CONTENT', t(locale, 'INVALID_CONTENT'), {
          issues: zodIssuesToErrorIssues(title.error.issues, locale, 'title'),
        });
      }
      const artifactLocale = request.locale ?? options.defaultArtifactLocale ?? 'en';
      const themeId = request.themeId ?? options.defaultThemeId ?? 'default';
      registry.theme(themeId, locale);
      let raw: unknown;
      const inputNotes: string[] = [];
      if (request.input) {
        const input = kind.inputs?.[request.input.format];
        if (!input) {
          const available = Object.keys(kind.inputs ?? {});
          throw new ArtifactError(
            'INVALID_CONTENT',
            t(locale, 'INPUT_FORMAT_UNSUPPORTED', { kind: kind.kind, format: request.input.format }),
            {
              issues: [
                {
                  path: 'input.format',
                  message: t(locale, 'INPUT_FORMAT_UNSUPPORTED', {
                    kind: kind.kind,
                    format: request.input.format,
                  }),
                  hint: t(locale, 'INPUT_FORMAT_HINT', { available: available.join(', ') || '—' }),
                },
              ],
            },
          );
        }
        const parsedInput = input.schema.safeParse(sanitizeDeep(request.input.source));
        if (!parsedInput.success) {
          throw new ArtifactError('INVALID_CONTENT', t(locale, 'INVALID_CONTENT'), {
            issues: zodIssuesToErrorIssues(parsedInput.error.issues, locale, 'input.source'),
          });
        }
        raw = input.toContent(parsedInput.data, {
          locale: artifactLocale,
          note: (message) => inputNotes.push(message),
        });
      } else {
        raw = request.content ?? kind.empty();
      }
      const prepared = prepareContent(registry, kind.kind, raw, { locale, theme: themeId });
      prepared.lint.push(
        ...inputNotes.map((message) => ({
          code: 'input-note',
          severity: 'info' as const,
          target: `input:${request.input?.format ?? 'content'}`,
          message,
        })),
      );
      const artifact = await store.create(scope, {
        kind: kind.kind,
        schemaVersion: kind.version,
        title: title.data,
        status: 'draft',
        locale: artifactLocale,
        themeId,
        content: prepared.content,
        createdIds: prepared.ids,
        ...(request.tags ? { tags: request.tags } : {}),
        ...(request.message ? { message: request.message } : {}),
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      });
      events.emit({ type: 'artifact.created', artifact: summarize(artifact), actor: scope.actor });
      if (prepared.lint.length > 0)
        events.emit({
          type: 'artifact.lint',
          artifactId: artifact.id,
          version: artifact.version,
          warnings: prepared.lint.length,
        });
      logger.info('artifact.created', fields(artifact, scope));
      return {
        artifact,
        version: artifact.version,
        createdIds: prepared.ids,
        diff: [
          { type: 'added', target: `artifact:${artifact.id}`, summary: `${kind.label} "${artifact.title}"` },
        ],
        lint: prepared.lint,
        rebased: false,
        replayed: false,
      };
    },

    async get(scope, id, opts) {
      const artifact = await load(scope, id, opts?.version);
      await authorize('read', summarize(artifact), scope);
      return artifact;
    },

    async read(scope, id, opts = {}) {
      const artifact = await load(scope, id, opts.version);
      await authorize('read', summarize(artifact), scope);
      const kind = registry.get(artifact.kind, locale);
      const projection = kind.project(artifact.content, {
        mode: opts.mode ?? 'outline',
        locale: artifact.locale,
        theme: registry.theme(artifact.themeId, locale),
        ...(opts.range === undefined ? {} : { range: opts.range }),
        ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
        ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
        ...(opts.charsPerToken === undefined ? {} : { charsPerToken: opts.charsPerToken }),
      });
      const header = `${kind.label} "${artifact.title}" (id: ${artifact.id}, kind: ${artifact.kind}, version: ${artifact.version}, status: ${artifact.status}, locale: ${artifact.locale})`;
      let text = `${header}\n${delimitProjection(artifact.id, projection.text)}`;
      if (projection.truncated) {
        text += `\n[truncated — continue with cursor "${projection.cursor}"]\nRemaining outline:\n${projection.remainingOutline ?? ''}`;
      }
      return { artifact: summarize(artifact), version: artifact.version, projection, text };
    },

    async apply(scope, request) {
      const started = Date.now();
      let current = await load(scope, request.artifactId);
      await authorize('apply', summarize(current), scope);
      const replayed = await replay(scope, current.id, request.idempotencyKey);
      if (replayed) return replayed;
      await assertNotLocked(scope, current.id);
      if (
        current.status === 'published' &&
        policy.requireApprovalToEditPublished &&
        scope.actor.type === 'agent'
      ) {
        throw new ArtifactError('APPROVAL_REQUIRED', t(locale, 'APPROVAL_REQUIRED', { action: 'apply' }), {
          issues: [
            {
              path: 'artifactId',
              message: t(locale, 'APPROVAL_REQUIRED', { action: 'apply' }),
              hint: t(locale, 'APPROVAL_REQUIRED_HINT'),
            },
          ],
        });
      }
      for (let attempt = 0; ; attempt++) {
        const { result, rebased } = await computeBatch(scope, current, request);
        try {
          const committed = await store.commit(scope, current.id, {
            baseVersion: current.version,
            schemaVersion: result.schemaVersion,
            content: result.content,
            title: result.title,
            locale: result.locale,
            themeId: result.themeId,
            // Editing a published (or pending) artifact starts a new draft (spec §15.3).
            ...(current.status === 'published' || current.status === 'pending_approval'
              ? { status: 'draft' as const }
              : {}),
            operations: request.operations,
            diff: result.diff,
            createdIds: result.createdIds,
            ...(request.message ? { message: request.message } : {}),
            ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
          });
          const duration = Date.now() - started;
          const logFields = fields(committed, scope, {
            operationCount: request.operations.length,
            durationMs: duration,
          });
          metrics.applyDuration?.(duration, logFields);
          logger.info('artifact.committed', logFields);
          events.emit({
            type: 'artifact.committed',
            artifact: summarize(committed),
            actor: scope.actor,
            operationCount: request.operations.length,
            diff: result.diff,
            rebased,
          });
          if (result.lint.length > 0)
            events.emit({
              type: 'artifact.lint',
              artifactId: committed.id,
              version: committed.version,
              warnings: result.lint.length,
            });
          return {
            artifact: committed,
            version: committed.version,
            createdIds: result.createdIds,
            diff: result.diff,
            lint: result.lint,
            rebased,
            replayed: false,
          };
        } catch (error) {
          // Another writer won the race: reload and rebase from the original base.
          if (error instanceof ArtifactError && error.code === 'VERSION_CONFLICT' && attempt < retries) {
            current = await load(scope, request.artifactId);
            continue;
          }
          if (error instanceof ArtifactError) metrics.rejection?.(error.code, fields(current, scope));
          throw error;
        }
      }
    },

    async preview(scope, request) {
      const current = await load(scope, request.artifactId);
      await authorize('read', summarize(current), scope);
      return (await computeBatch(scope, current, request)).result;
    },

    async list(scope, filter = {}, page = {}) {
      await authorize('list', null, scope);
      return store.list(scope, filter, page);
    },

    async history(scope, id, page = {}) {
      const current = await load(scope, id);
      await authorize('history', summarize(current), scope);
      return store.history(scope, id, page);
    },

    async restore(scope, id, version, message) {
      const current = await load(scope, id);
      await authorize('restore', summarize(current), scope);
      await assertNotLocked(scope, id);
      const old = await load(scope, id, version);
      const kind = registry.get(current.kind, locale);
      const diff = [
        ...(old.title !== current.title
          ? [
              {
                type: 'changed' as const,
                target: 'envelope:title',
                summary: `'${current.title}' → '${old.title}'`,
              },
            ]
          : []),
        ...kind.diff(current.content, old.content, locale),
      ];
      const beforeIds = new Set<string>(kind.ids(current.content));
      const createdIds = [...kind.ids(old.content)].filter((itemId) => !beforeIds.has(itemId));
      const committed = await store.commit(scope, id, {
        baseVersion: current.version,
        schemaVersion: old.schemaVersion,
        content: old.content,
        title: old.title,
        locale: old.locale,
        themeId: old.themeId,
        ...(current.status !== 'draft' && current.status !== 'archived' ? { status: 'draft' as const } : {}),
        operations: [{ op: 'replace_content', content: '[restored]' }],
        diff,
        createdIds,
        restoredFrom: version,
        message: message ?? `Restored version ${version}`,
      });
      events.emit({
        type: 'artifact.committed',
        artifact: summarize(committed),
        actor: scope.actor,
        operationCount: 0,
        diff,
        rebased: false,
      });
      return {
        artifact: committed,
        version: committed.version,
        createdIds,
        diff,
        lint: kind.lint(committed.content, {
          locale: committed.locale,
          theme: registry.theme(committed.themeId, locale),
        }),
        rebased: false,
        replayed: false,
      };
    },

    submit: (scope, id, message) => changeStatus(scope, id, 'pending_approval', 'submit', message),

    async approve(scope, id, message) {
      if (scope.actor.type === 'agent') {
        throw new ArtifactError('PERMISSION_DENIED', t(locale, 'PERMISSION_DENIED', { action: 'approve' }));
      }
      const current = await load(scope, id);
      if (current.status !== 'pending_approval') {
        throw new ArtifactError(
          'PERMISSION_DENIED',
          t(locale, 'INVALID_STATUS_TRANSITION', { from: current.status, to: 'published' }),
        );
      }
      return changeStatus(scope, id, 'published', 'approve', message);
    },

    async reject(scope, id, reason) {
      if (scope.actor.type === 'agent') {
        throw new ArtifactError('PERMISSION_DENIED', t(locale, 'PERMISSION_DENIED', { action: 'reject' }));
      }
      const current = await load(scope, id);
      if (current.status !== 'pending_approval') {
        throw new ArtifactError(
          'PERMISSION_DENIED',
          t(locale, 'INVALID_STATUS_TRANSITION', { from: current.status, to: 'draft' }),
        );
      }
      return changeStatus(scope, id, 'draft', 'reject', reason);
    },

    async publish(scope, id) {
      if (policy.requireApprovalToPublish) {
        throw new ArtifactError('APPROVAL_REQUIRED', t(locale, 'APPROVAL_REQUIRED', { action: 'publish' }), {
          issues: [
            {
              path: 'id',
              message: t(locale, 'APPROVAL_REQUIRED', { action: 'publish' }),
              hint: t(locale, 'APPROVAL_REQUIRED_HINT'),
            },
          ],
        });
      }
      return changeStatus(scope, id, 'published', 'publish');
    },

    archive: (scope, id) => changeStatus(scope, id, 'archived', 'archive'),

    async lock(scope, id, ttlMs = 5 * 60_000) {
      const current = await load(scope, id);
      await authorize('lock', summarize(current), scope);
      return store.lock(scope, id, scope.actor, ttlMs);
    },

    unlock: (scope, lock) => store.unlock(scope, lock),

    async getLock(scope, id) {
      const current = await load(scope, id);
      await authorize('read', summarize(current), scope);
      return store.getLock(scope, id);
    },

    async export(scope, request) {
      const started = Date.now();
      const artifact = await load(scope, request.artifactId, request.version);
      await authorize('export', summarize(artifact), scope);
      if (policy.requireApprovalToExport && artifact.status !== 'published') {
        throw new ArtifactError('APPROVAL_REQUIRED', t(locale, 'APPROVAL_REQUIRED', { action: 'export' }), {
          issues: [
            {
              path: 'artifactId',
              message: t(locale, 'APPROVAL_REQUIRED', { action: 'export' }),
              hint: t(locale, 'APPROVAL_REQUIRED_HINT'),
            },
          ],
        });
      }
      const exporter = registry.exporter(artifact.kind, request.format, locale);
      const warnings: string[] = [];
      const timeout = AbortSignal.timeout(request.timeoutMs ?? options.exportTimeoutMs ?? 60_000);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      let bytes: Uint8Array;
      try {
        bytes = await raceAbort(
          exporter.export(artifact.content, {
            title: artifact.title,
            theme: registry.theme(artifact.themeId, locale),
            locale: artifact.locale,
            assets: service.assetResolver(scope),
            logger,
            signal,
            warn: (message) => warnings.push(message),
            ...(request.options ? { options: request.options } : {}),
          }),
          signal,
        );
      } catch (cause) {
        metrics.rejection?.('EXPORT_FAILED', fields(artifact, scope, { format: request.format }));
        logger.error('artifact.export_failed', fields(artifact, scope, { format: request.format }));
        throw new ArtifactError('EXPORT_FAILED', t(locale, 'EXPORT_FAILED', { format: request.format }), {
          cause,
        });
      }
      const filename = `${slugify(artifact.title)}.${exporter.extension}`;
      const result: ExportResult = {
        bytes,
        mimeType: exporter.mimeType,
        extension: exporter.extension,
        filename,
        warnings,
      };
      if (request.saveToAssets && !options.assets) {
        throw new ArtifactError('EXPORT_FAILED', t(locale, 'EXPORT_FAILED', { format: request.format }), {
          cause: new Error('saveToAssets requires an AssetStore: pass createArtifactService({ assets })'),
        });
      }
      if (request.saveToAssets && options.assets) {
        const stored = await options.assets.put(scope, bytes, {
          mimeType: exporter.mimeType,
          filename,
          origin: 'generated',
        });
        result.asset = { ref: stored.ref, size: stored.size, hash: stored.hash };
      }
      const duration = Date.now() - started;
      metrics.exportDuration?.(
        duration,
        fields(artifact, scope, { format: request.format, durationMs: duration }),
      );
      events.emit({
        type: 'artifact.exported',
        artifact: summarize(artifact),
        format: request.format,
        actor: scope.actor,
        warnings: warnings.length,
      });
      return result;
    },

    assetResolver(scope) {
      return {
        async resolve(ref) {
          if (!options.assets)
            throw new ArtifactError('NOT_FOUND', t(locale, 'NOT_FOUND', { what: 'Asset', id: ref }));
          return options.assets.get(scope, ref);
        },
      };
    },
  };
  return service;
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'artifact';
}

export { deepEqual, envelopeOperationSchema };
