import type { Artifact, ChangeSummary } from '@artkit/core';
import { Columns2, Rows2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ArtkitContextValue, useArtkit } from '../context.js';
import { useArtifact } from '../hooks.js';
import { diffLines, type LineDiffEntry, toSplitRows } from '../line-diff.js';
import { ChangeList, cx, ErrorMessage, Loading, rootAttributes, type Slots, slot } from './shared.js';

export type DiffLayout = 'unified' | 'split';
export type ArtifactVersionDiffPart = 'toolbar' | 'changes' | 'lines';

export interface ArtifactVersionDiffProps {
  /** Load both versions by id. */
  id?: string;
  /** Older version; defaults to the one before `to`. */
  from?: number;
  /** Newer version; defaults to the latest. */
  to?: number;
  /** Or pass both artifacts directly. */
  before?: Artifact;
  after?: Artifact;
  layout?: DiffLayout;
  defaultLayout?: DiffLayout;
  onLayoutChange?(layout: DiffLayout): void;
  /** Show the structural change list from `kind.diff` (default true). */
  showChanges?: boolean;
  /** Show the line diff of the full projections (default true). */
  showLines?: boolean;
  className?: string;
  slots?: Slots<ArtifactVersionDiffPart>;
}

export interface VersionComparison {
  changes: ChangeSummary[];
  lines: LineDiffEntry[];
}

/** Structural changes plus a line diff of the full text projections. `before` undefined means empty. */
export function compareVersions(
  ctx: ArtkitContextValue,
  before: Artifact | undefined,
  after: Artifact,
): VersionComparison {
  const kind = ctx.registry.get(after.kind);
  const beforeContent = before?.content ?? kind.empty();
  const changes: ChangeSummary[] = [];
  if (before && before.title !== after.title) {
    changes.push({
      type: 'changed',
      target: 'envelope:title',
      summary: `'${before.title}' → '${after.title}'`,
    });
  }
  try {
    changes.push(...kind.diff(beforeContent, after.content));
  } catch {
    // The text diff below still shows what changed.
  }
  const project = (content: unknown, artifact: Artifact) => {
    try {
      return kind.project(content, {
        mode: 'full',
        locale: artifact.locale,
        theme: ctx.themeFor(artifact.themeId),
      }).text;
    } catch {
      return JSON.stringify(content, null, 2);
    }
  };
  const lines = diffLines(before ? project(beforeContent, before) : '', project(after.content, after));
  return { changes, lines };
}

/** Side-by-side or highlighted comparison between two versions (spec §13.1). */
export function ArtifactVersionDiff(props: ArtifactVersionDiffProps) {
  const ctx = useArtkit();
  const { t } = ctx;
  const [ownLayout, setOwnLayout] = useState<DiffLayout>(props.defaultLayout ?? 'unified');
  const layout = props.layout ?? ownLayout;
  const setLayout = (next: DiffLayout) => {
    setOwnLayout(next);
    props.onLayoutChange?.(next);
  };

  const afterQuery = useArtifact(
    props.after ? undefined : props.id,
    props.to === undefined ? {} : { version: props.to },
  );
  const after = props.after ?? afterQuery.artifact;
  const fromVersion = props.from ?? (after && after.version > 1 ? after.version - 1 : undefined);
  const beforeQuery = useArtifact(
    props.before || fromVersion === undefined ? undefined : (props.id ?? after?.id),
    {
      ...(fromVersion === undefined ? {} : { version: fromVersion }),
    },
  );
  const before = props.before ?? (fromVersion === undefined ? undefined : beforeQuery.artifact);

  const comparison = useMemo(
    () => (after && ctx.registry.has(after.kind) ? compareVersions(ctx, before, after) : undefined),
    [ctx, before, after],
  );

  const error = afterQuery.error ?? beforeQuery.error;
  const waiting = !after || (fromVersion !== undefined && !before);
  const attrs = rootAttributes(ctx, after?.themeId);
  if (error) {
    return (
      <div className={cx('ak-root ak-diff', props.className)} {...attrs}>
        <ErrorMessage error={error} />
      </div>
    );
  }
  if (waiting || !comparison || !after) {
    return (
      <div className={cx('ak-root ak-diff', props.className)} {...attrs}>
        <Loading />
      </div>
    );
  }

  const beforeLabel = before ? t('diffBefore', { version: before.version }) : '—';
  const afterLabel = t('diffAfter', { version: after.version });

  return (
    <div className={cx('ak-root ak-diff', props.className)} {...attrs}>
      {props.showChanges === false ? null : (
        <section aria-label={t('changes')}>
          <ChangeList changes={comparison.changes} {...slot(props.slots, 'changes', '')} />
        </section>
      )}
      {props.showLines === false ? null : (
        <>
          <fieldset {...slot(props.slots, 'toolbar', 'ak-diff-toolbar')}>
            <legend className="ak-sr-only">{t('diffViewLabel')}</legend>
            {(['unified', 'split'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="ak-button"
                aria-pressed={layout === option}
                onClick={() => setLayout(option)}
              >
                {option === 'unified' ? <Rows2 aria-hidden="true" /> : <Columns2 aria-hidden="true" />}
                {option === 'unified' ? t('diffUnified') : t('diffSplit')}
              </button>
            ))}
          </fieldset>
          {layout === 'unified' ? (
            <UnifiedLines
              lines={comparison.lines}
              caption={`${beforeLabel} → ${afterLabel}`}
              slots={props.slots}
            />
          ) : (
            <SplitLines
              lines={comparison.lines}
              beforeLabel={beforeLabel}
              afterLabel={afterLabel}
              slots={props.slots}
            />
          )}
        </>
      )}
    </div>
  );
}

