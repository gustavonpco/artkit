# @artkit-ai/ai-sdk

Vercel AI SDK 7 adapter for artkit: tools, approval, tool context, `data-artifact` parts and the
`useArtifacts` hook. Peer dependency: `ai@^7` (and `react@^19` for `/react`).

## Server

```ts
import {
  ToolLoopAgent,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import {
  artifactContextSchema,
  artifactInstructions,
  artifactToolApproval,
  artifactTools,
  artifactToolsContext,
} from '@artkit-ai/ai-sdk';

const tools = artifactTools(toolkit);
const agent = new ToolLoopAgent({
  model,
  instructions: [baseInstructions, artifactInstructions(toolkit)].join('\n\n'),
  tools,
  toolApproval: artifactToolApproval(toolkit), // submit, apply on published… → 'user-approval'
  callOptionsSchema: artifactContextSchema, // { workspaceId, actor, writer? }
  prepareCall: ({ options, ...settings }) => ({
    ...settings,
    toolsContext: artifactToolsContext(tools, options),
  }),
});

export async function POST(request: Request) {
  const { messages } = await request.json();
  const { workspaceId, actor } = await authenticate(request); // never from the body
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = await agent.stream({
        messages: await convertToModelMessages(messages, { tools }),
        options: { workspaceId, actor, writer },
      });
      writer.merge(result.toUIMessageStream());
    },
  });
  return createUIMessageStreamResponse({ stream });
}
```

- Tools keep the toolkit's names, descriptions and JSON Schemas (`jsonSchema()`); input is validated by the
  toolkit so the model receives fixable error payloads instead of SDK tool errors.
- Scope comes from the tool `context` (`toolsContext`), the tool call id is the idempotency key.
- Each commit writes `{ type: 'data-artifact', id: artifactId, data: { id, kind, title, version, status } }`,
  updated in place by id: messages carry references, not content.
- For `WorkflowAgent` (`@ai-sdk/workflow`), use `artifactTools(toolkit, { toolLevelApproval: true })`, which sets
  the tool-level `needsApproval` that durable workflows use.

## Client

```tsx
import { useChat } from '@ai-sdk/react';
import { lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useArtifacts } from '@artkit-ai/ai-sdk/react';

const { messages, addToolApprovalResponse } = useChat({
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});
const { artifacts, byId, pendingApprovals, approve, reject } = useArtifacts(messages, {
  registry,
  addToolApprovalResponse,
});
```

Each `ArtifactState` has the last `committed` reference, a provisional `preview` while `artifact_create` or
`artifact_apply` input is streaming (create content goes through the kind's `parsePartial`; apply keeps complete
operations only), the `approval` state (`approval-requested`, `approved`, `rejected`) and the last tool `error`.
`deriveArtifacts(messages, options)` is the same logic without React.

## AI SDK 7 names

Confirmed against `ai@7.0.162`: `ToolLoopAgent`, `tool`, `jsonSchema`, per-tool `contextSchema` + `toolsContext`
map, agent-level `toolApproval` (statuses `user-approval`, `not-applicable`…), `callOptionsSchema`/`prepareCall`,
`createUIMessageStream`, `UIMessageStreamWriter`, tool part states including `approval-requested`,
`approval-responded` and `output-denied`, and `useChat().addToolApprovalResponse`. `WorkflowAgent` lives in
`@ai-sdk/workflow` and `HarnessAgent` in `@ai-sdk/harness`; they emit the same UI stream, so `useArtifacts` works
with them, but they are not dependencies of this package.
