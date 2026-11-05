import {
  type AnyFormatAdapter,
  type Artifact,
  type ArtifactRegistry,
  type ArtifactService,
  type ArtifactStore,
  type ArtifactSummary,
  type AssetStore,
  type AuthorizeFn,
  type ChangeSummary,
  type CommitResult,
  createArtifactService,
  type EventBus,
  EXPORT_FORMATS,
  isArtifactError,
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
} from '@artkit-ai/core';
import type { z } from 'zod';
import { type InstructionOptions, renderInstructions } from './instructions.js';
import { msg } from './messages.js';
import { applySchema, createSchema, exportSchema, guideSchema, listSchema, readSchema } from './schemas.js';
import { guideBody, guideTopics, type RenderSkillsOptions, renderSkills, type SkillFile } from './skills.js';

/** Reference carried by chat messages and data parts: never the content (spec §15.3). */
export interface ArtifactReference {
  id: string;
  format: string;
  title: string;
  version: number;
}

/** Events a tool hands to the harness adapter while executing (e.g. to emit UI data parts). */
export type ToolkitEvent = { type: 'artifact'; tool: string; artifact: ArtifactReference };

/** Execution context supplied by the harness. Scope never comes from model arguments (spec §18). */
export interface ToolExecutionContext {
  scope: Scope;
  signal?: AbortSignal;
  emit?(event: ToolkitEvent): void;
}

export interface CreateToolOutput extends ArtifactReference {
  ok: true;
  createdRefs: string[];
  lint: LintIssue[];
}

export interface ReadToolOutput extends ArtifactReference {
  ok: true;
  mode: string;
  truncated: boolean;
  cursor?: string;
  /** Projection wrapped in `<artifact-content>` data markers. */
  text: string;
}

export interface ApplyToolOutput extends ArtifactReference {
  ok: true;
  createdRefs: string[];
  diff: ChangeSummary[];
  lint: LintIssue[];
}

export interface ExportToolOutput extends ArtifactReference {
  ok: true;
  target: string;
  asset: { ref: string; filename: string; mimeType: string; size: number };
  warnings: string[];
}

