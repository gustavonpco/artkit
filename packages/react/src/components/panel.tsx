import type { Actor, Artifact, ArtifactStatus, VersionEntry } from '@artkit/core';
import { Archive, Check, ChevronDown, Copy, Download, Eye, History, Rocket, Send, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { StatusAction } from '../client.js';
import { useArtkit } from '../context.js';
import { useArtifact, useArtifactExport, useArtifactHistory } from '../hooks.js';
import type { UiMessageKey } from '../i18n.js';
import { RejectForm } from './approval.js';
import { ArtifactEditor, type EditorPermission } from './editor.js';
import {
  ChangeList,
  cx,
  ErrorMessage,
  formatDate,
  kindLabel,
  Loading,
  rootAttributes,
  type Slots,
  StatusBadge,
  slot,
  useAnnouncer,
} from './shared.js';
import { ArtifactView } from './view.js';

export type PanelTab = 'view' | 'code' | 'history';
export type ArtifactPanelPart = 'header' | 'title' | 'toolbar' | 'tabs' | 'body' | 'code' | 'history';

export interface ArtifactPanelProps {
  id?: string;
  artifact?: Artifact;
  tab?: PanelTab;
  defaultTab?: PanelTab;
  onTabChange?(tab: PanelTab): void;
  /** Selected version (undefined = latest). Controlled when `onVersionChange` is given with it. */
  version?: number;
  onVersionChange?(version: number | undefined): void;
  /** `edit` shows the kind editor in the View tab for the latest version (default `read`). */
  permission?: EditorPermission;
  /** Streaming preview and lock state, forwarded to the view/editor. */
  partial?: unknown;
  lockedBy?: Actor | null;
  /** Lifecycle actions offered; defaults depend on the status. `false` hides them. */
  actions?: StatusAction[] | false;
  /** Export formats; defaults to the provider's server formats plus browser exporters. */
  exportFormats?: string[];
  onClose?(): void;
  /** Extra controls rendered in the header. */
  headerActions?: ReactNode;
  className?: string;
  slots?: Slots<ArtifactPanelPart>;
}

const DEFAULT_ACTIONS: Record<ArtifactStatus, StatusAction[]> = {
  draft: ['submit', 'archive'],
  pending_approval: ['approve', 'reject', 'archive'],
  published: ['archive'],
  archived: [],
};

const ACTION_FROM: Record<StatusAction, ArtifactStatus[]> = {
  submit: ['draft'],
  approve: ['pending_approval'],
  reject: ['pending_approval'],
  publish: ['draft', 'pending_approval'],
  archive: ['draft', 'pending_approval', 'published'],
};

const TABS: PanelTab[] = ['view', 'code', 'history'];
const TAB_LABEL: Record<PanelTab, UiMessageKey> = { view: 'tabView', code: 'tabCode', history: 'tabHistory' };

/** Assistant-style side panel: View, Code and History tabs, version selector, export and lifecycle (spec §13.1). */
export function ArtifactPanel(props: ArtifactPanelProps) {
  const ctx = useArtkit();
  const { t, client, cache } = ctx;
  const id = props.id ?? props.artifact?.id;
  const latestQuery = useArtifact(id, props.artifact ? { initial: props.artifact } : {});
  const latest = latestQuery.artifact;

  const [ownTab, setOwnTab] = useState<PanelTab>(props.defaultTab ?? 'view');
  const tab = props.tab ?? ownTab;
  const selectTab = (next: PanelTab) => {
    setOwnTab(next);
    props.onTabChange?.(next);
  };
  const [ownVersion, setOwnVersion] = useState<number | undefined>(undefined);
  const selectedVersion = props.onVersionChange ? props.version : (props.version ?? ownVersion);
  const selectVersion = (next: number | undefined) => {
    setOwnVersion(next);
    props.onVersionChange?.(next);
  };
  const viewingLatest = selectedVersion === undefined || selectedVersion === latest?.version;
  const selectedQuery = useArtifact(
    viewingLatest ? undefined : id,
    selectedVersion === undefined ? {} : { version: selectedVersion },
  );
  const shown = viewingLatest ? latest : selectedQuery.artifact;

  const history = useArtifactHistory(id);
  const exporter = useArtifactExport(id ?? '', latest?.kind);
  const [live, announce] = useAnnouncer();
  const [statusBusy, setStatusBusy] = useState<StatusAction | undefined>(undefined);
  const [actionError, setActionError] = useState<unknown>(undefined);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const baseId = useId();

  if (!latest || !id) {
    return (
      <aside className={cx('ak-root ak-panel', props.className)} {...rootAttributes(ctx)}>
        {latestQuery.error ? (
          <ErrorMessage
            error={latestQuery.error}
            onRetry={() => void latestQuery.refresh().catch(() => undefined)}
          />
        ) : (
          <Loading />
        )}
      </aside>
    );
  }

  const actions = (props.actions === false ? [] : (props.actions ?? DEFAULT_ACTIONS[latest.status])).filter(
    (action) => ACTION_FROM[action].includes(latest.status),
  );

  async function runAction(action: StatusAction, message?: string) {
    if (!latest) return;
    setStatusBusy(action);
    setActionError(undefined);
    try {
      const updated = await client.setStatus(latest.id, action, message);
      cache.put(updated);
      announce(t('statusChanged', { status: t(`status_${updated.status}` as UiMessageKey) }));
      setRejecting(false);
      setReason('');
    } catch (error) {
      setActionError(error);
    } finally {
      setStatusBusy(undefined);
    }
  }

  async function restore(version: number) {
    try {
      const result = await history.restore(version);
      announce(t('restored', { version, newVersion: result.version }));
      selectVersion(undefined);
    } catch (error) {
      setActionError(error);
    }
  }

  async function exportAs(format: string) {
    try {
      const result = await exporter.exportArtifact(
        format,
        viewingLatest ? {} : { version: selectedVersion! },
      );
      announce(t('exported', { filename: result.filename }));
    } catch {
      // The hook keeps the error; it is rendered below.
    }
  }

  const tabId = (name: PanelTab) => `${baseId}-tab-${name}`;
  const panelId = (name: PanelTab) => `${baseId}-panel-${name}`;
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    let next: PanelTab | undefined;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
    else if (event.key === 'ArrowLeft') next = TABS[(index + TABS.length - 1) % TABS.length];
    else if (event.key === 'Home') next = TABS[0];
    else if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  const versionOptions = mergeVersions(history.entries, latest.version);
  const exportFormats = props.exportFormats ?? exporter.formats;

  return (
    <aside
      className={cx('ak-root ak-panel', props.className)}
      {...rootAttributes(ctx, latest.themeId)}
      aria-labelledby={`${baseId}-title`}
      data-kind={latest.kind}
    >
      {live}
      <header {...slot(props.slots, 'header', 'ak-panel-header')}>
        <h2 id={`${baseId}-title`} {...slot(props.slots, 'title', 'ak-panel-title')}>
          {latest.title}
        </h2>
        <span className="ak-history-meta">{kindLabel(ctx, latest.kind)}</span>
        <StatusBadge status={latest.status} />
        {props.headerActions}
        {props.onClose ? (
          <button
            type="button"
            className="ak-button"
            data-variant="quiet"
            onClick={props.onClose}
            aria-label={t('close')}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div {...slot(props.slots, 'toolbar', 'ak-panel-toolbar')}>
        <label htmlFor={`${baseId}-version`}>{t('version')}</label>
        <select
          id={`${baseId}-version`}
          className="ak-select"
          value={viewingLatest ? '' : String(selectedVersion)}
          onChange={(event) =>
            selectVersion(event.target.value === '' ? undefined : Number(event.target.value))
          }
        >
          <option value="">{`${t('versionShort', { version: latest.version })} (${t('latest')})`}</option>
          {versionOptions
            .filter((version) => version !== latest.version)
            .map((version) => (
              <option key={version} value={String(version)}>
                {t('versionShort', { version })}
              </option>
            ))}
        </select>
        <ExportMenu
          formats={exportFormats}
          pending={exporter.pending}
          onOpen={() => void exporter.loadFormats()}
          onSelect={(format) => void exportAs(format)}
        />
        {actions.map((action) =>
          action === 'reject' ? (
            <button
              key={action}
              type="button"
              className="ak-button"
              data-variant="danger"
              disabled={statusBusy !== undefined}
              onClick={() => setRejecting(true)}
            >
              <X aria-hidden="true" />
              {t('action_reject')}
            </button>
          ) : (
            <button
              key={action}
              type="button"
              className="ak-button"
              data-variant={
                action === 'approve' || action === 'submit' || action === 'publish' ? 'primary' : undefined
              }
              disabled={statusBusy !== undefined}
              onClick={() => void runAction(action)}
            >
              <ActionIcon action={action} />
              {t(`action_${action}` as UiMessageKey)}
            </button>
          ),
        )}
      </div>
      {rejecting ? (
        <div className="ak-panel-toolbar">
          <RejectForm
            busy={statusBusy !== undefined}
            requireReason
            reason={reason}
            onReasonChange={setReason}
            onSubmit={() => void runAction('reject', reason.trim())}
            onCancel={() => setRejecting(false)}
          />
        </div>
      ) : null}
      {actionError ? <ErrorMessage error={actionError} onDismiss={() => setActionError(undefined)} /> : null}
      {exporter.error ? <ErrorMessage error={exporter.error} /> : null}
      {exporter.warnings.length > 0 ? (
        <div className="ak-notice" role="status">
          {t('exportWarnings')}
          <ul>
            {exporter.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div {...slot(props.slots, 'tabs', 'ak-tabs')} role="tablist" aria-label={t('tabsLabel')}>
        {TABS.map((name) => (
          <button
            key={name}
            id={tabId(name)}
            type="button"
            role="tab"
            className="ak-tab"
            aria-selected={tab === name}
            aria-controls={panelId(name)}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => selectTab(name)}
            onKeyDown={onTabKeyDown}
          >
            {t(TAB_LABEL[name])}
          </button>
        ))}
      </div>
      <div
        {...slot(props.slots, 'body', 'ak-panel-body')}
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
      >
        {tab === 'view' ? (
          viewingLatest && (props.permission === 'edit' || props.lockedBy) ? (
            <ArtifactEditor
              artifact={latest}
              permission={props.permission ?? 'read'}
              {...(props.lockedBy ? { lockedBy: props.lockedBy } : {})}
              {...(props.partial === undefined ? {} : { partial: props.partial })}
            />
          ) : shown ? (
            <ArtifactView
              artifact={shown}
              {...(viewingLatest && props.partial !== undefined ? { partial: props.partial } : {})}
            />
          ) : selectedQuery.error ? (
            <ErrorMessage error={selectedQuery.error} />
          ) : (
            <Loading />
          )
        ) : null}
        {tab === 'code' ? <CodeTab artifact={shown} slots={props.slots} /> : null}
        {tab === 'history' ? (
          <HistoryTab
            history={history}
            latestVersion={latest.version}
            selectedVersion={viewingLatest ? latest.version : selectedVersion}
            slots={props.slots}
            onView={(version) => {
              selectVersion(version === latest.version ? undefined : version);
              selectTab('view');
            }}
            onRestore={(version) => void restore(version)}
          />
        ) : null}
      </div>
    </aside>
  );
}

function mergeVersions(entries: VersionEntry[], latest: number): number[] {
  const versions = new Set<number>([latest, ...entries.map((entry) => entry.version)]);
  return [...versions].sort((a, b) => b - a);
}

function CodeTab({
  artifact,
  slots,
}: {
  artifact: Artifact | undefined;
  slots?: Slots<ArtifactPanelPart> | undefined;
}) {
  const { t } = useArtkit();
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => (artifact ? JSON.stringify(artifact.content, null, 2) : ''), [artifact]);
  if (!artifact) return <Loading />;
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  return (
    <div className="ak-code-tab">
      {clipboard ? (
        <button
          type="button"
          className="ak-button"
          onClick={() => {
            clipboard.writeText(text).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          <Copy aria-hidden="true" />
          {copied ? t('copied') : t('copy')}
        </button>
      ) : null}
      <pre {...slot(slots, 'code', 'ak-code')}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function HistoryTab(props: {
  history: ReturnType<typeof useArtifactHistory>;
  latestVersion: number;
  selectedVersion: number | undefined;
  onView(version: number): void;
  onRestore(version: number): void;
  slots?: Slots<ArtifactPanelPart> | undefined;
}) {
  const ctx = useArtkit();
  const { t } = ctx;
  const { history } = props;
  if (history.error && history.entries.length === 0)
    return <ErrorMessage error={history.error} onRetry={() => void history.refresh()} />;
  if (history.loading && history.entries.length === 0) return <Loading />;
  if (history.entries.length === 0) return <p className="ak-notice">{t('historyEmpty')}</p>;
  return (
    <div>
      <ol {...slot(props.slots, 'history', 'ak-history')} reversed>
        {history.entries.map((entry) => (
          <li
            key={entry.version}
            className="ak-history-entry"
            aria-current={entry.version === props.selectedVersion ? 'true' : undefined}
          >
            <div className="ak-history-head">
              <strong>{t('versionShort', { version: entry.version })}</strong>
              <span className="ak-history-meta">
                {formatDate(entry.createdAt, ctx.locale)} ·{' '}
                {t('by', { actor: t(`actor_${entry.actor.type}` as UiMessageKey) })}
                {entry.restoredFrom !== undefined
                  ? ` · ${t('restoredFrom', { version: entry.restoredFrom })}`
                  : ''}
              </span>
              <span className="ak-history-actions">
                <button
                  type="button"
                  className="ak-button"
                  aria-label={t('viewVersion', { version: entry.version })}
                  onClick={() => props.onView(entry.version)}
                >
                  <Eye aria-hidden="true" />
                  {t('tabView')}
                </button>
                {entry.version !== props.latestVersion ? (
                  <button
                    type="button"
                    className="ak-button"
                    aria-label={t('restoreVersion', { version: entry.version })}
                    disabled={history.restoring !== undefined}
                    onClick={() => props.onRestore(entry.version)}
                  >
                    <History aria-hidden="true" />
                    {t('restore')}
                  </button>
                ) : null}
              </span>
            </div>
            {entry.message ? <p className="ak-history-meta">{entry.message}</p> : null}
            {entry.diff.length > 0 ? <ChangeList changes={entry.diff} /> : null}
          </li>
        ))}
      </ol>
      {history.hasMore ? (
        <button
          type="button"
          className="ak-button"
          disabled={history.loading}
          onClick={() => void history.loadMore()}
        >
          {t('loadMore')}
        </button>
      ) : null}
    </div>
  );
}

function ExportMenu(props: {
  formats: string[];
  pending: string | undefined;
  onOpen(): void;
  onSelect(format: string): void;
}) {
  const { t } = useArtkit();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = useCallback(
    () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])],
    [],
  );
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open, items]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = all[(index + 1) % all.length];
    else if (event.key === 'ArrowUp') next = all[(index - 1 + all.length) % all.length];
    else if (event.key === 'Home') next = all[0];
    else if (event.key === 'End') next = all[all.length - 1];
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div className="ak-menu">
      <button
        ref={button}
        type="button"
        className="ak-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={props.pending !== undefined}
        onClick={() => {
          if (!open) props.onOpen();
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            props.onOpen();
            setOpen(true);
          }
        }}
      >
        <Download aria-hidden="true" />
        {props.pending ? t('exporting') : t('export')}
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={list}
          id={menuId}
          role="menu"
          className="ak-menu-list"
          aria-label={t('export')}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
        >
          {props.formats.length === 0 ? (
            <p className="ak-menu-item">{t('noExportFormats')}</p>
          ) : (
            props.formats.map((format) => (
              <button
                key={format}
                type="button"
                role="menuitem"
                className="ak-menu-item"
                tabIndex={-1}
                aria-label={t('exportAs', { format: format.toUpperCase() })}
                onClick={() => {
                  close(true);
                  props.onSelect(format);
                }}
              >
                {format.toUpperCase()}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

const ACTION_ICONS = { submit: Send, approve: Check, publish: Rocket, archive: Archive } as const;

function ActionIcon({ action }: { action: string }) {
  const Icon = ACTION_ICONS[action as keyof typeof ACTION_ICONS];
  return Icon ? <Icon aria-hidden="true" /> : null;
}
