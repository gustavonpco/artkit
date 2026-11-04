# @artkit-ai/mcp

MCP server for artkit, built on `@modelcontextprotocol/sdk`:

- **Tools**: the `@artkit-ai/agent` toolkit tools with the same names, descriptions and JSON Schemas.
- **Resources**: `artifact://{id}` (outline projection of the latest version) and `artifact://{id}/v/{version}`.
- **Guides**: every guide topic as a prompt (`artkit-guide-<topic>`) and as a resource `artkit://guide/{topic}`.
- **Transports**: stdio and stateless streamable HTTP. Authentication is delegated to the host.

```ts
import { createArtifactToolkit } from '@artkit-ai/agent';
import { connectStdio, createArtkitMcpHttpHandler, createArtkitMcpServer } from '@artkit-ai/mcp';

const toolkit = createArtifactToolkit({ registry, store, assets, authorize });

// stdio (local agents)
const server = createArtkitMcpServer({
  toolkit,
  resolveScope: () => ({ workspaceId: 'local', actor: { type: 'agent', id: 'cli' } }),
});
await connectStdio(server);

// HTTP: mount the handler on your route after authenticating the request
const handle = createArtkitMcpHttpHandler({
  toolkit,
  resolveScope: (extra) => ({
    workspaceId: extra.authInfo!.extra!.workspaceId as string,
    actor: { type: 'agent', id: extra.authInfo!.clientId },
  }),
});
export async function POST(request: Request) {
  const authInfo = await verifyBearer(request); // host-specific
  return handle(request, { authInfo });
}
```

Notes:

- Scope is resolved per request by `resolveScope(extra)`; tool arguments never carry workspace or user ids.
  Failures to resolve it are reported without host details.
- MCP has no stable tool call id, so idempotency uses `params._meta.idempotencyKey` when the client sends one
  (override with the `idempotencyKey` option).
- Domain errors come back as tool results with `isError: true` and the artkit error payload; unknown tools and
  scope failures are protocol errors.
- Read results carry the projection as a separate text block so it is not JSON-escaped.
- The server sends the toolkit's compact instructions on initialize (`instructions: false` disables them).
- MCP clients ask the user before running tools themselves; `readOnlyHint` and `destructiveHint` annotations
  help them decide.