export interface ListToolOutput {
  ok: true;
  items: ArtifactSummary[];
  nextCursor?: string;
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
  | GuideToolOutput;

export type ToolResult = ToolSuccess | ModelErrorPayload;

/** Harness-neutral tool definition. Adapters (AI SDK, MCP) wrap it without changing names or schemas. */
export interface ArtifactTool {
  name: string;
  description: string;
  /** JSON Schema of the input in the toolkit's profile. */
  inputSchema: JsonSchema;
  /** Zod schema the JSON Schema was generated from. */
  zodSchema: z.ZodType;
  /** True for tools without side effects (read, list, guide). */
  readOnly: boolean;
  /** Set on `artifact_apply_<format>` tools. */
  format?: string;
  /** Never throws for model or domain errors: they come back as `{ ok: false, error }`. */
  execute(input: unknown, ctx: ToolExecutionContext): Promise<ToolResult>;
}

interface ToolkitBaseOptions {
  /** Mandatory authorization hook (spec §18). */
  authorize: AuthorizeFn;
  assets?: AssetStore;
  logger?: Logger;
  events?: EventBus;
  /** Locale of model-facing messages (`pt-BR` or `en`, default `en`). */
  locale?: string;
  /** Locale of artifacts created without an explicit `locale` (default: `locale`). */
  defaultArtifactLocale?: string;
  schemaProfile?: SchemaProfile;
  /** `per-format` generates `artifact_apply_<format>` tools for providers with schema size limits. */
  applyMode?: 'union' | 'per-format';
  read?: { defaultMaxTokens?: number; maxTokens?: number };
  /** Formats exposed to the model (default: every registered format). */
  formats?: string[];
}

export type ArtifactToolkitOptions = ToolkitBaseOptions &
  (
    | { registry: ArtifactRegistry; store: ArtifactStore; service?: undefined }
    /** A pre-built service; it must have been created with the same `authorize` hook. */
    | { service: ArtifactService; registry?: ArtifactRegistry; store?: undefined }
  );

export interface ArtifactToolkit {
  readonly tools: ArtifactTool[];
  readonly service: ArtifactService;
  readonly registry: ArtifactRegistry;
  readonly locale: string;
  readonly schemaProfile: SchemaProfile;
  tool(name: string): ArtifactTool | undefined;
  /** System prompt block for the enabled formats. */
  instructions(options?: InstructionOptions): string;
  /** Agent Skills files (`artkit-artefatos/`, `artkit-integracao/`) for the application to write to disk. */
  skills(options?: Omit<RenderSkillsOptions, 'formats' | 'applyMode'>): SkillFile[];
  /** Body of a guide topic (`overview`, a format, `themes`, `errors`), or undefined. */
  guide(topic: string): string | undefined;
  guideTopics(): string[];
}

const DEFAULT_MAX_TOKENS = 6000;
const DEFAULT_MAX_TOKENS_CAP = 32_000;
/** Free-form payloads keep their nulls under the strict profile: null can be meaningful content there. */
const FREE_FORM_KEYS = new Set(['content', 'value', 'values', 'source', 'body', 'expr', 'text']);

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

function reference(artifact: Pick<Artifact, 'id' | 'format' | 'title' | 'version'>): ArtifactReference {
  return { id: artifact.id, format: artifact.format, title: artifact.title, version: artifact.version };
}

function failure(locale: string, _tool: string, error: unknown): ModelErrorPayload {
  if (isArtifactError(error)) return error.toPayload();
  return toModelError(error, locale);
}

/**
 * Builds the harness-neutral artifact tools (spec §15.1–15.2) on top of the core service pipeline: create, read, apply,
 * export, list and guide. Every tool returns a success object or the model error payload; nothing throws for domain
 * errors. There are no status, approval or history tools: saving is the harness's decision.
 */
export function createArtifactToolkit(options: ArtifactToolkitOptions): ArtifactToolkit {
  if (typeof options.authorize !== 'function')
    throw new Error('@artkit-ai/agent: `authorize` is mandatory (spec §18).');
  const locale = options.locale ?? 'en';
  const logger = options.logger ?? silentLogger;
  const profile: SchemaProfile = options.schemaProfile ?? 'default';
  const applyMode = options.applyMode ?? 'union';

  const service: ArtifactService =
    options.service ??
    createArtifactService({
      registry: options.registry!,
      store: options.store!,
      authorize: options.authorize,
      ...(options.assets ? { assets: options.assets } : {}),
      logger,
      ...(options.events ? { events: options.events } : {}),
      locale,
      ...(options.defaultArtifactLocale ? { defaultArtifactLocale: options.defaultArtifactLocale } : {}),
    });
  const registry = service.registry;
  const exposed = (options.formats ?? registry.formats().map((adapter) => adapter.format)).filter((name) =>
    registry.has(name),
  );
  if (exposed.length === 0) throw new Error('@artkit-ai/agent: the registry has no formats to expose.');
  const adapters = exposed.map((name) => registry.get(name));
  const formatNames = adapters.map((adapter) => adapter.format);
  const registered = [
    ...new Set(
      registry
        .exporters()
        .filter((e) => formatNames.includes(e.format))
        .map((e) => e.target),
    ),
  ];
  // The export tool always exists; without registered exporters it still offers every known file format.
  const targets: string[] = registered.length > 0 ? registered : [...EXPORT_FORMATS];
  const topics = guideTopics(registry, formatNames);
  const maxTokensCap = options.read?.maxTokens ?? DEFAULT_MAX_TOKENS_CAP;
  const defaultTokens = options.read?.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;

  function requireScope(ctx: ToolExecutionContext, tool: string): ToolkitFailure | undefined {
    if (!isScope(ctx?.scope)) {
      return {
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: msg(locale, 'MISSING_SCOPE'), details: { tool } },
      };
    }
    return undefined;
  }

  const emitArtifact = (ctx: ToolExecutionContext, tool: string, artifact: ArtifactReference) =>
    ctx.emit?.({ type: 'artifact', tool, artifact });

  function parse<T extends z.ZodType>(tool: string, schema: T, input: unknown): z.infer<T> | ToolkitFailure {
    const parsed = schema.safeParse(stripModelNulls(input));
    if (parsed.success) return parsed.data as z.infer<T>;
    const issues = parsed.error.issues.map((issue) => ({
      path: [tool, ...issue.path.map(String)].join('.'),
      message: issue.message,
      hint: t(locale, 'ZOD_INVALID_TYPE_HINT', { expected: issue.code }),
    }));
    return {
      ok: false,
      error: { code: 'INVALID_OPERATION', message: msg(locale, 'INVALID_ARGUMENTS', { tool }), issues },
    };
  }

