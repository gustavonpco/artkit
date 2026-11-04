import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactError,
  createArtifactService,
  createMemoryAssetStore,
  createMemoryStore,
  createRegistry,
  type Scope,
} from '@artkit/core';
import { afterAll } from 'vitest';
import { noteKind } from './note-kind.js';

const dirs: string[] = [];

/** Fresh temporary directory, removed after the test file finishes. */
export async function tempDir(prefix = 'artkit-node-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

export const user: Scope = { workspaceId: 'ws_1', actor: { type: 'user', id: 'u1' } };
export const agent: Scope = { workspaceId: 'ws_1', actor: { type: 'agent', id: 'a1' } };
export const otherWorkspace: Scope = { workspaceId: 'ws_2', actor: { type: 'user', id: 'u2' } };

export async function rejection(promise: Promise<unknown>): Promise<ArtifactError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected rejection');
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

/** Service over the core memory stores with the note kind and a markdown exporter. */
export function noteService(options: Partial<Parameters<typeof createArtifactService>[0]> = {}) {
  const registry = createRegistry({ kinds: [noteKind] });
  registry.registerExporter({
    kind: 'note',
    format: 'md',
    mimeType: 'text/markdown',
    extension: 'md',
    runtime: 'any',
    async export(content: { items: { text: string }[] }, ctx) {
      ctx.warn('note export is lossy');
      return new TextEncoder().encode(content.items.map((item) => item.text).join('\n'));
    },
  });
  registry.registerExporter({
    kind: 'note',
    format: 'png',
    mimeType: 'image/png',
    extension: 'png',
    runtime: 'any',
    export: async () => PNG,
  });
  registry.registerExporter({
    kind: 'note',
    format: 'html',
    mimeType: 'text/html',
    extension: 'html',
    runtime: 'any',
    // Never resolves unless aborted: used to test timeouts and client disconnects.
    export: (_content, ctx) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason), { once: true });
      }),
  });
  return createArtifactService({
    registry,
    store: createMemoryStore(),
    assets: createMemoryAssetStore(),
    locale: 'en',
    ...options,
  });
}
