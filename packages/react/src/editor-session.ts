import {
  type Artifact,
  ArtifactError,
  type ArtifactRegistry,
  applyOperations,
  type ChangeSummary,
  isArtifactError,
  type LintIssue,
} from '@artkit-ai/core';

/**
 * Local draft of one artifact (spec §11.6). The editor never talks to the server while the user edits: every batch is
 * applied here, with the same pure engine as the server (`applyOperations`), and kept until the application saves.
 * Saving is the application's decision: the editor emits the draft and the application persists it (or not).
 */

export interface DraftSnapshot {
  /** Version of the artifact the draft started from (the last one the application loaded or saved). */
  baseVersion: number;
  /** The draft as the user sees it. */
  artifact: Artifact;
  /** Operations applied since `baseVersion`, in order. */
  operations: unknown[];
  /** True when the draft differs from the base. */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** An edit is being applied. */
  pending: boolean;
  /** Last rejected batch, cleared by the next accepted one. */
  error?: { code: string; message: string; issues: { path: string; message: string; hint?: string }[] };
  /** Lint issues of the draft. */
  lint: LintIssue[];
  /** Changes of the last accepted batch. */
  changes: ChangeSummary[];
}

export interface DraftSessionOptions {
  registry: ArtifactRegistry;
  artifact: Artifact;
  /** Locale of the model-facing messages produced by the engine (pt-BR or en). */
  locale?: string;
  /** Times within which consecutive typing batches share one undo step. */
  coalesceMs?: number;
  /** Undo steps kept in memory. */
  maxUndo?: number;
  now?: () => number;
}

interface Step {
  artifact: Artifact;
  operations: unknown[];
  at: number;
  typing: boolean;
}

export interface EmitOptions {
  /** Continuous gestures (typing, dragging) share one undo step; discrete changes always get their own. */
  kind?: 'typing' | 'continuous' | 'discrete';
}

type Listener = () => void;

const DEFAULT_COALESCE_MS = 1000;
const DEFAULT_MAX_UNDO = 200;

/** Draft of one artifact with local undo and redo. Batches are applied in order, one at a time. */
export class DraftSession {
  private readonly registry: ArtifactRegistry;
  private readonly locale: string;
  private readonly coalesceMs: number;
  private readonly maxUndo: number;
  private readonly now: () => number;
  private base: Artifact;
  private current: Step;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private error: DraftSnapshot['error'];
  private lint: LintIssue[];
  private changes: ChangeSummary[] = [];
  private snapshot: DraftSnapshot;
  private readonly listeners = new Set<Listener>();
  private disposed = false;

  constructor(options: DraftSessionOptions) {
    this.registry = options.registry;
    this.locale = options.locale ?? 'en';
    this.coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
    this.maxUndo = options.maxUndo ?? DEFAULT_MAX_UNDO;
    this.now = options.now ?? (() => Date.now());
    this.base = options.artifact;
    this.current = { artifact: options.artifact, operations: [], at: 0, typing: false };
    this.lint = this.lintOf(options.artifact);
    this.snapshot = this.buildSnapshot();
  }

  /** The current snapshot. Its identity changes only when the state changes. */
  getSnapshot = (): DraftSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Applies a batch to the draft. Resolves to `true` when the batch was accepted. A rejected batch leaves the draft
   * untouched and sets `snapshot.error`.
   */
  apply(operations: unknown[], options: EmitOptions = {}): Promise<boolean> {
    if (operations.length === 0) return Promise.resolve(true);
    this.pending += 1;
    this.publish();
    const run = this.queue.then(async () => {
      if (this.disposed) return false;
      const typing = options.kind === 'typing' || options.kind === 'continuous';
      try {
        const result = await applyOperations(this.registry, this.current.artifact, operations, {
          locale: this.locale,
        });
        const next: Artifact = {
          ...this.current.artifact,
          formatVersion: result.formatVersion,
          title: result.title,
          locale: result.locale,
          themeId: result.themeId,
          content: result.content,
        };
        const now = this.now();
        const coalesce = typing && this.current.typing && now - this.current.at <= this.coalesceMs;
        if (!coalesce) {
          this.undoStack.push(this.current);
          if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
        }
        this.redoStack = [];
        this.current = {
          artifact: next,
          operations: [...this.current.operations, ...operations],
          at: now,
          typing,
        };
        this.lint = result.lint;
        this.changes = result.diff;
        this.error = undefined;
        return true;
      } catch (error) {
        this.error = errorOf(error);
        return false;
      }
    });
    this.queue = run.finally(() => {
      this.pending -= 1;
      this.publish();
    });
    return run.then((accepted) => {
      this.publish();
      return accepted;
    });
  }

  /** Steps back one edit (local). Returns false when there is nothing to undo. */
  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.current);
    this.restore(previous);
    return true;
  }

  /** Steps forward after an undo. Returns false when there is nothing to redo. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.current);
    this.restore(next);
    return true;
  }

  /**
   * Adopts an artifact loaded or saved by the application. A clean draft follows the new artifact. A draft that has
   * changes keeps its content, and the base moves to the new version so the next save is a complete one.
   */
  load(artifact: Artifact): void {
    if (artifact.id !== this.base.id) throw new ArtifactError('INVALID_OPERATION', 'Load the same artifact.');
    const clean = !this.buildSnapshot().dirty;
    const sameContent = JSON.stringify(artifact.content) === JSON.stringify(this.current.artifact.content);
    this.base = artifact;
    if (clean || sameContent) {
      this.current = { artifact, operations: [], at: 0, typing: false };
      this.undoStack = [];
      this.redoStack = [];
      this.lint = this.lintOf(artifact);
      this.changes = [];
    }
    this.publish();
  }

  /** Stops the session: later batches are ignored and listeners are dropped. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private restore(step: Step): void {
    this.current = step;
    this.lint = this.lintOf(step.artifact);
    this.changes = [];
    this.error = undefined;
    this.publish();
  }

  private lintOf(artifact: Artifact): LintIssue[] {
    const adapter = this.registry.get(artifact.format, this.locale);
    return adapter.lint(artifact.content as never, {
      locale: artifact.locale,
      theme: this.registry.theme(artifact.themeId, this.locale),
    });
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): DraftSnapshot {
    const dirty =
      this.current.operations.length > 0 ||
      JSON.stringify(this.current.artifact.content) !== JSON.stringify(this.base.content) ||
      this.current.artifact.title !== this.base.title;
    return {
      baseVersion: this.base.version,
      artifact: this.current.artifact,
      operations: this.current.operations,
      dirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      pending: this.pending > 0,
      ...(this.error ? { error: this.error } : {}),
      lint: this.lint,
      changes: this.changes,
    };
  }
}

function errorOf(error: unknown): NonNullable<DraftSnapshot['error']> {
  if (isArtifactError(error)) {
    const payload = error.toPayload();
    return {
      code: payload.error.code,
      message: payload.error.message,
      issues: payload.error.issues ?? [],
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    issues: [],
  };
}
