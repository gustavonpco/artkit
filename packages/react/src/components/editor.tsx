import type { Artifact, EditorActions, EmitOptions } from '@artkit-ai/core';
import { Redo2, Save, Undo2 } from 'lucide-react';
import { type KeyboardEvent, Suspense, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { type ArtkitContextValue, useArtkit } from '../context.js';
import { DraftSession, type DraftSnapshot } from '../editor-session.js';
import { useArtifact } from '../hooks.js';
import { hashString } from '../styles.js';
import { cx, ErrorBoundary, ErrorMessage, Loading, rootAttributes, type Slots, slot } from './shared.js';
import { ArtifactView, renderContext } from './view.js';

/**
 * What the application receives when the user clicks Save. The library does not store anything: the application
 * decides what saving means (a new version, a database row, a sync to another system, nothing at all).
 */
export interface SaveEvent {
  artifactId: string;
  format: string;
  /** Version the draft started from. Pass it back as `baseVersion` when you apply `operations` yourself. */
  baseVersion: number;
  title: string;
  locale: string;
  themeId: string;
  /** Full content of the draft. */
  content: unknown;
  /** Operations applied since `baseVersion`, in order. */
  operations: unknown[];
}

export type ArtifactEditorPart = 'toolbar' | 'status' | 'body';

export interface ArtifactEditorProps {
  /** Artifact to edit. Its content is the starting point of the draft. */
  artifact?: Artifact;
  /** Load the artifact by id through the client when `artifact` is not given. */
  id?: string;
  /** Read-only edition: the format editor is hidden and the view is shown instead. */
  readOnly?: boolean;
  /** Save action. Called with the draft; the application persists it and passes the saved artifact back. */
  onSave?(event: SaveEvent): void | Promise<void>;
  /** Called after every change of the draft. */
  onChange?(snapshot: DraftSnapshot): void;
  className?: string;
  slots?: Slots<ArtifactEditorPart>;
}

/**
 * Editor of one artifact (spec §11.6). Edits are applied to a local draft; nothing reaches the server. The Save button
 * emits the draft through `onSave`, and Ctrl/Cmd+S does the same. Undo and redo are local.
 */
export function ArtifactEditor(props: ArtifactEditorProps) {
  const ctx = useArtkit();
  const fetched = useArtifact(props.artifact ? undefined : props.id);
  const artifact = props.artifact ?? fetched.artifact;

  if (!artifact) {
    return (
      <div className={cx('ak-root ak-editor', props.className)} {...rootAttributes(ctx)}>
        {fetched.error ? (
          <ErrorMessage error={fetched.error} onRetry={() => void fetched.refresh().catch(() => undefined)} />
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  const editable = !props.readOnly && ctx.hasEditor(artifact.format) && ctx.registry.has(artifact.format);
  if (!editable) {
    return (
      <div
        className={cx('ak-root ak-editor', props.className)}
        {...rootAttributes(ctx, artifact.themeId)}
        data-readonly="true"
      >
        <ArtifactView artifact={artifact} />
      </div>
    );
  }
  return <EditingHost key={artifact.id} {...props} artifact={artifact} />;
}

function EditingHost({
  artifact,
  readOnly,
  onSave,
  onChange,
  className,
  slots,
}: ArtifactEditorProps & { artifact: Artifact }) {
  const ctx = useArtkit();
  const [session] = useState(
    () => new DraftSession({ registry: ctx.registry, artifact, locale: ctx.locale }),
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>();

  // A newer artifact from the application (after a save, or a reload) moves the draft forward.
  useEffect(() => {
    if (
      artifact.version !== session.getSnapshot().baseVersion ||
      artifact.id !== session.getSnapshot().artifact.id
    ) {
      session.load(artifact);
    }
  }, [artifact, session]);

  useEffect(() => {
    onChange?.(snapshot);
  }, [snapshot, onChange]);

  const draft = snapshot.artifact;
  const canSave = Boolean(onSave) && snapshot.dirty && !saving && !readOnly;

  async function save() {
    if (!canSave || !onSave) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave({
        artifactId: draft.id,
        format: draft.format,
        baseVersion: snapshot.baseVersion,
        title: draft.title,
        locale: draft.locale,
        themeId: draft.themeId,
        content: draft.content,
        operations: snapshot.operations,
      });
    } catch (error) {
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      void save();
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      session.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      session.redo();
    }
  }

  const emit = (operations: unknown[], options?: EmitOptions) => {
    void session.apply(operations, { ...(options?.kind ? { kind: options.kind } : {}) });
  };

  const actions: EditorActions = {
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    undo: () => session.undo(),
    redo: () => session.redo(),
    dirty: snapshot.dirty,
    saving,
    canSave,
    save: () => void save(),
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the shortcuts (Ctrl/Cmd+S, Z, Y) cover the whole editor.
    <section
      className={cx('ak-root ak-editor', className)}
      {...rootAttributes(ctx, draft.themeId)}
      data-dirty={snapshot.dirty || undefined}
      onKeyDown={onKeyDown}
    >
      {snapshot.error ? <ErrorMessage error={snapshot.error} onDismiss={() => session.undo()} /> : null}
      {saveError ? <ErrorMessage error={saveError} /> : null}

      <div {...slot(slots, 'body', 'ak-editor-body')}>
        <ErrorBoundary fallback={(error) => <ErrorMessage error={error} />}>
          <Suspense fallback={<Loading />}>
            <LoadedEditor
              slots={slots}
              actions={actions}
              format={draft.format}
              content={draft.content}
              ctx={ctx}
              themeId={draft.themeId}
              locale={draft.locale}
              emit={emit}
              readOnly={Boolean(readOnly)}
              lint={snapshot.lint}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  );
}

function LoadedEditor({
  format,
  content,
  ctx,
  themeId,
  locale,
  emit,
  readOnly,
  lint,
  actions,
  slots,
}: {
  slots?: Slots<ArtifactEditorPart>;
  actions: EditorActions;
  format: string;
  content: unknown;
  ctx: ArtkitContextValue;
  themeId: string;
  locale: string;
  emit(operations: unknown[], options?: EmitOptions): void;
  readOnly: boolean;
  lint: DraftSnapshot['lint'];
}) {
  const { Editor, css, toolbar } = use(ctx.loadEditor(format));
  const renderCtx = useMemo(
    () => renderContext(ctx, themeId, locale, 'screen', false),
    [ctx, themeId, locale],
  );
  return (
    <>
      {css ? (
        <style href={`artkit-editor-${format}-${hashString(css)}`} precedence="artkit" nonce={ctx.nonce}>
          {css}
        </style>
      ) : null}
      {toolbar === 'format' ? null : <HostToolbar actions={actions} slots={slots} />}
      <Editor
        content={content}
        ctx={renderCtx}
        emit={emit}
        readOnly={readOnly}
        lint={lint}
        actions={actions}
      />
    </>
  );
}

/** Undo, redo, save status and save, drawn by the host above editors that do not draw their own toolbar. */
function HostToolbar({ actions, slots }: { actions: EditorActions; slots?: Slots<ArtifactEditorPart> }) {
  const { t } = useArtkit();
  return (
    <header {...slot(slots, 'toolbar', 'ak-editor-toolbar')}>
      <div className="ak-editor-history">
        <button
          type="button"
          className="ak-button"
          data-variant="quiet"
          disabled={!actions.canUndo}
          onClick={actions.undo}
          aria-label={t('undo')}
          title={t('undo')}
        >
          <Undo2 aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ak-button"
          data-variant="quiet"
          disabled={!actions.canRedo}
          onClick={actions.redo}
          aria-label={t('redo')}
          title={t('redo')}
        >
          <Redo2 aria-hidden="true" />
        </button>
      </div>
      <span {...slot(slots, 'status', 'ak-editor-status')} role="status" aria-live="polite">
        {actions.dirty ? t('unsaved') : t('saved')}
      </span>
      <button
        type="button"
        className="ak-button"
        data-variant="primary"
        disabled={!actions.canSave}
        onClick={actions.save}
      >
        <Save aria-hidden="true" />
        {actions.saving ? t('saving') : t('save')}
      </button>
    </header>
  );
}
