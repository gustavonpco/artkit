#!/usr/bin/env node
// artkit MCP server over stdio for desktop MCP clients (spec §14.5).
// Configuration comes from command-line flags, never from environment variables.
//   node server.mjs --dir ~/.artkit --workspace personal [--locale pt-BR] [--profile default|strict|compact]
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createArtifactToolkit } from '@artkit/agent';
import { createRegistry } from '@artkit/core';
import { diagramKind } from '@artkit/kind-diagram';
import { diagramExporters } from '@artkit/kind-diagram/export';
import { documentKind } from '@artkit/kind-document';
import { documentExporters } from '@artkit/kind-document/export';
import { sheetKind } from '@artkit/kind-sheet';
import { sheetExporters } from '@artkit/kind-sheet/export';
import { slidesKind } from '@artkit/kind-slides';
import { slidesExporters } from '@artkit/kind-slides/export';
import { connectStdio, createArtkitMcpServer } from '@artkit/mcp';
import { createFsAssetStore, createFsStore } from '@artkit/node';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: resolve(homedir(), '.artkit') },
    workspace: { type: 'string', default: 'personal' },
    locale: { type: 'string', default: 'en' },
    profile: { type: 'string', default: 'default' },
  },
});
if (!['default', 'strict', 'compact'].includes(values.profile)) {
  console.error('--profile must be default, strict or compact');
  process.exit(1);
}

const dir = resolve(values.dir);
const registry = createRegistry({
  kinds: [documentKind, sheetKind, slidesKind, diagramKind],
  exporters: [...documentExporters, ...sheetExporters, ...slidesExporters, ...diagramExporters],
});
const toolkit = createArtifactToolkit({
  registry,
  store: createFsStore({ dir: resolve(dir, 'store') }),
  assets: createFsAssetStore({ dir: resolve(dir, 'assets') }),
  // A local single-user server: every call acts in the configured workspace.
  authorize: (_action, _artifact, scope) => scope.workspaceId === values.workspace,
  locale: values.locale,
  schemaProfile: values.profile,
});
const server = createArtkitMcpServer({
  toolkit,
  resolveScope: () => ({ workspaceId: values.workspace, actor: { type: 'agent', id: 'mcp-client' } }),
});
await connectStdio(server);
// stdout carries the protocol; diagnostics go to stderr.
console.error(`artkit MCP server ready (workspace "${values.workspace}", data in ${dir})`);