function Marker({ type }: { type: LineDiffEntry['type'] }) {
  const { t } = useArtkit();
  if (type === 'equal') return <td className="ak-diff-marker" />;
  return (
    <td className="ak-diff-marker">
      <span aria-hidden="true">{type === 'insert' ? '+' : '−'}</span>
      <span className="ak-sr-only">{type === 'insert' ? t('lineAdded') : t('lineRemoved')}</span>
    </td>
  );
}

function UnifiedLines({
  lines,
  caption,
  slots,
}: {
  lines: LineDiffEntry[];
  caption: string;
  slots?: Slots<ArtifactVersionDiffPart> | undefined;
}) {
  return (
    <table {...slot(slots, 'lines', 'ak-diff-lines')} data-layout="unified">
      <caption className="ak-sr-only">{caption}</caption>
      <tbody>
        {lines.map((line) => (
          <tr
            key={`${line.type}:${line.oldLine ?? '-'}:${line.newLine ?? '-'}`}
            className="ak-diff-line"
            data-type={line.type}
          >
            <th scope="row">{line.oldLine ?? ''}</th>
            <th scope="row">{line.newLine ?? ''}</th>
            <Marker type={line.type} />
            <td>{line.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SplitLines({
  lines,
  beforeLabel,
  afterLabel,
  slots,
}: {
  lines: LineDiffEntry[];
  beforeLabel: string;
  afterLabel: string;
  slots?: Slots<ArtifactVersionDiffPart> | undefined;
}) {
  const rows = useMemo(() => toSplitRows(lines), [lines]);
  return (
    <table {...slot(slots, 'lines', 'ak-diff-lines')} data-layout="split">
      <thead>
        <tr>
          <th scope="col" colSpan={3}>
            {beforeLabel}
          </th>
          <th scope="col" colSpan={3}>
            {afterLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.left?.oldLine ?? '-'}:${row.right?.newLine ?? '-'}`}>
            <th scope="row">{row.left?.oldLine ?? ''}</th>
            {row.left && row.left.type !== 'equal' ? (
              <Marker type="delete" />
            ) : (
              <td className="ak-diff-marker" />
            )}
            <td
              className="ak-diff-cell"
              data-type={row.left && row.left.type !== 'equal' ? 'delete' : undefined}
            >
              {row.left?.text ?? ''}
            </td>
            <th scope="row">{row.right?.newLine ?? ''}</th>
            {row.right && row.right.type !== 'equal' ? (
              <Marker type="insert" />
            ) : (
              <td className="ak-diff-marker" />
            )}
            <td
              className="ak-diff-cell"
              data-type={row.right && row.right.type !== 'equal' ? 'insert' : undefined}
            >
              {row.right?.text ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
