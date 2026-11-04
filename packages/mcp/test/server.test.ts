import { createArtifactToolkit } from '@artkit/agent';
import { createMemoryStore, createRegistry, type Scope } from '@artkit/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createArtkitMcpHttpHandler, createArtkitMcpServer, type ResolveScope } from '../src/index.js';
import { noteKind } from './note-kind.js';

const scope: Scope = { workspaceId: 'ws-1', actor: { type: 'agent', id: 'mcp-agent' } };

function makeToolkit() {
  const registry = createRegistry({ kinds: [noteKind] });
  return createArtifactToolkit({ registry, store: createMemoryStore(), authorize: () => true });
}

async function connect(resolveScope: ResolveScope = () => scope) {
  const toolkit = makeToolkit();
  const server = createArtkitMcpServer({ toolkit, resolveScope });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { toolkit, client, server };
}

type TextBlock = { type: 'text'; text: string };

function parse(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  return JSON.parse((result.content as TextBlock[])[0]!.text);
}

describe('createArtkitMcpServer', () => {
  it('lists the toolkit tools with the same names, descriptions and schemas', async () => {
    const { client, toolkit } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(toolkit.tools.map((tool) => tool.name));
    for (const tool of tools) {
      const neutral = toolkit.tool(tool.name)!;
      expect(tool.description).toBe(neutral.description);
      expect(tool.inputSchema).toEqual(neutral.inputSchema);
      expect(tool.annotations?.readOnlyHint).toBe(neutral.readOnly);
    }
    expect(client.getInstructions()).toContain('# Artifacts');
  });

  it('creates, reads and applies with scope from resolveScope', async () => {
    const seen: unknown[] = [];
    const { client, toolkit } = await connect((extra) => {
      seen.push(extra.requestId);
      return scope;
    });
    const created = await client.callTool({
      name: 'artifact_create',
      arguments: {
        kind: 'note',
        title: 'MCP',
        content: { items: [{ id: 'a', text: 'hello' }] },
        workspaceId: 'ws-evil',
      },
    });
    expect(created.isError).toBe(false);
    const out = parse(created);
    expect(out).toMatchObject({ ok: true, version: 1, kind: 'note' });
    expect(created.structuredContent).toMatchObject({ ok: true, id: out.id });
    const id = String(out.id);
    expect((await toolkit.service.list({ workspaceId: 'ws-evil', actor: scope.actor })).items).toEqual([]);

    const read = await client.callTool({ name: 'artifact_read', arguments: { id, mode: 'full' } });
    const blocks = read.content as TextBlock[];
    expect(JSON.parse(blocks[0]!.text)).toMatchObject({ ok: true, version: 1, mode: 'full' });
    expect(JSON.parse(blocks[0]!.text).text).toBeUndefined();
    expect(blocks[1]!.text).toContain(`<artifact-content id="${id}">`);
    expect(blocks[1]!.text).toContain('hello');

    const applied = await client.callTool({
      name: 'artifact_apply',
      arguments: { id, baseVersion: 1, operations: [{ op: 'edit', id: 'a', text: 'world' }] },
    });
    expect(parse(applied)).toMatchObject({ ok: true, version: 2 });

    const failed = await client.callTool({
      name: 'artifact_apply',
      arguments: { id, baseVersion: 2, operations: [{ op: 'edit', id: 'zz', text: 'x' }] },
    });
    expect(failed.isError).toBe(true);
    expect(parse(failed)).toMatchObject({ ok: false, error: { code: 'OPERATION_FAILED' } });
    expect(seen.length).toBe(4);
  });

  it('uses _meta.idempotencyKey to dedupe calls', async () => {
    const { client } = await connect();
    const args = {
      name: 'artifact_create',
      arguments: { kind: 'note', title: 'Once' },
      _meta: { idempotencyKey: 'k-1' },
    };
    const first = parse(await client.callTool(args));
    const again = parse(await client.callTool(args));
    expect(again).toMatchObject({ id: first.id, replayed: true });
  });

  it('rejects unknown tools and unresolvable scopes as protocol errors', async () => {
    const { client } = await connect(() => {
      throw new Error('token expired for user@example.com');
    });
    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(/Unknown tool/);
    const error = await client.callTool({ name: 'artifact_list', arguments: {} }).catch((e: Error) => e);
    expect(String(error)).toContain('Unable to resolve the caller scope');
    expect(String(error)).not.toContain('example.com');
  });

  it('serves artifact projections as resources, latest and by version', async () => {
    const { client, toolkit } = await connect();
    const created = await toolkit.service.create(scope, {
      kind: 'note',
      title: 'Res',
      content: { items: [{ id: 'a', text: 'v1 text' }] },
    });
    const id = created.artifact.id;
    await toolkit.service.apply(scope, {
      artifactId: id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'v2 text' }],
    });
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      'artifact://{id}',
      'artifact://{id}/v/{version}',
      'artkit://guide/{topic}',
    ]);
    const listed = await client.listResources();
    expect(listed.resources.map((resource) => resource.uri)).toContain(`artifact://${id}`);
    const latest = await client.readResource({ uri: `artifact://${id}` });
    const latestText = (latest.contents[0] as { text: string }).text;
    expect(latestText).toContain('version: 2');
    expect(latestText).toContain('<artifact-content');
    const old = await client.readResource({ uri: `artifact://${id}/v/1` });
    expect((old.contents[0] as { text: string }).text).toContain('version: 1');
    await expect(client.readResource({ uri: 'artifact://art_missing' })).rejects.toThrow(/not found/i);
  });

  it('exposes guides as prompts and artkit://guide resources', async () => {
    const { client, toolkit } = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(
      toolkit.guideTopics().map((topic) => `artkit-guide-${topic}`),
    );
    const prompt = await client.getPrompt({ name: 'artkit-guide-note' });
    expect((prompt.messages[0]!.content as TextBlock).text).toContain('# Note (`note`)');
    const resource = await client.readResource({ uri: 'artkit://guide/overview' });
    expect((resource.contents[0] as { text: string; mimeType: string }).text).toContain(
      '# Working with artkit artifacts',
    );
    const listed = await client.listResources();
    expect(listed.resources.map((r) => r.uri)).toContain('artkit://guide/errors');
    await expect(client.readResource({ uri: 'artkit://guide/nope' })).rejects.toThrow(
      /Guide topic not found/,
    );
  });
});

