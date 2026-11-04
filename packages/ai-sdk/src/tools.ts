import type {
  ArtifactTool,
  ArtifactToolkit,
  InstructionOptions,
  ToolExecutionContext,
  ToolResult,
} from '@artkit-ai/agent';
import { actorSchema, type Scope } from '@artkit-ai/core';
import { type JSONSchema7, jsonSchema, type Tool, type ToolApprovalStatus, tool } from 'ai';
import { z } from 'zod';
import { type ArtifactPartWriter, writeArtifactDataPart } from './data-parts.js';

/**
 * Per-request context of the artifact tools, passed through AI SDK `toolsContext` (validated by each tool's
 * `contextSchema`) — never through model arguments (spec §14.4, §16).
 */
export const artifactContextSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  actor: actorSchema,
  /** UI message stream writer that receives `data-artifact` parts on each commit. */
  writer: z
    .custom<ArtifactPartWriter>(
      (value) => typeof (value as { write?: unknown } | null)?.write === 'function',
      {
        message: 'writer must have a write(part) method',
      },
    )
    .optional(),
});

export type ArtifactToolContext = z.infer<typeof artifactContextSchema>;

export type ArtifactAITool = Tool<unknown, ToolResult, ArtifactToolContext>;
export type ArtifactToolSet = Record<string, ArtifactAITool>;

export interface ArtifactToolsOptions {
  /** Only these tool names (default: every toolkit tool). */
  include?: string[];
  /**
   * Also set the tool-level `needsApproval` (used by `WorkflowAgent` from `@ai-sdk/workflow`).
   * `ToolLoopAgent`, `generateText` and `streamText` use {@link artifactToolApproval} instead.
   */
  toolLevelApproval?: boolean;
  /** Emit `data-artifact` parts through `context.writer` (default true). */
  dataParts?: boolean;
}

function scopeOf(context: ArtifactToolContext): Scope {
  return { workspaceId: context.workspaceId, actor: { type: context.actor.type, id: context.actor.id } };
}

function executionContext(
  context: ArtifactToolContext,
  extra: { toolCallId?: string; abortSignal?: AbortSignal | undefined },
  dataParts: boolean,
): ToolExecutionContext {
  const writer = context.writer;
  return {
    scope: scopeOf(context),
    ...(extra.toolCallId ? { idempotencyKey: extra.toolCallId } : {}),
    ...(extra.abortSignal ? { signal: extra.abortSignal } : {}),
    ...(dataParts && writer ? { emit: (event) => writeArtifactDataPart(writer, event.artifact) } : {}),
  };
}

function selected(toolkit: ArtifactToolkit, include?: string[]): ArtifactTool[] {
  return include ? toolkit.tools.filter((candidate) => include.includes(candidate.name)) : toolkit.tools;
}

/**
 * Converts the neutral toolkit into AI SDK 7 tools with the same names, descriptions and JSON Schemas.
 * Input is not validated by the SDK on purpose: the toolkit validates it and answers with model-facing
 * error payloads the model can fix, instead of SDK-level tool errors.
 */
export function artifactTools(toolkit: ArtifactToolkit, options: ArtifactToolsOptions = {}): ArtifactToolSet {
  const dataParts = options.dataParts !== false;
  const tools: ArtifactToolSet = {};
  for (const neutral of selected(toolkit, options.include)) {
    const needsApproval = neutral.needsApproval;
    tools[neutral.name] = tool<unknown, ToolResult, ArtifactToolContext>({
      description: neutral.description,
      inputSchema: jsonSchema<unknown>(neutral.inputSchema as JSONSchema7),
      contextSchema: artifactContextSchema,
      ...(toolkit.schemaProfile === 'strict' ? { strict: true } : {}),
      ...(options.toolLevelApproval && needsApproval
        ? {
            needsApproval: (input: unknown, { context }: { context: ArtifactToolContext }) =>
              needsApproval(input, executionContext(context, {}, false)),
          }
        : {}),
      execute: (input, { toolCallId, abortSignal, context }) =>
        neutral.execute(input, executionContext(context, { toolCallId, abortSignal }, dataParts)),
    });
  }
  return tools;
}

type ArtifactApprovalFunction = (
  input: unknown,
  options: { toolCallId: string; toolContext: ArtifactToolContext },
) => Promise<ToolApprovalStatus>;

/**
 * `toolApproval` entries for `ToolLoopAgent` / `generateText` / `streamText`, following the toolkit approval
 * policy (submit always, apply on published artifacts, export…). Spread it with your own entries.
 */
export function artifactToolApproval(
  toolkit: ArtifactToolkit,
  options: { include?: string[] } = {},
): Record<string, ArtifactApprovalFunction> {
  const config: Record<string, ArtifactApprovalFunction> = {};
  for (const neutral of selected(toolkit, options.include)) {
    const needsApproval = neutral.needsApproval;
    if (!needsApproval) continue;
    config[neutral.name] = async (input, { toolCallId, toolContext }) =>
      (await needsApproval(input, executionContext(toolContext, { toolCallId }, false)))
        ? 'user-approval'
        : 'not-applicable';
  }
  return config;
}

/** Builds the `toolsContext` map (one entry per artifact tool) from the request context. */
export function artifactToolsContext<TOOLS extends Record<string, unknown>>(
  tools: TOOLS,
  context: ArtifactToolContext,
): { [K in keyof TOOLS]: ArtifactToolContext } {
  const out = {} as { [K in keyof TOOLS]: ArtifactToolContext };
  for (const name of Object.keys(tools) as (keyof TOOLS)[]) out[name] = context;
  return out;
}

/** System prompt block for the toolkit's kinds (spec §14.3). */
export function artifactInstructions(toolkit: ArtifactToolkit, options?: InstructionOptions): string {
  return toolkit.instructions(options);
}
