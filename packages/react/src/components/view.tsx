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
  /** Alternatively, load the artifact by id. */
  id?: string;
  /**
   * Content still being streamed by the model: a partial object or the raw JSON text so far. It goes
   * through `format.parsePartial` and shows as a provisional preview until a newer committed version
   * arrives (spec §13.4).
   */
  partial?: unknown;
  /** Kind of the partial content when no artifact exists yet. */
  format?: string;
  /** Theme and locale of the partial content when no artifact exists yet. */
  themeId?: string;
  locale?: string;
  mode?: RenderContext['mode'];
  className?: string;
  slots?: Slots<ArtifactViewPart>;
}

/** Turns streamed content into renderable content, or undefined while nothing complete arrived yet. */
export function previewContent(ctx: ArtkitContextValue, format: string, partial: unknown): unknown {
  if (!ctx.registry.has(format)) return undefined;
  const raw = typeof partial === 'string' && /^\s*[[{]/.test(partial) ? parsePartialJson(partial) : partial;
  if (raw === undefined) return undefined;
  try {
    // Adapters take the streamed text; structured partials (e.g. a workbook JSON) are serialized first.
    return ctx.registry.get(format).parsePartial(typeof raw === 'string' ? raw : JSON.stringify(raw));
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
  const loaded = useArtifact(props.artifact ? undefined : props.id);
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

  const format = props.format ?? committed?.format;
  const partialContent = useMemo(
    () => (showPartial && format ? previewContent(ctx, format, props.partial) : undefined),
    [ctx, format, props.partial, showPartial],
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
        {partialContent === undefined || !format ? (
          <Loading label={t('generating')} {...slot(props.slots, 'loading', '')} />
        ) : (
          <div {...slot(props.slots, 'body', 'ak-view-body')}>
            <FormatRenderer
              format={format!}
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
      data-format={committed.format}
      data-version={committed.version}
    >
      <div {...slot(props.slots, 'body', 'ak-view-body')}>
        <FormatRenderer
          format={committed.format}
          content={committed.content}
          ctx={renderContext(ctx, themeId, locale, mode, false)}
        />
      </div>
    </div>
  );
}

interface FormatRendererProps {
  format: string;
  content: unknown;
  ctx: RenderContext;
  className?: string;
}

/** Lazy kind renderer with a JSON fallback when the kind has no renderer loader. */
export function FormatRenderer(props: FormatRendererProps) {
  const ctx = useArtkit();
  if (!ctx.hasRenderer(props.format)) {
    return (
      <div className={props.className}>
        <p className="ak-notice">{ctx.t('noRenderer', { format: props.format })}</p>
        <pre className="ak-code">
          <code>{JSON.stringify(props.content, null, 2)}</code>
        </pre>
      </div>
    );
  }
  return (
    <ErrorBoundary
      onReset={() => ctx.resetLoad('renderer', props.format)}
      fallback={(error, reset) => <ErrorMessage error={error} onRetry={reset} />}
    >
      <Suspense fallback={<Loading />}>
        <LoadedRenderer {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

function LoadedRenderer({ format, content, ctx: renderCtx, className }: FormatRendererProps) {
  const ctx = useArtkit();
  const { Renderer, css } = use(ctx.loadRenderer(format));
  return (
    <>
      {css ? (
        <style href={`artkit-kind-${format}-${hashString(css)}`} precedence="artkit" nonce={ctx.nonce}>
          {css}
        </style>
      ) : null}
      <Renderer content={content} ctx={renderCtx} {...(className ? { className } : {})} />
    </>
  );
}
