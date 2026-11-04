import {
  type AuthorizeFn,
  createMemoryAssetStore,
  createMemoryStore,
  createRegistry,
  type ModelErrorPayload,
  type Scope,
} from '@artkit/core';
import {
  type ArtifactToolkitOptions,
  createArtifactToolkit,
  type ToolExecutionContext,
  type ToolkitEvent,
  type ToolResult,
} from '../src/index.js';
import { noteKind } from './note-kind.js';

export const agentScope: Scope = { workspaceId: 'ws-1', actor: { type: 'agent', id: 'agent-1' } };
export const userScope: Scope = { workspaceId: 'ws-1', actor: { type: 'user', id: 'user-1' } };
export const otherScope: Scope = { workspaceId: 'ws-2', actor: { type: 'agent', id: 'agent-1' } };

/** Second tiny kind so per-kind tools and kind filters have something to tell apart. */
export const memoKind = {
  ...noteKind,
  kind: 'memo',
  label: 'Memo',
  instructions: { ...noteKind.instructions, summary: 'A memo.' },
};

export function setup(
  overrides: Partial<Omit<ArtifactToolkitOptions, 'registry' | 'store' | 'service'>> & {
    authorize?: AuthorizeFn;
  } = {},
) {
  const registry = createRegistry({ kinds: [noteKind, memoKind] });
  registry.registerExporter({
    kind: 'note',
    format: 'pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    runtime: 'any',
    // Core saves exports through the asset policy, which sniffs magic bytes: produce a PDF header.
    async export(content: { items: { text: string }[] }, ctx) {
      ctx.warn('PDF export drops item ids.');
      return new TextEncoder().encode(`%PDF-1.4\n${content.items.map((item) => item.text).join('\n')}`);
    },
  });
  const store = createMemoryStore();
  const assets = createMemoryAssetStore({ policy: { allowedMimeTypes: ['application/pdf'] } });
  const events: ToolkitEvent[] = [];
  const toolkit = createArtifactToolkit({ registry, store, assets, authorize: () => true, ...overrides });
  const ctx = (extra: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    scope: agentScope,
    emit: (event) => events.push(event),
    ...extra,
  });
  async function call<T = Record<string, unknown>>(
    name: string,
    input: unknown,
    context: Partial<ToolExecutionContext> = {},
  ): Promise<T> {
    const tool = toolkit.tool(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return (await tool.execute(input, ctx(context))) as T;
  }
  return { registry, store, assets, toolkit, events, call };
}

export function expectError(result: ToolResult | Record<string, unknown>): ModelErrorPayload['error'] {
  if ((result as { ok?: unknown }).ok !== false)
    throw new Error(`expected an error payload, got ${JSON.stringify(result)}`);
  return (result as ModelErrorPayload).error;
}
