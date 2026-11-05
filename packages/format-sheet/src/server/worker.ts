import { parentPort } from 'node:worker_threads';
import { ArtifactError } from '@artkit-ai/core';
import type { WorkbookContent } from '../model.js';
import type { ResolvedOperation } from '../operations.js';
import { createUniverEngine } from '../univer-engine.js';

/**
 * Worker side of the Univer pool (spec §11.1): one engine per worker thread, requests in, results or model errors out.
 * Errors cross the thread boundary as plain objects and are rebuilt as `ArtifactError` by the pool.
 */
export interface WorkerRequest {
  id: number;
  content: WorkbookContent;
  operations: ResolvedOperation[];
  options: { locale: string; timeoutMs?: number };
}

export type WorkerResponse =
  | { id: number; ok: true; content: WorkbookContent }
  | {
      id: number;
      ok: false;
      error: { code: string; message: string; issues?: unknown[]; details?: Record<string, unknown> };
    };

if (parentPort) {
  const engine = createUniverEngine();
  const port = parentPort;
  port.on('message', async (request: WorkerRequest) => {
    try {
      const content = await engine.execute(request.content, request.operations, request.options);
      const response: WorkerResponse = { id: request.id, ok: true, content };
      port.postMessage(response);
    } catch (error) {
      const failure =
        error instanceof ArtifactError
          ? { code: error.code, message: error.message, issues: error.issues, details: error.details }
          : { code: 'ENGINE_UNAVAILABLE', message: 'Falha no motor de cálculo.' };
      const response: WorkerResponse = { id: request.id, ok: false, error: failure };
      port.postMessage(response);
    }
  });
}
