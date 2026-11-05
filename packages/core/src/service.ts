import type { AnyFormatAdapter, ChangeSummary, LintIssue } from './adapter.js';
import type { AssetRef, AssetResolver } from './assets.js';
import { applyOperations, type BatchResult, prepareContent } from './engine.js';
import { type Artifact, type ArtifactSummary, summarize, titleSchema } from './envelope.js';
import { ArtifactError, zodIssuesToErrorIssues } from './errors.js';
import { createEventBus, type EventBus } from './events.js';
import { t } from './i18n.js';
import { type LogFields, type Logger, type MetricsHooks, silentLogger } from './logger.js';
import { migrateContent } from './migrations.js';
import { delimitProjection, type Projection, type ProjectionOptions } from './projection.js';
import type { ArtifactRegistry } from './registry.js';
import { sanitizeDeep } from './sanitize.js';
import type { ArtifactFilter, ArtifactStore, AssetStore, Lock, Page, PageRequest, Scope } from './store.js';

export type ArtifactAction = 'create' | 'read' | 'apply' | 'export' | 'list' | 'lock';

/** Mandatory authorization hook in toolkits (spec §16 and §15.1). Return false to deny. */
export type AuthorizeFn = (
  action: ArtifactAction,
  artifact: ArtifactSummary | null,
  scope: Scope,
) => boolean | Promise<boolean>;

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
  /** Default export timeout (default 60s). */
  exportTimeoutMs?: number;
}

export interface CreateRequest {
  format: string;
  title: string;
  /** Native content: Markdown text, OpenUI Lang text or an `IWorkbookData` object (spec §15.1). */
  content?: unknown;
  /** Initial batch applied on the adapter's empty content, e.g. the first operations of a sheet. */
  operations?: unknown[];
  locale?: string;
  themeId?: string;
  tags?: string[];
}

export interface CommitResult {
  artifact: Artifact;
  version: number;
  createdRefs: string[];
  diff: ChangeSummary[];
  lint: LintIssue[];
}

export interface ApplyRequest {
  artifactId: string;
  /** Version the operations were computed against. Anything else than the current version is a VERSION_CONFLICT. */
  baseVersion: number;
  operations: unknown[];
}

export interface ArtifactReadResult {
  artifact: ArtifactSummary;
  version: number;
  projection: Projection;
  /** Projection wrapped in data delimiters, ready to hand to a model. */
  text: string;
}

export interface ExportRequest {
  artifactId: string;
  /** Target file format: `docx`, `xlsx`, `pptx`, `pdf`, `png`, `html`, `md`, `csv`… */
  format: string;
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
  get(scope: Scope, id: string): Promise<Artifact>;
  read(scope: Scope, id: string, options?: Partial<ProjectionOptions>): Promise<ArtifactReadResult>;
  apply(scope: Scope, request: ApplyRequest): Promise<CommitResult>;
  /** Pure dry run on the current version: validates and returns diff/lint without committing. */
  preview(scope: Scope, request: ApplyRequest): Promise<BatchResult>;
  list(scope: Scope, filter?: ArtifactFilter, page?: PageRequest): Promise<Page<ArtifactSummary>>;
  lock(scope: Scope, id: string, ttlMs?: number): Promise<Lock>;
  unlock(scope: Scope, lock: Lock): Promise<void>;
  /** Current lock holder, or null; lets UIs show who is editing before trying to write. */
  getLock(scope: Scope, id: string): Promise<Lock | null>;
  export(scope: Scope, request: ExportRequest): Promise<ExportResult>;
  /** Resolver over the asset store, scoped (used by exporters and renderers). */
  assetResolver(scope: Scope): AssetResolver;
}

/**
 * The core pipeline (spec §9.1): authorization, migration, baseVersion check, atomic apply, optimistic commit, events
 * and metadata-only logging. There is no history, approval or archive here: the harness decides what a save means.
 */
