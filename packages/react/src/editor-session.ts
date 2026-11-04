import {
  type Artifact,
  ArtifactError,
  type ArtifactRegistry,
  applyOperations,
  type ChangeSummary,
  type CommitResult,
  deepEqual,
  type EmitOptions,
  isArtifactError,
} from '@artkit/core';

/** The editable part of an artifact: content plus the envelope fields operations can change. */
export interface EnvelopeState {
  content: unknown;
  title: string;
  themeId: string;
  locale: string;
}

export interface SendRequest {
  baseVersion: number;
  operations: unknown[];
  idempotencyKey: string;
}

export interface EditorSessionOptions {
  registry: ArtifactRegistry;
  /** Last confirmed version. */
  artifact: Artifact;
  /** Commits a batch (usually `client.apply`). */
  send(request: SendRequest): Promise<CommitResult>;
  /** Loads the latest version, or a specific one, after a conflict or a rebased commit. */
  load(version?: number): Promise<Artifact>;
  /** Typing operations emitted within this window become one batch (default 600 ms). */
  groupingWindowMs?: number;
  /** Upper bound for one typing batch while the user keeps typing (default 5 s). */
  maxGroupingMs?: number;
  /** Undo entries kept (default 100). */
  maxUndo?: number;
  /** Locale of error messages produced locally. */
  locale?: string;
  createKey?(): string;
  onCommitted?(result: CommitResult): void;
}

export type SessionStatus = 'idle' | 'editing' | 'saving' | 'conflict';

export interface SessionConflict {
  /**
   * `server`: the server answered VERSION_CONFLICT; `rebase`: a newer version arrived and the pending
   * operations no longer apply on it; `undo`/`redo`: the artifact changed after the edit being undone.
   */
  reason: 'server' | 'rebase' | 'undo' | 'redo';
  /** What changed in the newer version, for the conflict diff. */
  changes: ChangeSummary[];
  /** The local operations that would be reapplied. */
  operations: unknown[];
  latest: Artifact;
}

export type SessionEvent =
  | { type: 'saved'; version: number }
  | { type: 'undone'; version: number }
  | { type: 'redone'; version: number }
  | { type: 'rebased'; version: number }
  | { type: 'rejected'; error: ArtifactError }
  | { type: 'rolled_back'; error: ArtifactError }
  | { type: 'conflict'; reason: SessionConflict['reason'] }
  | { type: 'conflict_resolved'; choice: ConflictChoice };

export type ConflictChoice = 'keep-theirs' | 'reapply';

export interface EditorSessionState {
  confirmed: Artifact;
  /** Optimistic state: confirmed version plus every unconfirmed local operation. */
  view: EnvelopeState;
  status: SessionStatus;
  /** Local operations not confirmed yet (buffered, queued or in flight). */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error?: ArtifactError;
  conflict?: SessionConflict;
  /** Set after a LOCKED rejection; editing stays disabled until then. */
  lockedUntil?: string;
  /** Last notable event, with a sequence number so hosts can announce each one once. */
  event?: SessionEvent & { seq: number };
}

interface UndoEntry {
  /** Missing when the commit was rebased: loaded from `beforeVersion` on demand. */
  before?: EnvelopeState;
  beforeVersion: number;
  after: EnvelopeState;
}

type Origin = 'edit' | 'undo' | 'redo' | 'reapply';

type QueueItem =
  | { type: 'ops'; ops: unknown[]; key: string; origin: Origin; entry?: UndoEntry }
  | { type: 'undo' }
  | { type: 'redo' };

export function envelopeOf(
  artifact: Pick<Artifact, 'content' | 'title' | 'themeId' | 'locale'>,
): EnvelopeState {
  return {
    content: artifact.content,
    title: artifact.title,
    themeId: artifact.themeId,
    locale: artifact.locale,
  };
}

function sameEnvelope(a: EnvelopeState, b: EnvelopeState): boolean {
  return (
    a.title === b.title && a.themeId === b.themeId && a.locale === b.locale && deepEqual(a.content, b.content)
  );
}

