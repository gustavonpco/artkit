import type { Actor, ArtifactStatus, ArtifactSummary } from './envelope.js';
import type { ChangeSummary } from './kind.js';

/** Typed events (spec §15.4). They carry metadata only, never content. */
export type ArtifactEvent =
  | { type: 'artifact.created'; artifact: ArtifactSummary; actor: Actor }
  | {
      type: 'artifact.committed';
      artifact: ArtifactSummary;
      actor: Actor;
      operationCount: number;
      diff: ChangeSummary[];
      rebased: boolean;
    }
  | {
      type: 'artifact.conflict';
      artifactId: string;
      baseVersion: number;
      currentVersion: number;
      actor: Actor;
    }
  | {
      type: 'artifact.status_changed';
      artifact: ArtifactSummary;
      from: ArtifactStatus;
      to: ArtifactStatus;
      actor: Actor;
      message?: string;
    }
  | { type: 'artifact.exported'; artifact: ArtifactSummary; format: string; actor: Actor; warnings: number }
  | { type: 'artifact.lint'; artifactId: string; version: number; warnings: number };

export type ArtifactEventType = ArtifactEvent['type'];

export type EventHandler<T extends ArtifactEventType = ArtifactEventType> = (
  event: Extract<ArtifactEvent, { type: T }>,
) => void;

export interface EventBus {
  emit(event: ArtifactEvent): void;
  on<T extends ArtifactEventType>(type: T | '*', handler: EventHandler<T>): () => void;
}

/** In-process bus. Handler errors are swallowed so a listener never breaks a commit. */
export function createEventBus(onHandlerError?: (error: unknown) => void): EventBus {
  const handlers = new Map<string, Set<(event: ArtifactEvent) => void>>();
  return {
    emit(event) {
      for (const key of [event.type, '*']) {
        for (const handler of handlers.get(key) ?? []) {
          try {
            handler(event);
          } catch (error) {
            onHandlerError?.(error);
          }
        }
      }
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (event: ArtifactEvent) => void);
      handlers.set(type, set);
      return () => set.delete(handler as (event: ArtifactEvent) => void);
    },
  };
}
