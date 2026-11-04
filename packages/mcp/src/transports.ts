import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type ArtkitMcpServerOptions, createArtkitMcpServer } from './server.js';

/** Connects a server to stdin/stdout (local agents such as Claude Code or Cursor). */
export async function connectStdio(server: McpServer): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}

export interface ArtkitMcpHttpOptions extends ArtkitMcpServerOptions {
  /** Answer with JSON instead of an SSE stream (default true; simpler behind proxies and serverless). */
  enableJsonResponse?: boolean;
}

export interface ArtkitMcpHttpRequestOptions {
  /** Set by the host after authenticating the request; read it in `resolveScope(extra)` as `extra.authInfo`. */
  authInfo?: AuthInfo;
  /** Body already parsed by a framework middleware. */
  parsedBody?: unknown;
}

export type ArtkitMcpHttpHandler = (
  request: Request,
  options?: ArtkitMcpHttpRequestOptions,
) => Promise<Response>;

/**
 * Stateless streamable HTTP handler (Web `Request` → `Response`) for the host to mount on its route, e.g.
 * Next.js `POST`, Hono or a Node adapter. Each request gets a fresh server, so no session state is kept and
 * horizontal scaling needs nothing shared. Authentication stays with the host.
 */
export function createArtkitMcpHttpHandler(options: ArtkitMcpHttpOptions): ArtkitMcpHttpHandler {
  const enableJsonResponse = options.enableJsonResponse ?? true;
  return async (request, requestOptions = {}) => {
    const server = createArtkitMcpServer(options);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse,
    });
    await server.connect(transport);
    let response: Response;
    try {
      response = await transport.handleRequest(request, {
        ...(requestOptions.authInfo ? { authInfo: requestOptions.authInfo } : {}),
        ...(requestOptions.parsedBody !== undefined ? { parsedBody: requestOptions.parsedBody } : {}),
      });
    } catch (error) {
      await server.close();
      throw error;
    }
    if (enableJsonResponse || !response.body) {
      await server.close();
      return response;
    }
    // SSE: release the per-request server once the stream has been fully sent or the client went away.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const release = () => {
      void server.close();
    };
    response.body.pipeTo(writable).then(release, release);
    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
