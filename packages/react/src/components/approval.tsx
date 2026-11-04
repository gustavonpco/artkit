import type { Artifact } from '@artkit-ai/core';
import { Check, X } from 'lucide-react';
import { type CSSProperties, useId, useState } from 'react';
import { useArtkit } from '../context.js';
import { useArtifact } from '../hooks.js';
import {
  cx,
  ErrorMessage,
  Loading,
  rootAttributes,
  type Slots,
  StatusBadge,
  slot,
  useAnnouncer,
} from './shared.js';
import { ArtifactVersionDiff } from './version-diff.js';

export type ArtifactApprovalPart = 'header' | 'diff' | 'actions' | 'reason';

export interface ArtifactApprovalProps {
  id?: string;
  artifact?: Artifact;
  /** Require a reason to reject (default true). */
  requireReason?: boolean;
  onApproved?(artifact: Artifact): void;
  onRejected?(artifact: Artifact, reason: string): void;
  className?: string;
  slots?: Slots<ArtifactApprovalPart>;
}

/**
 * Review of the version waiting for approval (spec §13.1, §15.3): diff against the last published
 * version (`meta.publishedVersion`) or the previous one, plus approve and reject with a reason.
 */
export function ArtifactApproval(props: ArtifactApprovalProps) {
  const ctx = useArtkit();
  const { t, client, cache } = ctx;
  const id = props.id ?? props.artifact?.id;
  const query = useArtifact(id, props.artifact ? { initial: props.artifact } : {});
  const artifact = query.artifact;
  const [busy, setBusy] = useState<'approve' | 'reject' | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [live, announce] = useAnnouncer();
  const requireReason = props.requireReason ?? true;

  if (!artifact) {
    return (
      <div className={cx('ak-root ak-approval', props.className)} {...rootAttributes(ctx)}>
        {query.error ? <ErrorMessage error={query.error} /> : <Loading />}
      </div>
    );
  }

  const baseVersion =
    artifact.meta.publishedVersion !== undefined && artifact.meta.publishedVersion < artifact.version
      ? artifact.meta.publishedVersion
      : artifact.version > 1
        ? artifact.version - 1
        : undefined;
  const pending = artifact.status === 'pending_approval';

  async function decide(action: 'approve' | 'reject') {
    if (!artifact) return;
    const trimmed = reason.trim();
    if (action === 'reject' && requireReason && !trimmed) return;
    setBusy(action);
    setError(undefined);
    try {
      const updated = await client.setStatus(
        artifact.id,
        action,
        action === 'reject' ? trimmed || undefined : undefined,
      );
      cache.put(updated);
      if (action === 'approve') {
        announce(t('approved', { version: artifact.version }));
        props.onApproved?.(updated);
      } else {
        announce(t('rejected', { version: artifact.version }));
        setRejecting(false);
        setReason('');
        props.onRejected?.(updated, trimmed);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section
      className={cx('ak-root ak-approval', props.className)}
      {...rootAttributes(ctx, artifact.themeId)}
      aria-label={t('approvalTitle', { version: artifact.version })}
    >
      {live}
      <header {...slot(props.slots, 'header', 'ak-panel-header')}>
        <h2 className="ak-panel-title">{artifact.title}</h2>
        <StatusBadge status={artifact.status} />
        <span className="ak-history-meta">
          {t('approvalTitle', { version: artifact.version })}
          {' · '}
          {baseVersion === undefined
            ? t('approvalFirstVersion')
            : t('approvalComparedTo', { version: baseVersion })}
        </span>
      </header>
      <div {...slot(props.slots, 'diff', '')}>
        {baseVersion === undefined ? (
          <ArtifactVersionDiff after={artifact} showLines={false} />
        ) : (
          <ArtifactVersionDiff id={artifact.id} from={baseVersion} after={artifact} />
        )}
      </div>
      {error ? <ErrorMessage error={error} onDismiss={() => setError(undefined)} /> : null}
      {pending ? (
        <div {...slot(props.slots, 'actions', 'ak-approval-actions')}>
          {rejecting ? (
            <RejectForm
              busy={busy !== undefined}
              requireReason={requireReason}
              reason={reason}
              onReasonChange={setReason}
              onSubmit={() => void decide('reject')}
              onCancel={() => setRejecting(false)}
              {...(props.slots?.reason ? { textareaProps: props.slots.reason } : {})}
            />
          ) : (
            <>
              <button
                type="button"
                className="ak-button"
                data-variant="primary"
                disabled={busy !== undefined}
                onClick={() => void decide('approve')}
              >
                <Check aria-hidden="true" />
                {t('action_approve')}
              </button>
              <button
                type="button"
                className="ak-button"
                data-variant="danger"
                disabled={busy !== undefined}
                onClick={() => setRejecting(true)}
              >
                <X aria-hidden="true" />
                {t('action_reject')}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="ak-notice">{t('notPending')}</p>
      )}
    </section>
  );
}

export interface RejectFormProps {
  busy: boolean;
  requireReason: boolean;
  reason: string;
  onReasonChange(reason: string): void;
  onSubmit(): void;
  onCancel(): void;
  textareaProps?: { className?: string; style?: CSSProperties };
}

/** Inline rejection form shared by the approval view and the panel. Escape cancels. */
export function RejectForm(props: RejectFormProps) {
  const { t } = useArtkit();
  const reasonId = useId();
  return (
    <form
      className="ak-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <label htmlFor={reasonId}>{t('rejectReason')}</label>
      <textarea
        id={reasonId}
        className={cx('ak-textarea', props.textareaProps?.className)}
        style={props.textareaProps?.style}
        value={props.reason}
        required={props.requireReason}
        aria-describedby={`${reasonId}-help`}
        onChange={(event) => props.onReasonChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onCancel();
        }}
        // biome-ignore lint/a11y/noAutofocus: the reason field is the only purpose of the revealed form.
        autoFocus
      />
      <span id={`${reasonId}-help`} className="ak-history-meta">
        {t('rejectReasonRequired')}
      </span>
      <div className="ak-approval-actions">
        <button
          type="submit"
          className="ak-button"
          data-variant="danger"
          disabled={props.busy || (props.requireReason && !props.reason.trim())}
        >
          <X aria-hidden="true" />
          {t('confirmReject')}
        </button>
        <button type="button" className="ak-button" onClick={props.onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
