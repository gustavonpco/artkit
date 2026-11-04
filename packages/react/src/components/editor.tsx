import type { Actor, Artifact, ArtifactError, CommitResult, EmitOptions, LintIssue } from '@artkit-ai/core';
import { Redo2, RotateCcw, Undo2 } from 'lucide-react';
import {
  type FocusEvent,
  type KeyboardEvent,
  Suspense,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useArtkit } from '../context.js';
import { EditorSession, type EditorSessionState } from '../editor-session.js';
import { useArtifact } from '../hooks.js';
import type { UiMessageKey } from '../i18n.js';
import { hashString } from '../styles.js';
import {
  ChangeList,
  cx,
  ErrorBoundary,
  ErrorMessage,
  errorMessage,
  formatDate,
  Loading,
  rootAttributes,
  type Slots,
  slot,
  useAnnouncer,
} from './shared.js';
import { ArtifactView, KindRenderer, renderContext } from './view.js';

export type EditorPermission = 'read' | 'edit';
export type ArtifactEditorPart = 'toolbar' | 'status' | 'body' | 'conflict' | 'error' | 'notice';

export interface ArtifactEditorProps {
  id?: string;
  /** Latest known artifact (e.g. from a chat message); newer versions from the cache win. */
  artifact?: Artifact;
  /** Set by the application (spec §13.6). `comment` arrives in phase 3. Default `edit`. */
  permission?: EditorPermission;
  /** Another actor holds the lock: the editor turns read-only and shows `partial` as a streaming preview. */
  lockedBy?: Actor | null;
  /** Streamed content shown while locked (see `ArtifactView`). */
  partial?: unknown;
  /** Typing batches are grouped within this window (default 600 ms). */
  groupingWindowMs?: number;
  onCommitted?(result: CommitResult): void;
  onError?(error: ArtifactError): void;
  className?: string;
  slots?: Slots<ArtifactEditorPart>;
}

/**
 * Kind editor host (spec §13.1, §13.6). Falls back to `ArtifactView` when the kind has no editor loader,
 * when the permission is `read` or while another actor holds the lock. The editor module is only loaded
 * here, when editing starts.
 */
