/** Authored prose of the `artkit-integracao` skill (spec §14.7), aimed at coding agents. */

export const INTEGRATION_DESCRIPTION =
  'Integrate the artkit library into an application: install packages, build the kind registry, store, assets and authorization hook, plug the agent toolkit into the Vercel AI SDK (ToolLoopAgent) and the React panel, expose an MCP server and create custom kinds.';

const BUILTIN_KIND_PACKAGES = ['document', 'sheet', 'slides', 'diagram'];

export function integrationBody(kinds: string[]): string {
  const builtin = kinds.filter((kind) => BUILTIN_KIND_PACKAGES.includes(kind));
  const custom = kinds.filter((kind) => !BUILTIN_KIND_PACKAGES.includes(kind));
  const kindPackages = (builtin.length > 0 ? builtin : BUILTIN_KIND_PACKAGES)
    .map((kind) => `\`@artkit-ai/kind-${kind}\``)
    .join(', ');
  return `# Integrating artkit

artkit lets AI agents create, read, edit, render and export typed artifacts. The model only writes \`content\` through
validated operations; storage, versions, authorization and rendering stay in the application.

## 1. Install

Use the package manager the project already uses (look for \`pnpm-lock.yaml\`, \`yarn.lock\`, \`bun.lockb\` or
\`package-lock.json\`). Install only what you need:

- \`@artkit-ai/core\` (always), \`@artkit-ai/agent\` (tools and instructions for any harness).
- Kinds: ${kindPackages}. Each kind has subpaths: \`.\` (model, safe everywhere), \`/react\` (renderer),
  \`/edit\` (visual editor, load lazily), \`/export\` (heavy exporters, server side).
- \`@artkit-ai/ai-sdk\` for the Vercel AI SDK 7 (peer \`ai\`), \`@artkit-ai/react\` for the panel, \`@artkit-ai/mcp\` for MCP,
  \`@artkit-ai/node\` for file-system stores, HTTP routes and headless export.
${custom.length > 0 ? `\nThis registry also has custom kinds: ${custom.map((kind) => `\`${kind}\``).join(', ')}.\n` : ''}
## 2. Registry, store, assets and authorization

\`\`\`ts
import { createRegistry, createMemoryStore, createMemoryAssetStore } from '@artkit-ai/core';
import { createArtifactToolkit } from '@artkit-ai/agent';

const registry = createRegistry({ kinds: [/* documentKind, sheetKind, … */], themes: [/* brand theme */] });
// register exporters from the kinds' /export subpaths on the server: registry.registerExporter(…)

const toolkit = createArtifactToolkit({
  registry,
  store,            // createMemoryStore() for tests; a persistent ArtifactStore in production
  assets,           // AssetStore; required for artifact_export
  authorize: async (action, artifact, scope) => canAccess(scope.actor, action, artifact),
  approval: { submit: 'always', apply: 'published' },
  locale: 'en',
});
\`\`\`

\`authorize\` is mandatory: it receives the action, the artifact summary (or null for create/list) and the scope.
Scope (workspace and actor) always comes from the authenticated request, never from the model.

## 3. Vercel AI SDK 7 (ToolLoopAgent)

\`\`\`ts
import { ToolLoopAgent, createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages } from 'ai';
import { artifactTools, artifactToolApproval, artifactToolsContext, artifactContextSchema, artifactInstructions } from '@artkit-ai/ai-sdk';

const tools = artifactTools(toolkit);
const agent = new ToolLoopAgent({
  model,
  instructions: [baseInstructions, artifactInstructions(toolkit)].join('\\n\\n'),
  tools,
  toolApproval: artifactToolApproval(toolkit),
  callOptionsSchema: artifactContextSchema,
  prepareCall: ({ options, ...settings }) => ({ ...settings, toolsContext: artifactToolsContext(tools, options) }),
});

export async function POST(request: Request) {
  const { messages } = await request.json();
  const { workspaceId, actor } = await authenticate(request);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = await agent.stream({ messages: await convertToModelMessages(messages, { tools }), options: { workspaceId, actor, writer } });
      writer.merge(result.toUIMessageStream());
    },
  });
  return createUIMessageStreamResponse({ stream });
}
\`\`\`

Every commit emits a \`data-artifact\` part \`{ id, kind, title, version, status }\` updated in place, so chat messages
carry references, not content. On the client, \`useArtifacts(messages, { registry, addToolApprovalResponse })\` from
\`@artkit-ai/ai-sdk/react\` gives the artifact map, streaming previews and approve/reject actions; render them with the
\`@artkit-ai/react\` panel.

## 4. MCP

\`\`\`ts
import { createArtkitMcpServer, connectStdio, createArtkitMcpHttpHandler } from '@artkit-ai/mcp';

const server = createArtkitMcpServer({ toolkit, resolveScope: (extra) => scopeFromAuth(extra.authInfo) });
await connectStdio(server);                       // local agents
const handle = createArtkitMcpHttpHandler({ toolkit, resolveScope }); // mount: (request) => handle(request, { authInfo })
\`\`\`

Authentication is the host's job: validate the request, then pass \`authInfo\` so \`resolveScope\` can map it.

## 5. Custom kinds

Define the model with \`defineKind\` from \`@artkit-ai/core\` (schemas, pure \`apply\`, \`project\`, \`lint\`, \`diff\`,
\`parsePartial\`, \`limits\`, \`instructions\`) and run \`defineKindConformanceTests(kind, fixtures, { describe, it })\`
from \`@artkit-ai/core/testing\`. Keep the \`.\` entry free of React and Node APIs; put renderers in \`/react\`, editors in
\`/edit\` and exporters in \`/export\`.

## Known pitfalls

- Accepting a workspace or user id from the model or the request body: always resolve scope on the server.
- Writing content to the store directly instead of going through the toolkit or \`createArtifactService\`
  (skips validation, versioning, idempotency and events).
- Importing editors outside the \`/edit\` subpath or exporters in the browser bundle.
- Forgetting to pass the returned \`version\` as the next \`baseVersion\` in custom tools.
- Storing artifact content in chat messages instead of references.
- Logging artifact content; log only metadata (ids, kind, version, counts).
`;
}
