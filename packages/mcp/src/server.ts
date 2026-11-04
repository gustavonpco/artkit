import type { ArtifactTool, ArtifactToolkit, ToolResult } from '@artkit/agent';
import { type ModelErrorPayload, type Scope, toModelError } from '@artkit/core';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ServerNotification,
  type ServerRequest,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export type McpRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Maps an MCP request (usually its `authInfo`, set by the host after authenticating) to a scope. */
export type ResolveScope = (extra: McpRequestExtra) => Scope | Promise<Scope>;

export interface ArtkitMcpServerOptions {
  toolkit: ArtifactToolkit;
  /** Workspace and actor come only from here, never from tool arguments (spec §16). */
  resolveScope: ResolveScope;
  name?: string;
  version?: string;
  /**
   * Server instructions sent on initialize. Default: the toolkit's compact instructions; `false` disables them.
   */
  instructions?: string | false;
  /**
   * Idempotency key of a tool call. MCP has no stable call id (JSON-RPC ids repeat across sessions), so the
   * default reads `params._meta.idempotencyKey` and otherwise sends none.
   */
  idempotencyKey?: (
    request: { params: { _meta?: Record<string, unknown> } },
    extra: McpRequestExtra,
  ) => string | undefined;
}

const RESOURCE_NOT_FOUND = -32002;

function mcpErrorFrom(payload: ModelErrorPayload): McpError {
  const code =
    payload.error.code === 'NOT_FOUND'
      ? RESOURCE_NOT_FOUND
      : payload.error.code === 'INTERNAL_ERROR'
        ? ErrorCode.InternalError
        : ErrorCode.InvalidParams;
  return new McpError(code, payload.error.message, { artkit: payload.error });
}

async function scopeFor(resolveScope: ResolveScope, extra: McpRequestExtra): Promise<Scope> {
  try {
    return await resolveScope(extra);
  } catch {
    // Never echo host authentication details to the client.
    throw new McpError(ErrorCode.InvalidRequest, 'Unable to resolve the caller scope.');
  }
}

function toolDefinition(tool: ArtifactTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Tool['inputSchema'],
    annotations: {
      readOnlyHint: tool.readOnly,
      // Changes are versioned and restorable, never destructive.
      destructiveHint: false,
      idempotentHint: tool.readOnly,
      openWorldHint: false,
    },
  };
}

/**
 * Text blocks for the model: metadata as JSON, plus long text payloads (projections, guides) as plain text so
 * they are not JSON-escaped.
 */
