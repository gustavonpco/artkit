import { Worker } from 'node:worker_threads';
import { ArtifactError, type ErrorIssue } from '@artkit-ai/core';
import type { SheetEngine } from '../engine.js';
import type { WorkbookContent } from '../model.js';
import type { ResolvedOperation } from '../operations.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';

export interface UniverPoolOptions {
  /** Worker threads (default 2). */
  size?: number;
  /** Time limit per batch; a batch over the limit fails and its worker is replaced (default 10 s). */
  timeoutMs?: number;
  /** Batches a worker serves before it is replaced with a fresh one, to bound memory growth (default 200). */
  recycleAfter?: number;
  /** Heap limit of each worker in MB (default 512). */
  maxOldGenerationSizeMb?: number;
  /** Compiled worker script; defaults to `worker.js` next to this module. */
  workerUrl?: URL;
}

export interface UniverPool extends SheetEngine {
  close(): Promise<void>;
  stats(): { size: number; busy: number; queued: number; recycled: number };
}

interface Task {
  request: WorkerRequest;
  resolve(content: WorkbookContent): void;
  reject(error: ArtifactError): void;
}

interface Slot {
  worker?: Worker;
  runs: number;
  current?: { task: Task; timer: ReturnType<typeof setTimeout> };
}

const DEFAULTS = { size: 2, timeoutMs: 10_000, recycleAfter: 200, maxOldGenerationSizeMb: 512 };

function unavailable(hint: string): ArtifactError {
  return new ArtifactError('ENGINE_UNAVAILABLE', 'O motor de cálculo está indisponível.', {
    issues: [{ path: 'content', message: 'O recálculo não pôde ser concluído.', hint } as ErrorIssue],
  });
}

/**
 * Pool of Univer workers (spec §11.1, §18, §21): batches run in isolated threads with a heap limit, a time limit and
 * a recycle count. A timed-out or crashed worker is replaced, and the batch fails with `ENGINE_UNAVAILABLE`.
 */
export function createUniverPool(options: UniverPoolOptions = {}): UniverPool {
  const config = { ...DEFAULTS, ...options };
  const workerUrl = options.workerUrl ?? new URL('./worker.js', import.meta.url);
  const slots: Slot[] = Array.from({ length: config.size }, () => ({ runs: 0 }));
  const queue: Task[] = [];
  let nextId = 1;
  let recycled = 0;
  let closed = false;

  const spawn = (slot: Slot) => {
    // Workers load the compiled package: they must not inherit the host's execution flags (tests add source conditions).
    const worker = new Worker(workerUrl, {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: config.maxOldGenerationSizeMb },
    });
    slot.worker = worker;
    slot.runs = 0;
    worker.on('message', (response: WorkerResponse) => finish(slot, response));
    worker.on('error', () => crash(slot));
    worker.on('exit', () => {
      if (slot.worker === worker && !closed) crash(slot);
    });
  };

  const replace = (slot: Slot) => {
    const old = slot.worker;
    slot.worker = undefined;
    if (old) void old.terminate();
    if (!closed) spawn(slot);
  };

  const crash = (slot: Slot) => {
    const current = slot.current;
    slot.current = undefined;
    if (current) {
      clearTimeout(current.timer);
      current.task.reject(unavailable('Reduza o tamanho do lote e tente de novo.'));
    }
    replace(slot);
    dispatch();
  };

  const finish = (slot: Slot, response: WorkerResponse) => {
    const current = slot.current;
    if (!current || current.task.request.id !== response.id) return;
    clearTimeout(current.timer);
    slot.current = undefined;
    slot.runs += 1;
    if (response.ok) current.task.resolve(response.content);
    else
      current.task.reject(
        new ArtifactError(response.error.code as ArtifactError['code'], response.error.message, {
          ...(response.error.issues ? { issues: response.error.issues as ErrorIssue[] } : {}),
          ...(response.error.details ? { details: response.error.details } : {}),
        }),
      );
    if (slot.runs >= config.recycleAfter) {
      recycled += 1;
      replace(slot);
    }
    dispatch();
  };

  const dispatch = () => {
    for (const slot of slots) {
      if (queue.length === 0) return;
      if (slot.current) continue;
      if (!slot.worker) {
        if (closed) continue;
        spawn(slot);
      }
      const task = queue.shift()!;
      const timer = setTimeout(() => {
        const current = slot.current;
        if (!current || current.task !== task) return;
        slot.current = undefined;
        task.reject(unavailable('O lote excedeu o tempo limite; reduza as fórmulas e tente de novo.'));
        recycled += 1;
        replace(slot);
        dispatch();
      }, config.timeoutMs + 500);
      slot.current = { task, timer };
      slot.worker!.postMessage(task.request);
    }
  };

  for (const slot of slots) spawn(slot);

  return {
    execute(
      content: WorkbookContent,
      operations: ResolvedOperation[],
      runOptions: { locale: string; timeoutMs?: number },
    ) {
      if (closed) return Promise.reject(unavailable('O pool foi fechado.'));
      return new Promise<WorkbookContent>((resolve, reject) => {
        queue.push({
          request: {
            id: nextId++,
            content,
            operations,
            options: { ...runOptions, timeoutMs: runOptions.timeoutMs ?? config.timeoutMs },
          },
          resolve,
          reject,
        });
        dispatch();
      });
    },
    async close() {
      closed = true;
      for (const task of queue.splice(0)) task.reject(unavailable('O pool foi fechado.'));
      await Promise.all(
        slots.map(async (slot) => {
          if (slot.current) {
            clearTimeout(slot.current.timer);
            slot.current.task.reject(unavailable('O pool foi fechado.'));
            slot.current = undefined;
          }
          const worker = slot.worker;
          slot.worker = undefined;
          if (worker) await worker.terminate();
        }),
      );
    },
    stats() {
      return {
        size: slots.length,
        busy: slots.filter((slot) => slot.current).length,
        queued: queue.length,
        recycled,
      };
    },
  };
}
