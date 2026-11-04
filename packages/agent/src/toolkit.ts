import {
  type AnyArtifactKind,
  type ApprovalPolicy,
  type Artifact,
  ArtifactError,
  type ArtifactRegistry,
  type ArtifactService,
  type ArtifactStatus,
  type ArtifactStore,
  type ArtifactSummary,
  type AssetStore,
  type AuthorizeFn,
  type ChangeSummary,
  createArtifactService,
  type ErrorCode,
  type EventBus,
  estimateTokens,
  type JsonSchema,
  type LintIssue,
  type Logger,
  type ModelErrorPayload,
  type SchemaProfile,
  type Scope,
  silentLogger,
  t,
  toJsonSchema,
  toModelError,
  zodIssuesToErrorIssues,
} from '@artkit-ai/core';
import type { z } from 'zod';
import { type InstructionOptions, renderInstructions } from './instructions.js';
import { applyToolName, selectKinds } from './kind-doc.js';
import { msg } from './messages.js';
import {
  applySchemas,
  createSchemas,
  exportSchema,
  guideSchema,
  listSchema,
  readSchema,
  submitSchema,
  type ToolSchemas,
} from './schemas.js';
import {
  guidePath,
  guideTopics,
  type RenderSkillsOptions,
  renderSkills,
  type SkillFile,
  stripFrontmatter,
} from './skills.js';

/** Reference carried by chat messages and data parts: never the content (spec §14.4). */
export interface ArtifactReference {
  id: string;
  kind: string;
  title: string;
  version: number;
  status: ArtifactStatus;
}

/** Events a tool hands to the harness adapter while executing (e.g. to emit UI data parts). */
export type ToolkitEvent = { type: 'artifact'; tool: string; artifact: ArtifactReference };

/** Execution context supplied by the harness. Scope never comes from model arguments (spec §16). */
export interface ToolExecutionContext {
  scope: Scope;
  /** The harness tool call id; used as idempotency key for create and apply. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  emit?(event: ToolkitEvent): void;
}

export interface CreateToolOutput extends ArtifactReference {
  ok: true;
  createdIds: string[];
  lint: LintIssue[];
  replayed: boolean;
}

export interface ReadToolOutput extends ArtifactReference {
  ok: true;
  mode: 'outline' | 'full' | 'range';
  truncated: boolean;
  cursor?: string;
  /** Estimated tokens of `text`. */
  tokens: number;
  /** Projection wrapped in `<artifact-content>` data markers. */
  text: string;
}

export interface ApplyToolOutput extends ArtifactReference {
  ok: true;
  createdIds: string[];
  diff: ChangeSummary[];
  lint: LintIssue[];
  rebased: boolean;
  replayed: boolean;
}

export interface ExportToolOutput extends ArtifactReference {
  ok: true;
  format: string;
  asset: { ref: string; filename: string; mimeType: string; size: number };
  warnings: string[];
}

export interface ListToolOutput {
  ok: true;
  items: ArtifactSummary[];
  nextCursor?: string;
}

export interface SubmitToolOutput extends ArtifactReference {
  ok: true;
}

export interface GuideToolOutput {
  ok: true;
  topic: string;
  content: string;
}

export type ToolSuccess =
  | CreateToolOutput
  | ReadToolOutput
  | ApplyToolOutput
  | ExportToolOutput
  | ListToolOutput
  | SubmitToolOutput
  | GuideToolOutput;

export type ToolResult = ToolSuccess | ModelErrorPayload;

/** Harness-neutral tool definition. Adapters (AI SDK, MCP) wrap it without changing names or schemas. */
export interface ArtifactTool {
  name: string;
  description: string;
  /** JSON Schema of the input in the toolkit's profile. */
  inputSchema: JsonSchema;
  /** Zod schema the JSON Schema was generated from (what the model is asked to produce). */
  zodSchema: z.ZodType;
  /** True for tools without side effects (read, list, guide). */
  readOnly: boolean;
  /** Set on `artifact_apply_<kind>` tools. */
  kind?: string;
  /** Present when the approval policy may require a human decision before `execute`. */
  needsApproval?(input: unknown, ctx: ToolExecutionContext): Promise<boolean>;
  /** Never throws for model or domain errors: they come back as `{ ok: false, error }`. */
  execute(input: unknown, ctx: ToolExecutionContext): Promise<ToolResult>;
}