describe('createArtkitMcpHttpHandler', () => {
  it('handles stateless JSON-RPC over streamable HTTP with host-provided auth', async () => {
    const toolkit = makeToolkit();
    const handler = createArtkitMcpHttpHandler({
      toolkit,
      resolveScope: (extra) => ({
        workspaceId: String(extra.authInfo?.extra?.workspaceId),
        actor: { type: 'agent', id: extra.authInfo!.clientId },
      }),
    });
    const post = (body: unknown) =>
      handler(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
          },
          body: JSON.stringify(body),
        }),
        { authInfo: { token: 't', clientId: 'agent-7', scopes: [], extra: { workspaceId: 'ws-http' } } },
      );
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'http-test', version: '1.0.0' },
      },
    });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe('artkit');
    const call = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'artifact_create', arguments: { kind: 'note', title: 'Via HTTP' } },
    });
    expect(call.status).toBe(200);
    const payload = await call.json();
    expect(payload.result.structuredContent).toMatchObject({ ok: true, title: 'Via HTTP' });
    const stored = await toolkit.service.list({
      workspaceId: 'ws-http',
      actor: { type: 'agent', id: 'agent-7' },
    });
    expect(stored.items.map((item) => item.title)).toEqual(['Via HTTP']);
  });

  it('streams SSE responses when JSON responses are disabled', async () => {
    const handler = createArtkitMcpHttpHandler({
      toolkit: makeToolkit(),
      resolveScope: () => scope,
      enableJsonResponse: false,
    });
    const response = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('artifact_create');
  });
});