/**
 * Operations that turn `from` into `to`. Kinds do not provide inverse operations, so undo and redo send
 * `replace_content` with the snapshot (plus envelope operations); the commit still becomes a new version
 * (spec §8.5).
 */
export function operationsBetween(from: EnvelopeState, to: EnvelopeState): unknown[] {
  const ops: unknown[] = [];
  if (!deepEqual(from.content, to.content))
    ops.push({ op: 'replace_content', content: structuredClone(to.content) });
  if (from.title !== to.title) ops.push({ op: 'set_title', title: to.title });
  if (from.themeId !== to.themeId) ops.push({ op: 'set_theme', themeId: to.themeId });
  if (from.locale !== to.locale) ops.push({ op: 'set_locale', locale: to.locale });
  return ops;
}

function toArtifactError(error: unknown): ArtifactError {
  if (isArtifactError(error)) return error;
  return new ArtifactError('INTERNAL_ERROR', 'Internal error while processing the request.', {
    cause: error,
  });
}

function defaultKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `ak-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Framework-free editing session behind `ArtifactEditor` (spec §13.6): batching of typing operations,
 * optimistic apply with the kind's own logic, rollback on rejection, local undo/redo over the user's own
 * batches, rebase of pending operations on newer versions, conflict resolution and lock handling.
 *
 * Batches are sent one at a time, each against the version the previous one produced.
 */
export class EditorSession {
  private readonly options: EditorSessionOptions;
  private readonly windowMs: number;
  private readonly maxGroupingMs: number;
  private readonly maxUndo: number;
  private confirmed: Artifact;
  private view: EnvelopeState;
  private buffer: unknown[] = [];
  private bufferStartedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lockTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: QueueItem[] = [];
  private inflight = false;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private error: ArtifactError | undefined;
  private conflict: (SessionConflict & { origin: Origin; entry?: UndoEntry }) | undefined;
  private lockedUntil: string | undefined;
  private deferredRemote: Artifact | undefined;
  private event: (SessionEvent & { seq: number }) | undefined;
  private seq = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private idleWaiters: (() => void)[] = [];
  private snapshot: EditorSessionState;

  constructor(options: EditorSessionOptions) {
    this.options = options;
    this.windowMs = options.groupingWindowMs ?? 600;
    this.maxGroupingMs = options.maxGroupingMs ?? 5000;
    this.maxUndo = options.maxUndo ?? 100;
    this.confirmed = options.artifact;
    this.view = envelopeOf(options.artifact);
    this.snapshot = this.buildSnapshot();
  }

  // -- subscription ---------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSessionState => this.snapshot;

  /** Resolves once nothing is buffered, queued or in flight (or a conflict is waiting for the user). */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle(): boolean {
    return (
      this.buffer.length === 0 && !this.inflight && (this.queue.length === 0 || this.conflict !== undefined)
    );
  }

  private buildSnapshot(): EditorSessionState {
    const pendingEdits = this.queue.filter(
      (item) => item.type === 'ops' && item.origin !== 'undo' && item.origin !== 'redo',
    ).length;
    const queuedUndo = this.queue.filter((item) => item.type === 'undo').length;
    const queuedRedo = this.queue.filter((item) => item.type === 'redo').length;
    const dirty = this.buffer.length > 0 || this.queue.length > 0 || this.inflight;
    let status: SessionStatus = 'idle';
    if (this.conflict) status = 'conflict';
    else if (this.inflight || this.queue.length > 0) status = 'saving';
    else if (this.buffer.length > 0) status = 'editing';
    const blocked = this.conflict !== undefined || this.isLocked();
    return {
      confirmed: this.confirmed,
      view: this.view,
      status,
      dirty,
      canUndo:
        !blocked && this.undoStack.length + pendingEdits + (this.buffer.length > 0 ? 1 : 0) > queuedUndo,
      canRedo:
        !blocked && this.buffer.length === 0 && pendingEdits === 0 && this.redoStack.length > queuedRedo,
      ...(this.error ? { error: this.error } : {}),
      ...(this.conflict
        ? {
            conflict: {
              reason: this.conflict.reason,
              changes: this.conflict.changes,
              operations: this.conflict.operations,
              latest: this.conflict.latest,
            },
          }
        : {}),
      ...(this.lockedUntil ? { lockedUntil: this.lockedUntil } : {}),
      ...(this.event ? { event: this.event } : {}),
    };
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
    if (this.isIdle() && this.idleWaiters.length > 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private announce(event: SessionEvent): void {
    this.seq += 1;
    this.event = { ...event, seq: this.seq };
  }

  private isLocked(): boolean {
    return this.lockedUntil !== undefined && Date.parse(this.lockedUntil) > Date.now();
  }

  // -- local application -----------------------------------------------------------------------------

  private applyLocal(state: EnvelopeState, ops: unknown[]): EnvelopeState {
    const result = applyOperations(
      this.options.registry,
      { kind: this.confirmed.kind, ...state },
      ops,
      this.options.locale ? { locale: this.options.locale } : {},
    );
    return { content: result.content, title: result.title, themeId: result.themeId, locale: result.locale };
  }

  private pendingOperations(): unknown[] {
    const ops: unknown[] = [];
    for (const item of this.queue) if (item.type === 'ops') ops.push(...item.ops);
    ops.push(...this.buffer);
    return ops;
  }

  /**
   * Recomputes the optimistic view from the confirmed version. When the unconfirmed operations no
   * longer apply, they move into a `rebase` conflict and the view falls back to the confirmed version.
   */
  private rebaseView(previous: Artifact): void {
    let state = envelopeOf(this.confirmed);
    try {
      for (const item of this.queue) if (item.type === 'ops') state = this.applyLocal(state, item.ops);
      if (this.buffer.length > 0) state = this.applyLocal(state, this.buffer);
      this.view = state;
    } catch {
      const operations = this.pendingOperations();
      this.clearTimer();
      this.buffer = [];
      // The in-flight batch (if any) is already at the server and settles on its own.
      this.queue = this.inflight ? this.queue.slice(0, 1) : [];
      this.view = envelopeOf(this.confirmed);
      this.conflict = {
        reason: 'rebase',
        changes: this.changesBetween(previous, this.confirmed),
        operations,
        latest: this.confirmed,
        origin: 'edit',
      };
      this.announce({ type: 'conflict', reason: 'rebase' });
    }
  }

  private changesBetween(before: EnvelopeState, after: EnvelopeState): ChangeSummary[] {
    const changes: ChangeSummary[] = [];
    if (before.title !== after.title)
      changes.push({
        type: 'changed',
        target: 'envelope:title',
        summary: `'${before.title}' → '${after.title}'`,
      });
    if (before.themeId !== after.themeId)
      changes.push({
        type: 'changed',
        target: 'envelope:themeId',
        summary: `${before.themeId} → ${after.themeId}`,
      });
    if (before.locale !== after.locale)
      changes.push({
        type: 'changed',
        target: 'envelope:locale',
        summary: `${before.locale} → ${after.locale}`,
      });
    try {
      changes.push(...this.options.registry.get(this.confirmed.kind).diff(before.content, after.content));
    } catch {
      // A diff failure must not hide the conflict itself.
    }
    return changes;
  }

  // -- editing ---------------------------------------------------------------------------------------

  /**
   * Called by the kind editor. Operations are applied optimistically right away; invalid ones are
   * rejected locally (returns false) and never reach the server.
   */
  emit = (operations: unknown[], options: EmitOptions = {}): boolean => {
    if (
      this.disposed ||
      this.conflict ||
      this.isLocked() ||
      !Array.isArray(operations) ||
      operations.length === 0
    )
      return false;
    try {
      this.view = this.applyLocal(this.view, operations);
    } catch (error) {
      this.error = toArtifactError(error);
      this.announce({ type: 'rejected', error: this.error });
      this.notify();
      return false;
    }
    this.error = undefined;
    this.redoStack = [];
    const maxOps = this.options.registry.batch.maxOperations;
    if (options.kind === 'typing') {
      if (this.buffer.length + operations.length > maxOps) this.flushBuffer();
      if (this.buffer.length === 0) this.bufferStartedAt = Date.now();
      this.buffer.push(...operations);
      if (Date.now() - this.bufferStartedAt >= this.maxGroupingMs) this.flushBuffer();
      else this.schedule();
    } else {
      // Discrete operations and the end of continuous gestures flush right away, after pending typing.
      this.flushBuffer();
      this.queue.push({ type: 'ops', ops: operations, key: this.key(), origin: 'edit' });
    }
    this.pump();
    this.notify();
    return true;
  };

  /** Sends buffered typing operations now (e.g. on blur or before navigation). */
  flush(): void {
    if (this.buffer.length === 0) return;
    this.flushBuffer();
    this.pump();
    this.notify();
  }

  private key(): string {
    return this.options.createKey?.() ?? defaultKey();
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.windowMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private flushBuffer(): void {
    this.clearTimer();
    if (this.buffer.length === 0) return;
    this.queue.push({ type: 'ops', ops: this.buffer, key: this.key(), origin: 'edit' });
    this.buffer = [];
  }

  undo = (): void => {
    if (!this.snapshot.canUndo) return;
    this.flushBuffer();
    this.queue.push({ type: 'undo' });
    this.pump();
    this.notify();
  };

  redo = (): void => {
    if (!this.snapshot.canRedo) return;
    this.queue.push({ type: 'redo' });
    this.pump();
    this.notify();
  };

  dismissError = (): void => {
    if (!this.error) return;
    this.error = undefined;
    this.notify();
  };

  // -- sending ---------------------------------------------------------------------------------------

  private pump(): void {
    if (this.inflight || this.conflict) return;
    const item = this.queue[0];
    if (!item) return;
    if (item.type === 'undo' || item.type === 'redo') {
      this.resolveHistoryCommand(item.type);
      return;
    }
    this.inflight = true;
    const base = this.confirmed;
    this.options
      .send({ baseVersion: base.version, operations: item.ops, idempotencyKey: item.key })
      .then(
        (result) => this.onCommitted(item, base, result),
        (error: unknown) => this.onRejected(item, base, error),
      )
      .finally(() => this.notify());
  }

  private resolveHistoryCommand(direction: 'undo' | 'redo'): void {
    const stack = direction === 'undo' ? this.undoStack : this.redoStack;
    const entry = stack.pop();
    if (!entry) {
      this.queue.shift();
      this.pump();
      return;
    }
    if (!entry.before) {
      // Rebased commit: the version before it is only known by the server.
      this.inflight = true;
      this.options
        .load(entry.beforeVersion)
        .then(
          (artifact) => {
            entry.before = envelopeOf(artifact);
            stack.push(entry);
          },
          (error: unknown) => {
            this.queue.shift();
            this.error = toArtifactError(error);
            this.announce({ type: 'rolled_back', error: this.error });
          },
        )
        .finally(() => {
          this.inflight = false;
          this.applyDeferred();
          this.pump();
          this.notify();
        });
      return;
    }
    const current = envelopeOf(this.confirmed);
    const expected = direction === 'undo' ? entry.after : entry.before;
    const target = direction === 'undo' ? entry.before : entry.after;
    this.queue.shift();
    if (!sameEnvelope(current, expected)) {
      // Someone else changed the artifact after this edit: undoing blindly would discard their work.
      this.conflict = {
        reason: direction,
        changes: this.changesBetween(expected, current),
        operations: operationsBetween(current, target),
        latest: this.confirmed,
        origin: direction,
        entry,
      };
      this.view = current;
      this.announce({ type: 'conflict', reason: direction });
      return;
    }
    const ops = operationsBetween(current, target);
    if (ops.length === 0) {
      (direction === 'undo' ? this.redoStack : this.undoStack).push(entry);
      this.pump();
      return;
    }
    this.queue.unshift({ type: 'ops', ops, key: this.key(), origin: direction, entry });
    this.rebaseView(this.confirmed);
    this.pump();
  }

  private onCommitted(item: Extract<QueueItem, { type: 'ops' }>, base: Artifact, result: CommitResult): void {
    this.inflight = false;
    this.queue.shift();
    const previous = this.confirmed;
    if (result.artifact.version > this.confirmed.version) this.confirmed = result.artifact;
    const after = envelopeOf(result.artifact);
    if (item.origin === 'undo' && item.entry) {
      this.redoStack.push(item.entry);
      this.announce({ type: 'undone', version: result.version });
    } else if (item.origin === 'redo' && item.entry) {
      this.pushUndo(item.entry);
      this.announce({ type: 'redone', version: result.version });
    } else {
      this.pushUndo({
        ...(result.rebased ? {} : { before: envelopeOf(base) }),
        beforeVersion: result.version - 1,
        after,
      });
      this.announce({ type: 'saved', version: result.version });
    }
    try {
      this.options.onCommitted?.(result);
    } catch {
      // A failing host callback must not break the session.
    }
    if (!this.disposed) this.rebaseView(previous);
    this.applyDeferred();
    this.pump();
  }

  /** Incorporates a version that arrived while a request was in flight. */
  private applyDeferred(): void {
    const remote = this.deferredRemote;
    this.deferredRemote = undefined;
    if (remote && remote.version > this.confirmed.version) this.incorporate(remote);
  }

  private pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxUndo) this.undoStack.splice(0, this.undoStack.length - this.maxUndo);
  }

  private onRejected(
    item: Extract<QueueItem, { type: 'ops' }>,
    base: Artifact,
    raw: unknown,
  ): Promise<void> | void {
    const error = toArtifactError(raw);
    this.queue.shift();
    if (error.code === 'VERSION_CONFLICT') {
      const operations = [...item.ops, ...this.pendingOperations()];
      this.clearTimer();
      this.queue = [];
      this.buffer = [];
      const changes = Array.isArray(error.details.changesSinceBase)
        ? (error.details.changesSinceBase as ChangeSummary[])
        : undefined;
      // Keep `inflight` set while loading so nothing else is sent against a stale base.
      return this.options
        .load()
        .then(
          (latest) => {
            if (latest.version > this.confirmed.version) this.confirmed = latest;
          },
          () => undefined,
        )
        .then(() => {
          this.inflight = false;
          const remote = this.deferredRemote;
          this.deferredRemote = undefined;
          if (remote && remote.version > this.confirmed.version) this.confirmed = remote;
          const reason = item.origin === 'undo' || item.origin === 'redo' ? item.origin : 'server';
          this.conflict = {
            reason,
            changes: changes ?? this.changesBetween(base, this.confirmed),
            operations: item.origin === 'undo' || item.origin === 'redo' ? item.ops : operations,
            latest: this.confirmed,
            origin: item.origin,
            ...(item.entry ? { entry: item.entry } : {}),
          };
          this.view = envelopeOf(this.confirmed);
          this.announce({ type: 'conflict', reason });
        });
    }
    this.inflight = false;
    // Any other rejection rolls back to the last confirmed version (spec §13.6).
    this.clearTimer();
    this.queue = [];
    this.buffer = [];
    if (item.entry) (item.origin === 'undo' ? this.undoStack : this.redoStack).push(item.entry);
    if (error.code === 'LOCKED') this.setLocked(error);
    this.error = error;
    this.view = envelopeOf(this.confirmed);
    this.announce({ type: 'rolled_back', error });
    const remote = this.deferredRemote;
    this.deferredRemote = undefined;
    if (remote && remote.version > this.confirmed.version) {
      this.confirmed = remote;
      this.view = envelopeOf(remote);
    }
  }

  private setLocked(error: ArtifactError): void {
    const expiresAt =
      typeof error.details.expiresAt === 'string'
        ? error.details.expiresAt
        : new Date(Date.now() + 60_000).toISOString();
    this.lockedUntil = expiresAt;
    if (this.lockTimer !== undefined) clearTimeout(this.lockTimer);
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
    this.lockTimer = setTimeout(() => {
      this.lockTimer = undefined;
      this.lockedUntil = undefined;
      this.notify();
    }, delay);
  }

  // -- remote versions ---------------------------------------------------------------------------------

  /**
   * A version arrived from outside the session (refetch, agent commit, prop). Pending local operations
   * are rebased on it; when they no longer apply, a `rebase` conflict asks the user what to keep.
   */
  receive = (artifact: Artifact): void => {
    if (this.disposed || artifact.id !== this.confirmed.id) return;
    if (artifact.version < this.confirmed.version) return;
    if (artifact.version === this.confirmed.version) {
      if (
        artifact.status !== this.confirmed.status ||
        artifact.meta.publishedVersion !== this.confirmed.meta.publishedVersion
      ) {
        this.confirmed = { ...this.confirmed, status: artifact.status, meta: artifact.meta };
        this.notify();
      }
      return;
    }
    if (this.inflight) {
      // Wait for the in-flight batch: applying it on top of a version that may already contain it
      // would show its operations twice.
      if (!this.deferredRemote || artifact.version > this.deferredRemote.version)
        this.deferredRemote = artifact;
      return;
    }
    this.incorporate(artifact);
    this.notify();
  };

  private incorporate(artifact: Artifact): void {
    const previous = this.confirmed;
    this.confirmed = artifact;
    if (this.conflict) {
      this.conflict.latest = artifact;
      this.view = envelopeOf(artifact);
    } else {
      this.rebaseView(previous);
      if (!this.conflict) this.announce({ type: 'rebased', version: artifact.version });
    }
  }

  resolveConflict = (choice: ConflictChoice): void => {
    const conflict = this.conflict;
    if (!conflict) return;
    this.conflict = undefined;
    this.error = undefined;
    this.view = envelopeOf(this.confirmed);
    if (choice === 'reapply') {
      if (conflict.origin === 'undo' || conflict.origin === 'redo') {
        const entry = conflict.entry;
        const target = entry ? (conflict.origin === 'undo' ? entry.before : entry.after) : undefined;
        const ops = target ? operationsBetween(envelopeOf(this.confirmed), target) : [];
        if (ops.length > 0) {
          this.queue.unshift({
            type: 'ops',
            ops,
            key: this.key(),
            origin: conflict.origin,
            ...(entry ? { entry } : {}),
          });
        }
      } else {
        try {
          this.applyLocal(envelopeOf(this.confirmed), conflict.operations);
          this.queue.unshift({ type: 'ops', ops: conflict.operations, key: this.key(), origin: 'reapply' });
        } catch (error) {
          this.error = toArtifactError(error);
          this.announce({ type: 'rolled_back', error: this.error });
          this.pump();
          this.notify();
          return;
        }
      }
      this.rebaseView(this.confirmed);
    }
    this.announce({ type: 'conflict_resolved', choice });
    this.pump();
    this.notify();
  };

  /**
   * Stops timers and listeners. Buffered typing is still sent unless `discard` is set, so closing the
   * editor right after typing does not lose the last keystrokes.
   */
  dispose(options: { discard?: boolean } = {}): void {
    if (this.disposed) return;
    if (options.discard) {
      this.buffer = [];
      this.queue = this.inflight ? this.queue.slice(0, 1) : [];
    } else {
      this.flushBuffer();
      this.pump();
    }
    this.clearTimer();
    if (this.lockTimer !== undefined) clearTimeout(this.lockTimer);
    this.disposed = true;
    this.listeners.clear();
  }
}