  const create: ArtifactTool = {
    name: 'artifact_create',
    description:
      'Create an artifact in one of the native formats. Pass native content (Markdown, OpenUI Lang or a workbook object) or an initial batch of operations; the result carries the id and version for later reads and edits.',
    inputSchema: toJsonSchema(createSchema(formatNames), profile),
    zodSchema: createSchema(formatNames),
    readOnly: false,
    async execute(input, ctx) {
      const denied = requireScope(ctx, 'artifact_create');
      if (denied) return denied;
      const args = parse('artifact_create', createSchema(formatNames), input);
      if ('ok' in args) return args;
      try {
        const result: CommitResult = await service.create(ctx.scope, {
          format: args.format,
          title: args.title,
          ...(args.content === undefined ? {} : { content: args.content }),
          ...(args.operations ? { operations: args.operations } : {}),
          ...(args.locale ? { locale: args.locale } : {}),
          ...(args.themeId ? { themeId: args.themeId } : {}),
          ...(args.tags ? { tags: args.tags } : {}),
        });
        const ref = reference(result.artifact);
        emitArtifact(ctx, 'artifact_create', ref);
        return { ok: true, ...ref, createdRefs: result.createdRefs, lint: result.lint };
      } catch (error) {
        return failure(locale, 'artifact_create', error);
      }
    },
  };