export function ArtifactEditor(props: ArtifactEditorProps) {
  const ctx = useArtkit();
  const { t } = ctx;
  const id = props.id ?? props.artifact?.id;
  const query = useArtifact(id, props.artifact ? { initial: props.artifact } : {});
  const artifact = query.artifact;

  if (!artifact) {
    return (
      <div className={cx('ak-root ak-editor', props.className)} {...rootAttributes(ctx)}>
        {query.error ? (
          <ErrorMessage error={query.error} onRetry={() => void query.refresh().catch(() => undefined)} />
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const editable =
    (props.permission ?? 'edit') === 'edit' &&
    ctx.hasEditor(artifact.kind) &&
    ctx.registry.has(artifact.kind);
  if (!editable || props.lockedBy) {
    return (
      <div
        className={cx('ak-root ak-editor', props.className)}
        {...rootAttributes(ctx, artifact.themeId)}
        data-readonly="true"
      >
        {props.lockedBy ? (
          <p {...slot(props.slots, 'notice', 'ak-notice')} role="status">
            {t('lockedBy', { actor: t(`actor_${props.lockedBy.type}` as UiMessageKey) })}
          </p>
        ) : null}
        <ArtifactView
          artifact={artifact}
          {...(props.lockedBy && props.partial !== undefined ? { partial: props.partial } : {})}
        />
      </div>
    );
  }
  return <EditingHost key={artifact.id} {...props} artifact={artifact} />;
}

function EditingHost(props: ArtifactEditorProps & { artifact: Artifact }) {
  const ctx = useArtkit();
  const { t, client, cache, registry } = ctx;
  const callbacks = useRef(props);
  callbacks.current = props;
  const artifactId = props.artifact.id;

  const [session] = useState(
    () =>
      new EditorSession({
        registry,
        artifact: props.artifact,
        locale: ctx.locale,
        ...(props.groupingWindowMs === undefined ? {} : { groupingWindowMs: props.groupingWindowMs }),
        send: (request) => client.apply(artifactId, request),
        load: (version) => cache.load(artifactId, version, version === undefined),
        onCommitted: (result) => {
          cache.put(result.artifact);
          callbacks.current.onCommitted?.(result);
        },
      }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  // Newer versions from the cache or props (agent commits, refetches) are rebased into the session.
  useEffect(() => {
    session.receive(props.artifact);
  }, [session, props.artifact]);

  useEffect(() => {
    cache.put(state.confirmed);
  }, [cache, state.confirmed]);

  // Unmounting must not lose the last keystrokes still waiting in the grouping window.
  useEffect(() => () => session.flush(), [session]);

  const [live, announce] = useAnnouncer();
  const lastSeq = useRef(0);
  useEffect(() => {
    const event = state.event;
    if (!event || event.seq === lastSeq.current) return;
    lastSeq.current = event.seq;
    switch (event.type) {
      case 'saved':
        announce(t('savedVersion', { version: event.version }));
        break;
      case 'undone':
        announce(t('undone'));
        break;
      case 'redone':
        announce(t('redone'));
        break;
      case 'rebased':
        announce(t('agentUpdated', { version: event.version }));
        break;
      case 'rejected':
      case 'rolled_back':
        announce(t('rolledBack', { message: errorMessage(event.error, event.error.message) }));
        callbacks.current.onError?.(event.error);
        break;
      case 'conflict':
        announce(t('conflictTitle'));
        break;
      case 'conflict_resolved':
        break;
    }
  }, [state.event, announce, t]);

  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!state.lockedUntil) return;
    const delay = Date.parse(state.lockedUntil) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => forceRender((n) => n + 1), delay + 10);
    return () => clearTimeout(timer);
  }, [state.lockedUntil]);
  const locked = state.lockedUntil !== undefined && Date.parse(state.lockedUntil) > Date.now();
  const readOnly = state.status === 'conflict' || locked;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        session.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        session.redo();
      }
    },
    [session],
  );

  const onBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) session.flush();
    },
    [session],
  );

  const view = state.view;
  const renderCtx = useMemo(
    () => renderContext(ctx, view.themeId, view.locale, 'screen', false),
    [ctx, view.themeId, view.locale],
  );
  const lint = useMemo<LintIssue[]>(() => {
    try {
      return registry
        .get(props.artifact.kind)
        .lint(view.content, { locale: view.locale, theme: ctx.themeFor(view.themeId) });
    } catch {
      return [];
    }
  }, [ctx, registry, props.artifact.kind, view]);
  const emit = useCallback(
    (operations: unknown[], options?: EmitOptions) => {
      session.emit(operations, options);
    },
    [session],
  );

  const statusText =
    state.status === 'saving'
      ? t('saving')
      : state.status === 'editing'
        ? t('unsaved')
        : state.status === 'conflict'
          ? t('conflictTitle')
          : t('saved');

  return (
    <section
      className={cx('ak-root ak-editor', props.className)}
      {...rootAttributes(ctx, view.themeId)}
      aria-label={t('editorLabel', { title: view.title })}
      lang={view.locale}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      data-status={state.status}
    >
      {live}
      <div
        {...slot(props.slots, 'toolbar', 'ak-editor-toolbar')}
        role="toolbar"
        aria-label={t('editorLabel', { title: view.title })}
      >
        <button
          type="button"
          className="ak-button"
          onClick={session.undo}
          disabled={!state.canUndo}
          aria-keyshortcuts="Control+Z Meta+Z"
        >
          <Undo2 aria-hidden="true" />
          {t('undo')}
        </button>
        <button
          type="button"
          className="ak-button"
          onClick={session.redo}
          disabled={!state.canRedo}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        >
          <Redo2 aria-hidden="true" />
          {t('redo')}
        </button>
        {lint.length > 0 ? (
          <span className="ak-badge">{t('lintWarnings', { count: lint.length })}</span>
        ) : null}
        <span {...slot(props.slots, 'status', 'ak-editor-status')} aria-hidden="true">
          {statusText}
        </span>
      </div>
      {locked && state.lockedUntil ? (
        <p {...slot(props.slots, 'notice', 'ak-notice')} role="status">
          {t('lockedUntil', { time: formatDate(state.lockedUntil, ctx.locale) })}
        </p>
      ) : null}
      {state.error && state.status !== 'conflict' ? (
        <ErrorMessage
          error={state.error}
          onDismiss={session.dismissError}
          {...slot(props.slots, 'error', '')}
        />
      ) : null}
      {state.conflict ? <ConflictBox state={state} session={session} slots={props.slots} /> : null}
      <div {...slot(props.slots, 'body', 'ak-view-body')}>
        <ErrorBoundary
          onReset={() => ctx.resetLoad('editor', props.artifact.kind)}
          fallback={(error, reset) => (
            <>
              <ErrorMessage error={error} onRetry={reset} />
              <KindRenderer kind={props.artifact.kind} content={view.content} ctx={renderCtx} />
            </>
          )}
        >
          <Suspense
            fallback={<KindRenderer kind={props.artifact.kind} content={view.content} ctx={renderCtx} />}
          >
            <LoadedEditor
              kind={props.artifact.kind}
              content={view.content}
              ctx={renderCtx}
              emit={emit}
              readOnly={readOnly}
              lint={lint}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  );
}

function ConflictBox({
  state,
  session,
  slots,
}: {
  state: EditorSessionState;
  session: EditorSession;
  slots?: Slots<ArtifactEditorPart> | undefined;
}) {
  const { t } = useArtkit();
  const conflict = state.conflict!;
  const first = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    first.current?.focus();
  }, []);
  const undoing = conflict.reason === 'undo' || conflict.reason === 'redo';
  return (
    <section {...slot(slots, 'conflict', 'ak-conflict')} role="alert" aria-labelledby={titleId}>
      <h3 className="ak-conflict-title" id={titleId}>
        {t('conflictTitle')}
      </h3>
      <p>{undoing ? t('conflictUndoBody') : t('conflictBody', { version: conflict.latest.version })}</p>
      <ChangeList changes={conflict.changes} />
      <div className="ak-approval-actions">
        <button
          ref={first}
          type="button"
          className="ak-button"
          data-variant="primary"
          onClick={() => session.resolveConflict('keep-theirs')}
        >
          {t('keepTheirs')}
        </button>
        <button type="button" className="ak-button" onClick={() => session.resolveConflict('reapply')}>
          <RotateCcw aria-hidden="true" />
          {t('reapplyMine')}
        </button>
      </div>
    </section>
  );
}

function LoadedEditor({
  kind,
  content,
  ctx: renderCtx,
  emit,
  readOnly,
  lint,
}: {
  kind: string;
  content: unknown;
  ctx: ReturnType<typeof renderContext>;
  emit(operations: unknown[], options?: EmitOptions): void;
  readOnly: boolean;
  lint: LintIssue[];
}) {
  const ctx = useArtkit();
  const { Editor, css } = use(ctx.loadEditor(kind));
  return (
    <>
      {css ? (
        <style href={`artkit-editor-${kind}-${hashString(css)}`} precedence="artkit" nonce={ctx.nonce}>
          {css}
        </style>
      ) : null}
      <Editor content={content} ctx={renderCtx} emit={emit} readOnly={readOnly} lint={lint} />
    </>
  );
}