export function createArtifactService(options: ArtifactServiceOptions): ArtifactService {
  const { registry, store } = options;
  const locale = options.locale ?? 'en';
  const logger = options.logger ?? silentLogger;
  const metrics = options.metrics ?? {};
  const events =
    options.events ??
    createEventBus((error) => logger.error('event handler failed', { code: String(error) }));

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

  async function load(scope: Scope, id: string): Promise<Artifact> {
    const found = await store.get(scope, id);
    if (!found) {
      throw new ArtifactError('NOT_FOUND', t(locale, 'NOT_FOUND', { what: 'Artifact', id }), {
        issues: [
          {
            path: 'id',
            message: t(locale, 'NOT_FOUND', { what: 'Artifact', id }),
            hint: t(locale, 'NOT_FOUND_HINT'),
          },
        ],
      });
    }
    return migrated(found);
  }

  function migrated(artifact: Artifact): Artifact {
    const adapter = registry.get(artifact.format, locale);
    const result = migrateContent(adapter, artifact.content, artifact.formatVersion, locale);
    return result.migrated
      ? { ...artifact, content: result.content, formatVersion: result.formatVersion }
      : artifact;
  }

  function fields(
    artifact: Pick<Artifact, 'id' | 'format' | 'version'>,
    scope: Scope,
    extra: LogFields = {},
  ): LogFields {
    return {
      artifactId: artifact.id,
      format: artifact.format,
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

  /** The batch must be computed against the current version; a stale base is a conflict, never a silent rebase. */
  function assertBase(scope: Scope, current: Artifact, baseVersion: number): void {
    if (baseVersion === current.version) return;
    metrics.conflict?.(fields(current, scope));
    events.emit({
      type: 'artifact.conflict',
      artifactId: current.id,
      baseVersion,
      currentVersion: current.version,
      actor: scope.actor,
    });
    const message = t(locale, 'VERSION_CONFLICT', { baseVersion, currentVersion: current.version });
    throw new ArtifactError('VERSION_CONFLICT', message, {
      issues: [
        {
          path: 'baseVersion',
          message,
          hint: t(locale, 'VERSION_CONFLICT_HINT'),
        },
      ],
      details: { currentVersion: current.version },
    });
  }

  const service: ArtifactService = {
    registry,
    events,

    async create(scope, request) {
      await authorize('create', null, scope);
      const adapter = registry.get(request.format, locale);
      const title = titleSchema.safeParse(sanitizeDeep(request.title));
      if (!title.success) {
        throw new ArtifactError('INVALID_CONTENT', t(locale, 'INVALID_CONTENT'), {
          issues: zodIssuesToErrorIssues(title.error.issues, locale, 'title'),
        });
      }
      const artifactLocale = request.locale ?? options.defaultArtifactLocale ?? 'en';
      const themeId = request.themeId ?? options.defaultThemeId ?? 'default';
      registry.theme(themeId, locale);
      const base = {
        id: '',
        format: adapter.format,
        formatVersion: adapter.formatVersion,
        version: 1,
        title: title.data,
        locale: artifactLocale,
        themeId,
        content: request.content ?? adapter.empty(),
      };
      // Creation with an initial batch goes through the same pipeline as any edit.
      const applied = request.operations?.length
        ? await applyOperations(registry, base as Artifact, request.operations, { locale })
        : undefined;
      const prepared = applied
        ? { content: applied.content, lint: applied.lint }
        : prepareContent(registry, request.format, base.content, { locale: artifactLocale, themeId });
      const artifact = await store.create(scope, {
        format: adapter.format,
        formatVersion: adapter.formatVersion,
        title: title.data,
        locale: artifactLocale,
        themeId,
        content: prepared.content,
        ...(request.tags ? { tags: request.tags } : {}),
      });
      events.emit({ type: 'artifact.created', artifact: summarize(artifact), actor: scope.actor });
      if (prepared.lint.length > 0) {
        events.emit({
          type: 'artifact.lint',
          artifactId: artifact.id,
          version: artifact.version,
          warnings: prepared.lint.length,
        });
      }
      logger.info('artifact.created', fields(artifact, scope));
      return {
        artifact,
        version: artifact.version,
        createdRefs: applied?.createdRefs ?? [],
        diff: [
          {
            type: 'added',
            target: `artifact:${artifact.id}`,
            summary: `${adapter.label} "${artifact.title}"`,
          },
        ],
        lint: prepared.lint,
      };
    },

    async get(scope, id) {
      const artifact = await load(scope, id);
      await authorize('read', summarize(artifact), scope);
      return artifact;
    },

    async read(scope, id, opts = {}) {
      const artifact = await load(scope, id);
      await authorize('read', summarize(artifact), scope);
      const adapter = registry.get(artifact.format, locale);
      const result = adapter.read(artifact.content as never, {
        mode: opts.mode ?? 'outline',
        locale: artifact.locale,
        ...(opts.range === undefined ? {} : { range: opts.range }),
        ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
        ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
        ...(opts.charsPerToken === undefined ? {} : { charsPerToken: opts.charsPerToken }),
      });
      const projection: Projection = {
        text: result.text,
        truncated: result.truncated,
        ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
      };
      const header = `${adapter.label} "${artifact.title}" (id: ${artifact.id}, format: ${artifact.format}, version: ${artifact.version}, locale: ${artifact.locale})`;
      let text = `${header}\n${delimitProjection(artifact.id, projection.text)}`;
      if (projection.truncated) {
        text += `\n[truncated — continue with cursor "${projection.cursor}"]`;
      }
      return { artifact: summarize(artifact), version: artifact.version, projection, text };
    },

    async apply(scope, request) {
      const started = Date.now();
      const current = await load(scope, request.artifactId);
      await authorize('apply', summarize(current), scope);
      await assertNotLocked(scope, current.id);
      assertBase(scope, current, request.baseVersion);
      const result = await applyOperations(registry, current, request.operations, { locale });
      let committed: Artifact;
      try {
        committed = await store.commit(scope, current.id, {
          baseVersion: current.version,
          formatVersion: result.formatVersion,
          content: result.content,
          title: result.title,
          locale: result.locale,
          themeId: result.themeId,
        });
      } catch (error) {
        if (error instanceof ArtifactError) metrics.rejection?.(error.code, fields(current, scope));
        throw error;
      }
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
      });
      if (result.lint.length > 0) {
        events.emit({
          type: 'artifact.lint',
          artifactId: committed.id,
          version: committed.version,
          warnings: result.lint.length,
        });
      }
      return {
        artifact: committed,
        version: committed.version,
        createdRefs: result.createdRefs,
        diff: result.diff,
        lint: result.lint,
      };
    },

    async preview(scope, request) {
      const current = await load(scope, request.artifactId);
      await authorize('read', summarize(current), scope);
      assertBase(scope, current, request.baseVersion);
      return applyOperations(registry, current, request.operations, { locale });
    },

    async list(scope, filter = {}, page = {}) {
      await authorize('list', null, scope);
      return store.list(scope, filter, page);
    },

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
      const artifact = await load(scope, request.artifactId);
      await authorize('export', summarize(artifact), scope);
      const exporter = registry.exporter(artifact.format, request.format, locale);
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
        metrics.rejection?.('EXPORT_FAILED', fields(artifact, scope, { target: request.format }));
        logger.error('artifact.export_failed', fields(artifact, scope, { target: request.format }));
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
        fields(artifact, scope, { target: request.format, durationMs: duration }),
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

export type { AnyFormatAdapter };