function callResult(result: ToolResult): CallToolResult {
  const { text, content, ...meta } = result as ToolResult & { text?: unknown; content?: unknown };
  const blocks: CallToolResult['content'] = [
    {
      type: 'text',
      text: JSON.stringify(typeof text === 'string' || typeof content === 'string' ? meta : result),
    },
  ];
  if (typeof text === 'string') blocks.push({ type: 'text', text });
  if (typeof content === 'string') blocks.push({ type: 'text', text: content });
  return {
    content: blocks,
    structuredContent: result as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}

const defaultIdempotencyKey: NonNullable<ArtkitMcpServerOptions['idempotencyKey']> = (request) => {
  const key = request.params._meta?.idempotencyKey;
  return typeof key === 'string' && key.length > 0 && key.length <= 200 ? key : undefined;
};

/**
 * MCP server exposing the toolkit tools (same names, descriptions and JSON Schemas), artifact projections as
 * resources and the guides as prompts and resources (spec §14.5, §14.7).
 */
export function createArtkitMcpServer(options: ArtkitMcpServerOptions): McpServer {
  const { toolkit, resolveScope } = options;
  const instructions =
    options.instructions === false
      ? undefined
      : (options.instructions ?? toolkit.instructions({ detail: 'compact' }));
  const server = new McpServer(
    { name: options.name ?? 'artkit', version: options.version ?? '0.1.0' },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      ...(instructions ? { instructions } : {}),
    },
  );
  const idempotencyKey = options.idempotencyKey ?? defaultIdempotencyKey;

  // Tools are served from the low-level handlers so the toolkit's JSON Schemas (per profile) go out unchanged;
  // McpServer.registerTool would regenerate them from zod.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolkit.tools.map(toolDefinition),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = toolkit.tool(request.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    const scope = await scopeFor(resolveScope, extra);
    const key = idempotencyKey(request as { params: { _meta?: Record<string, unknown> } }, extra);
    const result = await tool.execute(request.params.arguments ?? {}, {
      scope,
      signal: extra.signal,
      ...(key ? { idempotencyKey: key } : {}),
    });
    return callResult(result);
  });

  async function readProjection(uri: URL, id: string, version: number | undefined, extra: McpRequestExtra) {
    const scope = await scopeFor(resolveScope, extra);
    try {
      const read = await toolkit.service.read(scope, id, {
        mode: 'outline',
        ...(version === undefined ? {} : { version }),
      });
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: read.text }] };
    } catch (error) {
      throw mcpErrorFrom(toModelError(error, toolkit.locale));
    }
  }

  const single = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

  // Registered before `artifact://{id}` so versioned URIs never fall into the latest-version template.
  server.registerResource(
    'artifact-version',
    new ResourceTemplate('artifact://{id}/v/{version}', { list: undefined }),
    { description: 'Outline projection of a specific artifact version.', mimeType: 'text/plain' },
    (uri, variables, extra) => {
      const version = Number(single(variables.version));
      if (!Number.isInteger(version) || version < 1)
        throw new McpError(ErrorCode.InvalidParams, 'Version must be a positive integer.');
      return readProjection(uri, decodeURIComponent(single(variables.id)), version, extra);
    },
  );

  server.registerResource(
    'artifact',
    new ResourceTemplate('artifact://{id}', {
      list: async (extra) => {
        const scope = await scopeFor(resolveScope, extra);
        try {
          const page = await toolkit.service.list(scope, {}, { limit: 50 });
          return {
            resources: page.items.map((item) => ({
              uri: `artifact://${encodeURIComponent(item.id)}`,
              name: item.title,
              description: `${item.kind} v${item.version} (${item.status})`,
              mimeType: 'text/plain',
            })),
          };
        } catch (error) {
          throw mcpErrorFrom(toModelError(error, toolkit.locale));
        }
      },
    }),
    {
      description: 'Outline projection (ids and one line per item) of the latest artifact version.',
      mimeType: 'text/plain',
    },
    (uri, variables, extra) =>
      readProjection(uri, decodeURIComponent(single(variables.id)), undefined, extra),
  );

  const topics = toolkit.guideTopics();
  server.registerResource(
    'artkit-guide',
    new ResourceTemplate('artkit://guide/{topic}', {
      list: () => ({
        resources: topics.map((topic) => ({
          uri: `artkit://guide/${topic}`,
          name: `artkit guide: ${topic}`,
          mimeType: 'text/markdown',
        })),
      }),
      complete: { topic: (value) => topics.filter((topic) => topic.startsWith(value)) },
    }),
    {
      description: 'artkit usage guides: overview, one per kind, themes and errors.',
      mimeType: 'text/markdown',
    },
    (uri, variables) => {
      const topic = single(variables.topic);
      const text = toolkit.guide(topic);
      if (text === undefined)
        throw new McpError(
          RESOURCE_NOT_FOUND,
          `Guide topic not found: ${topic}. Available: ${topics.join(', ')}.`,
        );
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  for (const topic of topics) {
    server.registerPrompt(
      `artkit-guide-${topic}`,
      {
        title: `artkit guide: ${topic}`,
        description: `Load the artkit "${topic}" guide into the conversation.`,
      },
      () => ({
        description: `artkit guide: ${topic}`,
        messages: [{ role: 'user', content: { type: 'text', text: toolkit.guide(topic) ?? '' } }],
      }),
    );
  }

  return server;
}
