import type { ArtifactStatus, ChangeSummary } from '@artkit/core';
import { isArtifactError } from '@artkit/core';
import { RotateCw } from 'lucide-react';
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type ArtkitContextValue, useArtkit } from '../context.js';
import type { UiMessageKey } from '../i18n.js';

/**
 * Customization without forking (spec §13.5): each named part of a component accepts extra classes and
 * inline styles. Base classes (`ak-*`) stay, so overrides compose with the default CSS.
 */
export type Slots<Part extends string> = Partial<Record<Part, { className?: string; style?: CSSProperties }>>;

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function slot<Part extends string>(
  slots: Slots<Part> | undefined,
  part: Part,
  base: string,
): { className: string; style?: CSSProperties } {
  const custom = slots?.[part];
  return { className: cx(base, custom?.className), ...(custom?.style ? { style: custom.style } : {}) };
}

/** Attributes of every artkit root element: theme scope and forced light/dark. */
export function rootAttributes(ctx: ArtkitContextValue, themeId?: string): Record<string, string> {
  return {
    ...(themeId ? { 'data-ak-theme': themeId } : {}),
    ...(ctx.colorScheme !== 'system' ? { 'data-theme': ctx.colorScheme } : {}),
  };
}

export function StatusBadge({ status, className }: { status: ArtifactStatus; className?: string }) {
  const { t } = useArtkit();
  return (
    <span className={cx('ak-badge', className)} data-status={status}>
      {t(`status_${status}` as UiMessageKey)}
    </span>
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  if (isArtifactError(error)) {
    const hint = error.issues.find((issue) => issue.hint)?.hint;
    return hint ? `${error.message} ${hint}` : error.message;
  }
  return fallback;
}

export function ErrorMessage({
  error,
  onRetry,
  onDismiss,
  className,
  style,
}: {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useArtkit();
  return (
    <div role="alert" className={cx('ak-alert', className)} style={style}>
      <span>{errorMessage(error, t('loadFailed'))}</span>{' '}
      {onRetry ? (
        <button type="button" className="ak-button" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          {t('retry')}
        </button>
      ) : null}
      {onDismiss ? (
        <button type="button" className="ak-button" onClick={onDismiss}>
          {t('dismiss')}
        </button>
      ) : null}
    </div>
  );
}

export function Loading({
  label,
  className,
  style,
}: {
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useArtkit();
  return (
    <div className={cx('ak-loading', className)} style={style} role="status" aria-busy="true">
      {label ?? t('loading')}
    </div>
  );
}

/**
 * Polite live region for screen readers (spec §18.2). The text is cleared first so repeating the same
 * message is announced again.
 */
export function useAnnouncer(): [ReactNode, (message: string) => void] {
  const [message, setMessage] = useState('');
  const frame = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(frame.current), []);
  const announce = useCallback((text: string) => {
    setMessage('');
    clearTimeout(frame.current);
    frame.current = setTimeout(() => setMessage(text), 30);
  }, []);
  const node = (
    <div className="ak-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
  return [node, announce];
}

export function ChangeList({
  changes,
  className,
  style,
}: {
  changes: ChangeSummary[];
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useArtkit();
  if (changes.length === 0) return <p className="ak-notice">{t('noChanges')}</p>;
  return (
    <ul className={cx('ak-changes', className)} style={style}>
      {withKeys(changes).map(({ change, key }) => (
        <li key={key} className="ak-change" data-type={change.type}>
          <span className="ak-change-type">{t(`change_${change.type}` as UiMessageKey)}</span>
          <span className="ak-change-target">{change.target}</span>
          <span className="ak-change-summary">{change.summary}</span>
        </li>
      ))}
    </ul>
  );
}

// Targets can repeat (changed + moved); a per-target counter keeps keys stable across renders.
function withKeys(changes: ChangeSummary[]): { change: ChangeSummary; key: string }[] {
  const seen = new Map<string, number>();
  return changes.map((change) => {
    const base = `${change.type}:${change.target}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { change, key: count === 0 ? base : `${base}#${count}` };
  });
}

interface BoundaryProps {
  fallback: (error: unknown, reset: () => void) => ReactNode;
  onReset?: () => void;
  children?: ReactNode;
}

/** Catches loader and renderer failures so one broken kind does not take the page down. */
export class ErrorBoundary extends Component<BoundaryProps, { error: unknown; failed: boolean }> {
  override state = { error: undefined as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Rendering the fallback is enough; the host app can wrap its own reporting boundary around us.
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: undefined, failed: false });
  };

  override render() {
    if (this.state.failed) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

export function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function kindLabel(ctx: ArtkitContextValue, kind: string): string {
  return ctx.registry.has(kind) ? ctx.registry.get(kind).label : kind;
}
