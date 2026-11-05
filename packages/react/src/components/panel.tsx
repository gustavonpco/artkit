import type { Artifact } from '@artkit-ai/core';
import { ChevronDown, Copy, Download, X } from 'lucide-react';
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
import { useArtkit } from '../context.js';
import type { DraftSnapshot } from '../editor-session.js';
import { useArtifact, useArtifactExport } from '../hooks.js';
import type { UiMessageKey } from '../i18n.js';
import { ArtifactEditor, type ArtifactEditorProps } from './editor.js';
import {
  cx,
  ErrorMessage,
  formatLabel,
  Loading,
  rootAttributes,
  type Slots,
  slot,
  useAnnouncer,
} from './shared.js';
import { ArtifactView } from './view.js';

export type PanelTab = 'view' | 'edit' | 'code';
export type ArtifactPanelPart = 'header' | 'title' | 'toolbar' | 'tabs' | 'body' | 'code';

export interface ArtifactPanelProps {
  id?: string;
  artifact?: Artifact;
  tab?: PanelTab;
  defaultTab?: PanelTab;
  onTabChange?(tab: PanelTab): void;
  /** Save action of the editor tab: the application decides what saving means. */
  onSave?: ArtifactEditorProps['onSave'];
  /** Draft changes, forwarded from the editor tab. */
  onChange?(snapshot: DraftSnapshot): void;
  /** Export formats; defaults to the provider's server formats plus browser exporters. */
  exportFormats?: string[];
  onClose?(): void;
  /** Extra controls rendered in the header. */
  headerActions?: ReactNode;
  className?: string;
  slots?: Slots<ArtifactPanelPart>;
}

const TABS: PanelTab[] = ['view', 'edit', 'code'];
const TAB_LABEL: Record<PanelTab, UiMessageKey> = { view: 'tabView', edit: 'tabEdit', code: 'tabCode' };

/**
 * Side panel of one artifact: View, Edit and Code tabs and the export menu (spec §13.1). There is no history, approval
 * or archive here: the application owns versions and publication.
 */
export function ArtifactPanel(props: ArtifactPanelProps) {
  const ctx = useArtkit();
  const { t } = ctx;
  const id = props.id ?? props.artifact?.id;
  const latestQuery = useArtifact(id, props.artifact ? { initial: props.artifact } : {});
  const latest = latestQuery.artifact;

  const [ownTab, setOwnTab] = useState<PanelTab>(props.defaultTab ?? 'view');
  const tab = props.tab ?? ownTab;
  const selectTab = (next: PanelTab) => {
    setOwnTab(next);
    props.onTabChange?.(next);
  };
  const exporter = useArtifactExport(id ?? '', latest?.format);
  const [live, announce] = useAnnouncer();
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

  async function exportAs(format: string) {
    try {
      const result = await exporter.exportArtifact(format, {});
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

  const exportFormats = props.exportFormats ?? exporter.formats;

  return (
    <aside
      className={cx('ak-root ak-panel', props.className)}
      {...rootAttributes(ctx, latest.themeId)}
      aria-labelledby={`${baseId}-title`}
      data-format={latest.format}
    >
      {live}
      <header {...slot(props.slots, 'header', 'ak-panel-header')}>
        <h2 id={`${baseId}-title`} {...slot(props.slots, 'title', 'ak-panel-title')}>
          {latest.title}
        </h2>
        <span className="ak-history-meta">{formatLabel(ctx, latest.format)}</span>
        <span className="ak-badge">{t('versionShort', { version: latest.version })}</span>
        {props.headerActions}
        <ExportMenu
          formats={exportFormats}
          pending={exporter.pending}
          onOpen={() => void exporter.loadFormats()}
          onSelect={(format) => void exportAs(format)}
        />
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
      {exporter.error ? <ErrorMessage error={exporter.error} className="ak-panel-notice" /> : null}

      <div role="tablist" aria-label={latest.title} {...slot(props.slots, 'tabs', 'ak-tabs')}>
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
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        {...slot(props.slots, 'body', 'ak-panel-body')}
      >
        {tab === 'view' ? <ArtifactView artifact={latest} /> : null}
        {tab === 'edit' ? (
          <ArtifactEditor
            artifact={latest}
            {...(props.onSave ? { onSave: props.onSave } : {})}
            {...(props.onChange ? { onChange: props.onChange } : {})}
          />
        ) : null}
        {tab === 'code' ? <CodeTab artifact={latest} slots={props.slots} /> : null}
      </div>
    </aside>
  );
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
