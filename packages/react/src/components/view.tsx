import type { Artifact, RenderContext } from '@artkit-ai/core';
import { Suspense, use, useMemo, useRef } from 'react';
import { type ArtkitContextValue, useArtkit } from '../context.js';
import { useArtifact } from '../hooks.js';
import { parsePartialJson } from '../partial-json.js';
import { hashString } from '../styles.js';
import { cx, ErrorBoundary, ErrorMessage, Loading, rootAttributes, type Slots, slot } from './shared.js';

export type ArtifactViewPart = 'body' | 'badge' | 'loading' | 'error';

export interface ArtifactViewProps {
  /** Committed artifact to show. */
  artifact?: Artifact;
  /** Alternatively, load by id (latest or `version`). */
  id?: string;
  version?: number;
  /**
   * Content still being streamed by the model: a partial object or the raw JSON text so far. It goes
   * through `kind.parsePartial` and shows as a provisional preview until a newer committed version
   * arrives (spec §13.4).
   */
  partial?: unknown;
  /** Kind of the partial content when no artifact exists yet. */
  kind?: string;
  /** Theme and locale of the partial content when no artifact exists yet. */
  themeId?: string;
  locale?: string;
  mode?: RenderContext['mode'];
  className?: string;
  slots?: Slots<ArtifactViewPart>;
}

/** Turns streamed content into renderable content, or undefined while nothing complete arrived yet. */
export function previewContent(ctx: ArtkitContextValue, kind: string, partial: unknown): unknown {
  if (!ctx.registry.has(kind)) return undefined;
  const raw = typeof partial === 'string' && /^\s*[[{]/.test(partial) ? parsePartialJson(partial) : partial;
  if (raw === undefined) return undefined;
  try {
    return ctx.registry.get(kind).parsePartial(raw);
  } catch {
    return undefined;
  }
}

export function renderContext(
  ctx: ArtkitContextValue,
  themeId: string | undefined,
  locale: string,
  mode: RenderContext['mode'],
  provisional: boolean,
): RenderContext {
  return {
    theme: ctx.themeFor(themeId),
    locale,
    mode,
    ...(provisional ? { provisional: true } : {}),
    ...(ctx.resolveAssetUrl ? { resolveAssetUrl: ctx.resolveAssetUrl } : {}),
  };
}

/** Read-only view of any artifact by kind (spec §13.1). */
export function ArtifactView(props: ArtifactViewProps) {
  const ctx = useArtkit();
  const { t } = ctx;
  const loaded = useArtifact(
    props.artifact ? undefined : props.id,
    props.version === undefined ? {} : { version: props.version },
  );
  const committed = props.artifact ?? loaded.artifact;

  // Remember which committed version was on screen when streaming started: any other version arriving
  // afterwards is the commit that replaces the preview, even if the caller still passes `partial`.
  const streamStart = useRef<{ version: number | undefined } | null>(null);
  const stillLoading = !props.artifact && props.id !== undefined && loaded.loading;
  if (props.partial === undefined) streamStart.current = null;
  else if (streamStart.current === null && !stillLoading)
    streamStart.current = { version: committed?.version };
  const showPartial =
    props.partial !== undefined &&
    (streamStart.current === null || committed?.version === streamStart.current.version);

  const kind = props.kind ?? committed?.kind;
  const partialContent = useMemo(
    () => (showPartial && kind ? previewContent(ctx, kind, props.partial) : undefined),
    [ctx, kind, props.partial, showPartial],
  );

  const themeId = committed?.themeId ?? props.themeId;
  const locale = committed?.locale ?? props.locale ?? ctx.locale;
  const mode = props.mode ?? 'screen';
  const rootClass = cx('ak-root ak-view', props.className);
  const attrs = rootAttributes(ctx, themeId);

  if (showPartial) {
    return (
      <div className={rootClass} {...attrs} data-provisional="true" lang={locale} aria-busy="true">
        <span
          {...slot(props.slots, 'badge', 'ak-badge ak-view-badge')}
          data-variant="provisional"
          role="status"
        >
          {t('provisional')}
        </span>
        {partialContent === undefined || !kind ? (
          <Loading label={t('generating')} {...slot(props.slots, 'loading', '')} />
        ) : (
          <div {...slot(props.slots, 'body', 'ak-view-body')}>
            <KindRenderer
              kind={kind}
              content={partialContent}
              ctx={renderContext(ctx, themeId, locale, mode, true)}
            />
          </div>
        )}
      </div>
    );
  }

  if (!committed) {
    return (
      <div className={rootClass} {...attrs}>
        {loaded.error ? (
          <ErrorMessage
            error={loaded.error}
            onRetry={() => void loaded.refresh().catch(() => undefined)}
            {...slot(props.slots, 'error', '')}
          />
        ) : (
          <Loading {...slot(props.slots, 'loading', '')} />
        )}
      </div>
    );
  }

  return (
    <div
      className={rootClass}
      {...attrs}
      lang={committed.locale}
      data-kind={committed.kind}
      data-version={committed.version}
    >
      <div {...slot(props.slots, 'body', 'ak-view-body')}>
        <KindRenderer
          kind={committed.kind}
          content={committed.content}
          ctx={renderContext(ctx, themeId, locale, mode, false)}
        />
      </div>
    </div>
  );
}

interface KindRendererProps {
  kind: string;
  content: unknown;
  ctx: RenderContext;
  className?: string;
}

/** Lazy kind renderer with a JSON fallback when the kind has no renderer loader. */
export function KindRenderer(props: KindRendererProps) {
  const ctx = useArtkit();
  if (!ctx.hasRenderer(props.kind)) {
    return (
      <div className={props.className}>
        <p className="ak-notice">{ctx.t('noRenderer', { kind: props.kind })}</p>
        <pre className="ak-code">
          <code>{JSON.stringify(props.content, null, 2)}</code>
        </pre>
      </div>
    );
  }
  return (
    <ErrorBoundary
      onReset={() => ctx.resetLoad('renderer', props.kind)}
      fallback={(error, reset) => <ErrorMessage error={error} onRetry={reset} />}
    >
      <Suspense fallback={<Loading />}>
        <LoadedRenderer {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

function LoadedRenderer({ kind, content, ctx: renderCtx, className }: KindRendererProps) {
  const ctx = useArtkit();
  const { Renderer, css } = use(ctx.loadRenderer(kind));
  return (
    <>
      {css ? (
        <style href={`artkit-kind-${kind}-${hashString(css)}`} precedence="artkit" nonce={ctx.nonce}>
          {css}
        </style>
      ) : null}
      <Renderer content={content} ctx={renderCtx} {...(className ? { className } : {})} />
    </>
  );
}
