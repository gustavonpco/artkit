import type { ArtifactTool, ArtifactToolkit, ToolExecutionContext } from '@artkit-ai/agent';
import type { Scope } from '@artkit-ai/core';
import type { ToolCaller, ToolCallRecord } from './types.js';

export const MUTATING_TOOLS = new Set(['artifact_create', 'artifact_apply']);

export function isMutation(name: string): boolean {
  return MUTATING_TOOLS.has(name) || name.startsWith('artifact_apply_');
}

/**
 * Wraps a toolkit so every tool execution is recorded. The wrapped toolkit is a drop-in replacement
 * for adapters such as `artifactTools` from `@artkit-ai/ai-sdk`.
 */
export function instrumentToolkit(
  toolkit: ArtifactToolkit,
  onCall: (record: ToolCallRecord) => Promise<void> | void,
): ArtifactToolkit {
  const wrap = (tool: ArtifactTool): ArtifactTool => ({
    ...tool,
    async execute(input: unknown, ctx: ToolExecutionContext) {
      const started = Date.now();
      const result = await tool.execute(input, ctx);
      const output = result as { ok?: boolean; error?: { code?: string } };
      const record: ToolCallRecord = {
        name: tool.name,
        input,
        ok: output.ok !== false,
        ...(output.ok === false && output.error?.code ? { code: output.error.code } : {}),
        durationMs: Date.now() - started,
      };
      await onCall(record);
      return result;
    },
  });
  const tools = toolkit.tools.map(wrap);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    tools,
    service: toolkit.service,
    registry: toolkit.registry,
    locale: toolkit.locale,
    schemaProfile: toolkit.schemaProfile,
    tool: (name: string) => byName.get(name),
    instructions: (options) => toolkit.instructions(options),
    skills: (options) => toolkit.skills(options),
    guide: (topic) => toolkit.guide(topic),
    guideTopics: () => toolkit.guideTopics(),
  };
}

/** Executes toolkit tools directly with a fixed scope. */
export function createToolCaller(toolkit: ArtifactToolkit, scope: Scope): ToolCaller {
  return {
    async call(name, input) {
      const tool = toolkit.tool(name);
      if (!tool) throw new Error(`Unknown tool ${name}`);
      return (await tool.execute(input, { scope })) as never;
    },
  };
}