export interface ApprovalOptions {
  /** `artifact_submit` (default `always`). */
  submit?: 'always' | 'never';
  /** `artifact_apply` (default `never`); `published` asks only when editing a published artifact. */
  apply?: 'never' | 'published' | 'always';
  /** `artifact_export` (default `never`). */
  export?: 'never' | 'always';
}

interface ToolkitBaseOptions {
  /** Mandatory authorization hook (spec §16). */
  authorize: AuthorizeFn;
  assets?: AssetStore;
  logger?: Logger;
  events?: EventBus;
  approval?: ApprovalOptions;
  /** Locale of model-facing messages (`pt-BR` or `en`, default `en`). */
  locale?: string;
  /** Locale of artifacts created without an explicit `locale` (default: `locale`). */
  defaultArtifactLocale?: string;
  schemaProfile?: SchemaProfile;
  /** `per-kind` generates `artifact_apply_<kind>` tools for providers with schema size limits. */
  applyMode?: 'union' | 'per-kind';
  read?: { defaultMaxTokens?: number; maxTokens?: number };
  /** Kinds exposed to the model (default: every registered kind). */
  kinds?: string[];
  /** Service lifecycle policy (approval to publish, export or edit published artifacts). */
  policy?: Partial<ApprovalPolicy>;
}

export type ArtifactToolkitOptions = ToolkitBaseOptions &
  (
    | { registry: ArtifactRegistry; store: ArtifactStore; service?: undefined }
    /**
     * A pre-built service (e.g. shared with HTTP routes). It must have been created with the same `authorize`
     * hook; the toolkit cannot add authorization to an existing service.
     */
    | { service: ArtifactService; registry?: ArtifactRegistry; store?: undefined }
  );

export interface ArtifactToolkit {
  readonly tools: ArtifactTool[];
  readonly service: ArtifactService;
  readonly registry: ArtifactRegistry;
  readonly locale: string;
  readonly schemaProfile: SchemaProfile;
  tool(name: string): ArtifactTool | undefined;
  /** System prompt block for the enabled kinds (spec §14.3). */
  instructions(options?: InstructionOptions): string;
  /** Agent Skills files (`artkit-artefatos/`, `artkit-integracao/`) for the application to write to disk. */
  skills(options?: Omit<RenderSkillsOptions, 'kinds' | 'applyMode'>): SkillFile[];
  /** Body of a guide topic (`overview`, a kind, `themes`, `errors`), or undefined. */
  guide(topic: string): string | undefined;
  guideTopics(): string[];
}

const DEFAULT_MAX_TOKENS = 6000;
const DEFAULT_MAX_TOKENS_CAP = 32_000;
const CREATE_REPLAY_CAPACITY = 1000;

// Free-form payloads keep their nulls under the strict profile: null can be meaningful content there.
const FREE_FORM_KEYS = new Set(['content', 'source']);

function stripModelNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripModelNulls);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === null) continue;
      out[key] = FREE_FORM_KEYS.has(key) ? item : stripModelNulls(item);
    }
    return out;
  }
  return value;
}

function isScope(value: unknown): value is Scope {
  const scope = value as Scope | undefined;
  return (
    typeof scope?.workspaceId === 'string' &&
    scope.workspaceId.length > 0 &&
    typeof scope.actor?.id === 'string' &&
    ['agent', 'user', 'system'].includes(scope.actor?.type)
  );
}

function reference(
  artifact: Pick<Artifact, 'id' | 'kind' | 'title' | 'version' | 'status'>,
): ArtifactReference {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    version: artifact.version,
    status: artifact.status,
  };
}

/**
 * Builds the harness-neutral artifact tools (spec §14.1–14.2) on top of the core service pipeline.
 */
