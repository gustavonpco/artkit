import { MockLanguageModelV4 } from 'ai/test';

export interface ScriptedToolCall {
  name: string;
  input: unknown;
}

/** One model turn: tool calls to make, or a final text. Receives the prompt so far (to read ids). */
export type ScriptStep = (prompt: string) => { toolCalls: ScriptedToolCall[] } | { text: string };

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

/**
 * Deterministic language model that plays a script, for testing harnesses and the evals pipeline
 * without network access. After the last step it answers "Done.".
 */
export function createScriptedModel(steps: ScriptStep[]): MockLanguageModelV4 {
  let index = 0;
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const step = steps[index++];
      const turn = step ? step(JSON.stringify(options.prompt)) : { text: 'Done.' };
      if ('text' in turn) {
        return {
          content: [{ type: 'text', text: turn.text }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: turn.toolCalls.map((call, i) => ({
          type: 'tool-call' as const,
          toolCallId: `call-${index}-${i}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        })),
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

/** Extracts the last `art_…` id mentioned in a prompt (tool results include the ids). */
export function lastArtifactId(prompt: string): string {
  const ids = prompt.match(/art_[0-9A-HJKMNP-TV-Z]{26}/g);
  if (!ids || ids.length === 0) throw new Error('No artifact id in the prompt');
  return ids[ids.length - 1]!;
}