  const read: ArtifactTool = {
    name: 'artifact_read',
    description:
      'Read an artifact in a compact form: outline first, then a range or the full text under a token budget. Use the returned version as baseVersion for the next edit.',
    inputSchema: toJsonSchema(readSchema(maxTokensCap), profile),
    zodSchema: readSchema(maxTokensCap),
    readOnly: true,
    async execute(input, ctx) {
      const denied = requireScope(ctx, 'artifact_read');
      if (denied) return denied;
      const args = parse('artifact_read', readSchema(maxTokensCap), input);
      if ('ok' in args) return args;
      try {
        const result = await service.read(ctx.scope, args.id, {
          mode: args.mode,
          maxTokens: args.maxTokens ?? defaultTokens,
          ...(args.range === undefined ? {} : { range: args.range }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        });
        return {
          ok: true,
          ...reference(result.artifact),
          mode: args.mode,
          truncated: result.projection.truncated,
          ...(result.projection.cursor ? { cursor: result.projection.cursor } : {}),
          text: result.text,
        };
      } catch (error) {
        return failure(locale, 'artifact_read', error);
      }
    },
  };

  const applyFor = (perFormat?: AnyFormatAdapter): ArtifactTool => {
    const schema = applySchema(adapters, perFormat);
    const name = perFormat ? `artifact_apply_${perFormat.format.replace(/-/g, '_')}` : 'artifact_apply';
    return {
      name,
      description: perFormat
        ? `Apply a batch of ${perFormat.label} operations to a "${perFormat.format}" artifact. Pass the latest version as baseVersion.`
        : 'Apply a batch of operations to an artifact of any format. Pass the latest version as baseVersion; the operations must match the artifact format.',
      inputSchema: toJsonSchema(schema, profile),
      zodSchema: schema,
      readOnly: false,
      ...(perFormat ? { format: perFormat.format } : {}),
      async execute(input, ctx) {
        const denied = requireScope(ctx, name);
        if (denied) return denied;
        const args = parse(name, schema, input);
        if ('ok' in args) return args;
        try {
          const current = await service.get(ctx.scope, args.id);
          if (perFormat && current.format !== perFormat.format) {
            const message = msg(locale, 'FORMAT_MISMATCH', {
              id: current.id,
              actual: current.format,
              expected: perFormat.format,
            });
            return {
              ok: false,
              error: {
                code: 'INVALID_OPERATION',
                message,
                issues: [
                  {
                    path: 'id',
                    message,
                    hint: msg(locale, 'FORMAT_MISMATCH_HINT', {
                      tool: `artifact_apply_${current.format.replace(/-/g, '_')}`,
                    }),
                  },
                ],
              },
            };
          }
          const result = await service.apply(ctx.scope, {
            artifactId: args.id,
            baseVersion: args.baseVersion,
            operations: stripModelNulls(args.operations) as unknown[],
          });
          const ref = reference(result.artifact);
          emitArtifact(ctx, name, ref);
          return {
            ok: true,
            ...ref,
            createdRefs: result.createdRefs,
            diff: result.diff,
            lint: result.lint,
          };
        } catch (error) {
          return failure(locale, name, error);
        }
      },
    };
  };
  const apply: ArtifactTool[] =
    applyMode === 'per-format' ? adapters.map((adapter) => applyFor(adapter)) : [applyFor()];

  const exporter: ArtifactTool = {
    name: 'artifact_export',
    description:
      'Export an artifact to a file format (for example xlsx, docx, pptx or html). The file is stored as an asset and the result gives its reference.',
    inputSchema: toJsonSchema(exportSchema(targets), profile),
    zodSchema: exportSchema(targets),
    readOnly: false,
    async execute(input, ctx) {
      const denied = requireScope(ctx, 'artifact_export');
      if (denied) return denied;
      const args = parse('artifact_export', exportSchema(targets), input);
      if ('ok' in args) return args;
      if (!options.assets && !options.service?.assetResolver) {
        return { ok: false, error: { code: 'EXPORT_FAILED', message: msg(locale, 'EXPORT_UNAVAILABLE') } };
      }
      try {
        const result = await service.export(ctx.scope, {
          artifactId: args.id,
          format: args.target,
          saveToAssets: true,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        const current = await service.get(ctx.scope, args.id);
        const ref = reference(current);
        emitArtifact(ctx, 'artifact_export', ref);
        return {
          ok: true,
          ...ref,
          target: args.target,
          asset: {
            ref: result.asset?.ref ?? '',
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.bytes.byteLength,
          },
          warnings: result.warnings,
        };
      } catch (error) {
        return failure(locale, 'artifact_export', error);
      }
    },
  };

  const list: ArtifactTool = {
    name: 'artifact_list',
    description: 'List artifacts visible to you, newest first, with id, title, format and version.',
    inputSchema: toJsonSchema(listSchema(formatNames), profile),
    zodSchema: listSchema(formatNames),
    readOnly: true,
    async execute(input, ctx) {
      const denied = requireScope(ctx, 'artifact_list');
      if (denied) return denied;
      const args = parse('artifact_list', listSchema(formatNames), input);
      if ('ok' in args) return args;
      try {
        const page = await service.list(
          ctx.scope,
          {
            ...(args.format ? { format: args.format } : {}),
            ...(args.title ? { title: args.title } : {}),
          },
          { limit: args.limit, ...(args.cursor ? { cursor: args.cursor } : {}) },
        );
        const items = page.items.filter((item) => formatNames.includes(item.format));
        return { ok: true, items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
      } catch (error) {
        return failure(locale, 'artifact_list', error);
      }
    },
  };

  const guide: ArtifactTool = {
    name: 'artifact_guide',
    description: 'Read a guide: "overview", one format (its rules and examples), "themes" or "errors".',
    inputSchema: toJsonSchema(guideSchema(topics), profile),
    zodSchema: guideSchema(topics),
    readOnly: true,
    async execute(input) {
      const args = parse('artifact_guide', guideSchema(topics), input);
      if ('ok' in args) return args;
      const content = guideBody(registry, args.topic);
      if (content === undefined) {
        return {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: msg(locale, 'GUIDE_TOPIC_HINT', { topics: topics.join(', ') }),
          },
        };
      }
      return { ok: true, topic: args.topic, content };
    },
  };

  const tools = [create, read, ...apply, exporter, list, guide];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    tools,
    service,
    registry,
    locale,
    schemaProfile: profile,
    tool: (name) => byName.get(name),
    instructions: (instructionOptions) =>
      renderInstructions({ registry, formats: formatNames, locale }, instructionOptions),
    skills: (skillOptions) => renderSkills(registry, { ...skillOptions, formats: formatNames, applyMode }),
    guide: (topic) => guideBody(registry, topic),
    guideTopics: () => [...topics],
  };
}

type ToolkitFailure = { ok: false; error: ModelErrorPayload['error'] };