export function createArtifactToolkit(options: ArtifactToolkitOptions): ArtifactToolkit {
  if (typeof options.authorize !== 'function') {
    throw new Error('@artkit-ai/agent: `authorize` is mandatory (spec §16).');
  }
  const locale = options.locale ?? 'en';
  const logger = options.logger ?? silentLogger;
  const profile: SchemaProfile = options.schemaProfile ?? 'default';
  const applyMode = options.applyMode ?? 'union';
  const approval: Required<ApprovalOptions> = {
    submit: 'always',
    apply: 'never',
    export: 'never',
    ...options.approval,
  };
  const defaultMaxTokens = options.read?.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTokensCap = Math.max(options.read?.maxTokens ?? DEFAULT_MAX_TOKENS_CAP, defaultMaxTokens);

  const service: ArtifactService =
    options.service ??
    createArtifactService({
      registry: options.registry,
      store: options.store,
      authorize: options.authorize,
      locale,
      defaultArtifactLocale: options.defaultArtifactLocale ?? locale,
      ...(options.assets ? { assets: options.assets } : {}),
      ...(options.events ? { events: options.events } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.policy ? { policy: options.policy } : {}),
    });
  const registry = options.registry ?? service.registry;
  const kinds = selectKinds(registry, options.kinds);
  if (kinds.length === 0) throw new Error('@artkit-ai/agent: the registry has no kinds to expose.');
  const kindNames = kinds.map((kind) => kind.kind);
  const topics = guideTopics(registry, kindNames);
  const exportFormats = [
    ...new Set(
      registry
        .exporters()
        .filter((e) => kindNames.includes(e.kind))
        .map((e) => e.format),
    ),
  ];
  // Export needs somewhere to put the file: models receive an asset reference, never bytes.
  const canExport =
    exportFormats.length > 0 && (options.assets !== undefined || options.service !== undefined);

  // Core service.create has no idempotency lookup (stores index keys per artifact), so creates are deduped here.
  const createReplays = new Map<string, CreateToolOutput>();
  const rememberCreate = (key: string, output: CreateToolOutput) => {
    createReplays.set(key, output);
    if (createReplays.size > CREATE_REPLAY_CAPACITY)
      createReplays.delete(createReplays.keys().next().value as string);
  };
  const replayKey = (scope: Scope, key: string) =>
    `${scope.workspaceId}\u0000${scope.actor.type}:${scope.actor.id}\u0000${key}`;

  let skillCache: SkillFile[] | undefined;
  const skillFiles = () => {
    skillCache ??= renderSkills(registry, { kinds: kindNames, applyMode });
    return skillCache;
  };

  function failure(
    code: ErrorCode,
    message: string,
    issues?: { path: string; message: string; hint?: string }[],
  ): ModelErrorPayload {
    return new ArtifactError(code, message, issues ? { issues } : {}).toPayload();
  }

  interface Definition<Input> {
    name: string;
    description: string;
    schemas: ToolSchemas;
    readOnly: boolean;
    invalidCode: ErrorCode;
    kind?: string;
    needsApproval?: (input: Input, ctx: ToolExecutionContext) => Promise<boolean>;
    run: (input: Input, ctx: ToolExecutionContext) => Promise<ToolSuccess>;
  }

  function define<Input>(definition: Definition<Input>): ArtifactTool {
    const parse = (input: unknown): { ok: true; data: Input } | { ok: false; error: ModelErrorPayload } => {
      const prepared = profile === 'strict' ? stripModelNulls(input) : input;
      const parsed = definition.schemas.parse.safeParse(prepared ?? {});
      if (parsed.success) return { ok: true, data: parsed.data as Input };
      return {
        ok: false,
        error: failure(
          definition.invalidCode,
          msg(locale, 'INVALID_ARGUMENTS', { tool: definition.name }),
          zodIssuesToErrorIssues(parsed.error.issues, locale),
        ),
      };
    };
    const tool: ArtifactTool = {
      name: definition.name,
      description: definition.description,
      inputSchema: toJsonSchema(definition.schemas.model, profile),
      zodSchema: definition.schemas.model,
      readOnly: definition.readOnly,
      ...(definition.kind ? { kind: definition.kind } : {}),
      async execute(input, ctx) {
        if (!isScope(ctx?.scope)) {
          logger.error('artifact tool called without scope', { tool: definition.name });
          return failure('PERMISSION_DENIED', msg(locale, 'MISSING_SCOPE'));
        }
        const parsed = parse(input);
        if (!parsed.ok) return parsed.error;
        try {
          return await definition.run(parsed.data, ctx);
        } catch (error) {
          const payload = toModelError(error, locale);
          const level = payload.error.code === 'INTERNAL_ERROR' ? 'error' : 'warn';
          logger[level]('artifact tool failed', {
            tool: definition.name,
            code: payload.error.code,
            actorType: ctx.scope.actor.type,
          });
          return payload;
        }
      },
    };
    if (definition.needsApproval) {
      const decide = definition.needsApproval;
      tool.needsApproval = async (input, ctx) => {
        if (!isScope(ctx?.scope)) return true;
        const parsed = parse(input);
        // Invalid input never executes anything, so there is nothing to approve.
        if (!parsed.ok) return false;
        try {
          return await decide(parsed.data, ctx);
        } catch {
          return false;
        }
      };
    }
    return tool;
  }

  const emit = (ctx: ToolExecutionContext, tool: string, artifact: ArtifactReference) => {
    try {
      ctx.emit?.({ type: 'artifact', tool, artifact });
    } catch (error) {
      // A broken UI writer must not turn a committed change into a reported failure.
      logger.warn('artifact event emitter failed', { tool, artifactId: artifact.id, code: String(error) });
    }
  };

  type CreateInput = {
    kind: string;
    title: string;
    content?: unknown;
    input?: { format: string; source: unknown };
    locale?: string;
    themeId?: string;
  };

  const tools: ArtifactTool[] = [];

  tools.push(
    define<CreateInput>({
      name: 'artifact_create',
      description:
        'Create an artifact from full content or from a source input (Markdown, CSV, Mermaid). Returns its id and version.',
      schemas: createSchemas(registry, kinds),
      readOnly: false,
      invalidCode: 'INVALID_CONTENT',
      async run(input, ctx) {
        if (input.content !== undefined && input.input !== undefined) {
          throw new ArtifactError('INVALID_CONTENT', msg(locale, 'CONTENT_AND_INPUT'), {
            issues: [
              {
                path: 'input',
                message: msg(locale, 'CONTENT_AND_INPUT'),
                hint: msg(locale, 'CONTENT_AND_INPUT_HINT'),
              },
            ],
          });
        }
        if (!kindNames.includes(input.kind)) {
          // Kinds registered but not exposed to this agent are reported as unknown.
          const message = t(locale, 'UNKNOWN_KIND', { kind: input.kind });
          throw new ArtifactError('UNKNOWN_KIND', message, {
            issues: [
              {
                path: 'kind',
                message,
                hint: t(locale, 'UNKNOWN_KIND_HINT', { available: kindNames.join(', ') }),
              },
            ],
          });
        }
        const key = ctx.idempotencyKey ? replayKey(ctx.scope, ctx.idempotencyKey) : undefined;
        const previous = key ? createReplays.get(key) : undefined;
        if (previous) return { ...previous, replayed: true };
        const result = await service.create(ctx.scope, {
          kind: input.kind,
          title: input.title,
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.input ? { input: input.input } : {}),
          ...(input.locale ? { locale: input.locale } : {}),
          ...(input.themeId ? { themeId: input.themeId } : {}),
          ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
        });
        const ref = reference(result.artifact);
        const output: CreateToolOutput = {
          ok: true,
          ...ref,
          createdIds: result.createdIds,
          lint: result.lint,
          replayed: false,
        };
        if (key) rememberCreate(key, output);
        emit(ctx, 'artifact_create', ref);
        return output;
      },
    }),
  );

  type ReadInput = {
    id: string;
    mode: 'outline' | 'full' | 'range';
    range?: string;
    maxTokens?: number;
    cursor?: string;
    version?: number;
  };
  tools.push(
    define<ReadInput>({
      name: 'artifact_read',
      description: 'Read an artifact as text. Start with mode "outline" to get ids and the current version.',
      schemas: readSchema(maxTokensCap),
      readOnly: true,
      invalidCode: 'INVALID_CONTENT',
      async run(input, ctx) {
        const result = await service.read(ctx.scope, input.id, {
          mode: input.mode,
          maxTokens: input.maxTokens ?? defaultMaxTokens,
          ...(input.range !== undefined ? { range: input.range } : {}),
          ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
          ...(input.version !== undefined ? { version: input.version } : {}),
        });
        return {
          ok: true,
          ...reference(result.artifact),
          mode: input.mode,
          truncated: result.projection.truncated,
          ...(result.projection.cursor ? { cursor: result.projection.cursor } : {}),
          tokens: estimateTokens(result.text),
          text: result.text,
        } satisfies ReadToolOutput;
      },
    }),
  );

  type ApplyInput = { id: string; baseVersion: number; operations: unknown[]; message?: string };
  const applyRun = (expectedKind?: string) => async (input: ApplyInput, ctx: ToolExecutionContext) => {
    if (expectedKind) {
      const current = await service.get(ctx.scope, input.id);
      if (current.kind !== expectedKind) {
        const message = msg(locale, 'KIND_MISMATCH', {
          id: input.id,
          actual: current.kind,
          expected: expectedKind,
        });
        throw new ArtifactError('INVALID_OPERATION', message, {
          issues: [
            {
              path: 'id',
              message,
              hint: msg(locale, 'KIND_MISMATCH_HINT', { tool: applyToolName(current.kind) }),
            },
          ],
        });
      }
    }
    const result = await service.apply(ctx.scope, {
      artifactId: input.id,
      baseVersion: input.baseVersion,
      operations: input.operations,
      ...(input.message ? { message: input.message } : {}),
      ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
    });
    const ref = reference(result.artifact);
    emit(ctx, expectedKind ? applyToolName(expectedKind) : 'artifact_apply', ref);
    return {
      ok: true,
      ...ref,
      createdIds: result.createdIds,
      diff: result.diff,
      lint: result.lint,
      rebased: result.rebased,
      replayed: result.replayed,
    } satisfies ApplyToolOutput;
  };
  const applyApproval =
    approval.apply === 'never'
      ? undefined
      : async (input: ApplyInput, ctx: ToolExecutionContext) => {
          if (approval.apply === 'always') return true;
          const current = await service.get(ctx.scope, input.id);
          return current.status === 'published';
        };
  const applyKinds: (AnyArtifactKind | undefined)[] = applyMode === 'per-kind' ? kinds : [undefined];
  for (const kind of applyKinds) {
    tools.push(
      define<ApplyInput>({
        name: kind ? applyToolName(kind.kind) : 'artifact_apply',
        description: kind
          ? `Apply a batch of ${kind.label} operations to a "${kind.kind}" artifact. Pass the latest version as baseVersion.`
          : 'Apply a batch of operations to an artifact atomically. Pass the latest version as baseVersion.',
        schemas: applySchemas(registry, kind ? [kind] : kinds),
        readOnly: false,
        invalidCode: 'INVALID_OPERATION',
        ...(kind ? { kind: kind.kind } : {}),
        ...(applyApproval ? { needsApproval: applyApproval } : {}),
        run: applyRun(kind?.kind),
      }),
    );
  }

  if (canExport) {
    type ExportInput = { id: string; format: string; version?: number };
    tools.push(
      define<ExportInput>({
        name: 'artifact_export',
        description:
          'Export an artifact to a file. Returns a file reference and fidelity warnings, never the bytes.',
        schemas: exportSchema(exportFormats),
        readOnly: false,
        invalidCode: 'INVALID_CONTENT',
        ...(approval.export === 'always' ? { needsApproval: async () => true } : {}),
        async run(input, ctx) {
          const result = await service.export(ctx.scope, {
            artifactId: input.id,
            format: input.format,
            saveToAssets: true,
            ...(input.version !== undefined ? { version: input.version } : {}),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          if (!result.asset) throw new ArtifactError('EXPORT_FAILED', msg(locale, 'EXPORT_UNAVAILABLE'));
          const artifact = await service.get(
            ctx.scope,
            input.id,
            input.version !== undefined ? { version: input.version } : undefined,
          );
          return {
            ok: true,
            ...reference(artifact),
            format: input.format,
            asset: {
              ref: result.asset.ref,
              filename: result.filename,
              mimeType: result.mimeType,
              size: result.asset.size,
            },
            warnings: result.warnings,
          } satisfies ExportToolOutput;
        },
      }),
    );
  }

  type ListInput = { kind?: string; status?: ArtifactStatus; title?: string; limit: number; cursor?: string };
  tools.push(
    define<ListInput>({
      name: 'artifact_list',
      description: 'List artifacts visible to you, newest first, with id, title, kind, version and status.',
      schemas: listSchema(kinds),
      readOnly: true,
      invalidCode: 'INVALID_CONTENT',
      async run(input, ctx) {
        const page = await service.list(
          ctx.scope,
          {
            ...(input.kind ? { kind: input.kind } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.title ? { title: input.title } : {}),
          },
          { limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) },
        );
        const items = page.items.filter((item) => kindNames.includes(item.kind));
        return {
          ok: true,
          items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        } satisfies ListToolOutput;
      },
    }),
  );

  type SubmitInput = { id: string; message?: string };
  tools.push(
    define<SubmitInput>({
      name: 'artifact_submit',
      description:
        'Submit an artifact for human approval. Use only when the user asks to publish or send it for review.',
      schemas: submitSchema(),
      readOnly: false,
      invalidCode: 'INVALID_CONTENT',
      ...(approval.submit === 'always' ? { needsApproval: async () => true } : {}),
      async run(input, ctx) {
        const artifact = await service.submit(ctx.scope, input.id, input.message);
        const ref = reference(artifact);
        emit(ctx, 'artifact_submit', ref);
        return { ok: true, ...ref } satisfies SubmitToolOutput;
      },
    }),
  );

  const guide = (topic: string): string | undefined => {
    if (!topics.includes(topic)) return undefined;
    const file = skillFiles().find((candidate) => candidate.path === guidePath(topic));
    return file ? stripFrontmatter(file.content) : undefined;
  };

  tools.push(
    define<{ topic: string }>({
      name: 'artifact_guide',
      description: 'Get a detailed guide: "overview", a kind name, "themes" or "errors".',
      schemas: guideSchema(topics),
      readOnly: true,
      invalidCode: 'INVALID_CONTENT',
      async run(input) {
        const content = guide(input.topic);
        if (content === undefined) {
          throw new ArtifactError('NOT_FOUND', `Guide topic not found: ${input.topic}.`, {
            issues: [
              {
                path: 'topic',
                message: `Guide topic not found: ${input.topic}.`,
                hint: msg(locale, 'GUIDE_TOPIC_HINT', { topics: topics.join(', ') }),
              },
            ],
          });
        }
        return { ok: true, topic: input.topic, content } satisfies GuideToolOutput;
      },
    }),
  );

  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    tools,
    service,
    registry,
    locale,
    schemaProfile: profile,
    tool: (name) => byName.get(name),
    instructions: (instructionOptions = {}) =>
      renderInstructions(
        { registry, applyMode, guideTopics: topics, hasExport: canExport },
        {
          ...instructionOptions,
          kinds: instructionOptions.kinds?.filter((kind) => kindNames.includes(kind)) ?? kindNames,
        },
      ),
    skills: (skillOptions = {}) =>
      Object.keys(skillOptions).length === 0
        ? skillFiles()
        : renderSkills(registry, { ...skillOptions, kinds: kindNames, applyMode }),
    guide,
    guideTopics: () => [...topics],
  };
}
