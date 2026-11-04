import type { ArtifactSummary } from '@artkit/core';
import { ArrowUpRight } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useArtkit } from '../context.js';
import { KindIcon } from './icons.js';
import { cx, kindLabel, rootAttributes, type Slots, StatusBadge, slot } from './shared.js';

export type ArtifactCardPart = 'body' | 'title' | 'meta' | 'open';

export interface ArtifactCardProps {
  /** Summary or full artifact (only the summary fields are used). */
  artifact: Pick<ArtifactSummary, 'id' | 'kind' | 'title' | 'version' | 'status'>;
  onOpen?(artifact: ArtifactCardProps['artifact']): void;
  /** Render the open action as a link instead of a button. */
  href?: string;
  /** Shows a "generating" badge while the agent is still streaming the artifact. */
  streaming?: boolean;
  /** Extra actions rendered after the open action. */
  actions?: ReactNode;
  /** Icon or thumbnail rendered before the text. */
  icon?: ReactNode;
  className?: string;
  slots?: Slots<ArtifactCardPart>;
}

/** Compact card for chat messages: title, kind, version, status and an open action (spec §13.1). */
export function ArtifactCard(props: ArtifactCardProps) {
  const ctx = useArtkit();
  const { t } = ctx;
  const { artifact } = props;
  const openLabel = t('openTitle', { title: artifact.title });
  const titleId = useId();
  return (
    <article
      className={cx('ak-root ak-card', props.className)}
      {...rootAttributes(ctx)}
      aria-labelledby={titleId}
      data-kind={artifact.kind}
    >
      {props.icon ?? (
        <span className="ak-card-icon">
          <KindIcon kind={artifact.kind} />
        </span>
      )}
      <div {...slot(props.slots, 'body', 'ak-card-body')}>
        <h3 id={titleId} {...slot(props.slots, 'title', 'ak-card-title')}>
          {artifact.title}
        </h3>
        <div {...slot(props.slots, 'meta', 'ak-card-meta')}>
          <span>{kindLabel(ctx, artifact.kind)}</span>
          <span>
            <span className="ak-sr-only">{`${t('version')} ${artifact.version}`}</span>
            <span aria-hidden="true">{t('versionShort', { version: artifact.version })}</span>
          </span>
          <StatusBadge status={artifact.status} />
          {props.streaming ? (
            <span className="ak-badge" data-variant="provisional" role="status">
              {t('generating')}
            </span>
          ) : null}
        </div>
      </div>
      {props.href ? (
        <a
          {...slot(props.slots, 'open', 'ak-button')}
          href={props.href}
          aria-label={openLabel}
          onClick={props.onOpen ? () => props.onOpen?.(artifact) : undefined}
        >
          {t('open')}
          <ArrowUpRight aria-hidden="true" />
        </a>
      ) : props.onOpen ? (
        <button
          type="button"
          {...slot(props.slots, 'open', 'ak-button')}
          aria-label={openLabel}
          onClick={() => props.onOpen?.(artifact)}
        >
          {t('open')}
          <ArrowUpRight aria-hidden="true" />
        </button>
      ) : null}
      {props.actions}
    </article>
  );
}
