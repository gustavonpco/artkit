import { isSafeLink, type RenderContext } from '@artkit-ai/core';
import type { CSSProperties, ReactNode } from 'react';
import type {
  Block,
  CalloutBlock,
  Cover,
  DocumentContent,
  ListItem,
  PageSetup,
  Run,
  TableBlock,
} from '../schema.js';
import { DEFAULT_TOC_LEVEL, tocEntries } from '../toc.js';
import { pageRuleCss, pageVariables } from './page-css.js';

export interface DocumentRendererProps {
  content: DocumentContent;
  ctx: RenderContext;
  className?: string;
}

/** DOM id of a block; internal links `#id` point here. */
export function blockAnchor(id: string): string {
  return `ak-${id}`;
}

const pt = (locale: string) => locale.toLowerCase().startsWith('pt');

/** Read-only, semantic rendering of a document as a continuous page (or print layout). */
export function DocumentRenderer({ content, ctx, className }: DocumentRendererProps): ReactNode {
  const print = ctx.mode === 'print';
  const classes = [
    'ak-document',
    print ? 'ak-document--print' : '',
    ctx.provisional ? 'ak-document--provisional' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <article
      className={classes}
      lang={ctx.locale}
      style={pageVariables(content.page) as CSSProperties}
      aria-busy={ctx.provisional || undefined}
    >
      {print ? <style>{pageRuleCss(content.page)}</style> : null}
      {!print && content.page?.header ? (
        <div className="ak-document-running ak-document-running--header">{content.page.header}</div>
      ) : null}
      {content.cover ? <CoverView cover={content.cover} /> : null}
      {content.blocks.map((block) => (
        <BlockView key={block.id} block={block} content={content} ctx={ctx} />
      ))}
      {!print ? <RunningFooter page={content.page} /> : null}
    </article>
  );
}

function RunningFooter({ page }: { page: PageSetup | undefined }): ReactNode {
  if (!page?.footer) return null;
  return <div className="ak-document-running ak-document-running--footer">{page.footer}</div>;
}

function CoverView({ cover }: { cover: Cover }): ReactNode {
  return (
    <header className="ak-document-cover">
      {cover.eyebrow ? <p className="ak-document-cover-eyebrow">{cover.eyebrow}</p> : null}
      <h1 className="ak-document-cover-title">{cover.title}</h1>
      {cover.subtitle ? <p className="ak-document-cover-subtitle">{cover.subtitle}</p> : null}
      {cover.fields?.length ? (
        <dl className="ak-document-cover-fields">
          {cover.fields.map((field, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fields have no id and labels may repeat.
            <CoverField key={index} label={field.label} value={field.value} />
          ))}
        </dl>
      ) : null}
    </header>
  );
}

function CoverField({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

interface BlockViewProps {
  block: Block;
  content: DocumentContent;
  ctx: RenderContext;
}

function BlockView({ block, content, ctx }: BlockViewProps): ReactNode {
  const id = blockAnchor(block.id);
  switch (block.type) {
    case 'heading': {
      const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[block.level - 1] ?? 'h4';
      return (
        <Tag id={id}>
          <Runs runs={block.runs} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p
          id={id}
          className={block.align && block.align !== 'left' ? `ak-document-align-${block.align}` : undefined}
        >
          <Runs runs={block.runs} />
        </p>
      );
    case 'list':
      return <ListView id={id} items={block.items} ordered={Boolean(block.ordered)} start={block.start} />;
    case 'table':
      return <TableView id={id} block={block} />;
    case 'callout':
      return <CalloutView id={id} block={block} locale={ctx.locale} />;
    case 'quote':
      return (
        <figure id={id} className="ak-document-quote">
          <blockquote>
            <p>
              <Runs runs={block.runs} />
            </p>
          </blockquote>
          {block.attribution ? <figcaption>— {block.attribution}</figcaption> : null}
        </figure>
      );
    case 'code':
      return (
        <pre id={id} className="ak-document-code" data-language={block.language}>
          <code className={block.language ? `language-${block.language}` : undefined}>{block.text}</code>
        </pre>
      );
    case 'image': {
      const src = ctx.resolveAssetUrl?.(block.asset);
      const style: CSSProperties | undefined = block.width
        ? { width: `${Math.round(block.width * 100)}%` }
        : undefined;
      return (
        <figure id={id} className="ak-document-image" style={style}>
          {src ? (
            <img src={src} alt={block.alt} />
          ) : (
            <div className="ak-document-image-placeholder" role="img" aria-label={block.alt}>
              {block.alt}
            </div>
          )}
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    }
    case 'divider':
      return <hr id={id} />;
    case 'pageBreak': {
      const label = pt(ctx.locale) ? 'Quebra de página' : 'Page break';
      return (
        // A labelled container (not <hr>) so the screen view can show the "Page break" marker.
        // biome-ignore lint/a11y/useSemanticElements: <hr> cannot hold the visible label.
        <div id={id} className="ak-document-page-break" role="separator" aria-label={label}>
          <span aria-hidden="true">{label}</span>
        </div>
      );
    }
    case 'toc': {
      const title = block.title ?? (pt(ctx.locale) ? 'Sumário' : 'Contents');
      const entries = tocEntries(content.blocks, block.maxLevel ?? DEFAULT_TOC_LEVEL);
      return (
        <nav id={id} className="ak-document-toc" aria-label={title}>
          <p className="ak-document-toc-title">{title}</p>
          <ol>
            {entries.map((entry) => (
              <li key={entry.id} className={`ak-document-toc-level-${entry.level}`}>
                <a href={`#${blockAnchor(entry.id)}`}>{entry.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      );
    }
  }
}

function CalloutView({ id, block, locale }: { id: string; block: CalloutBlock; locale: string }): ReactNode {
  const labels: Record<CalloutBlock['tone'], [string, string]> = {
    info: ['Informação', 'Note'],
    warning: ['Atenção', 'Warning'],
    success: ['Dica', 'Tip'],
    danger: ['Cuidado', 'Caution'],
  };
  const label = labels[block.tone][pt(locale) ? 0 : 1];
  return (
    <aside
      id={id}
      className={`ak-document-callout ak-document-callout--${block.tone}`}
      role="note"
      aria-label={block.title ?? label}
    >
      {block.title ? <p className="ak-document-callout-title">{block.title}</p> : null}
      <p>
        <Runs runs={block.runs} />
      </p>
    </aside>
  );
}

function ListView({
  id,
  items,
  ordered,
  start,
}: {
  id?: string;
  items: ListItem[];
  ordered: boolean;
  start?: number | undefined;
}): ReactNode {
  const children = items.map((item, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: list items have no id; order is their identity.
    <li key={index}>
      <Runs runs={item.runs} />
      {item.children?.length ? (
        <ListView items={item.children} ordered={item.childrenOrdered ?? ordered} />
      ) : null}
    </li>
  ));
  return ordered ? (
    <ol id={id} start={start !== undefined && start !== 1 ? start : undefined}>
      {children}
    </ol>
  ) : (
    <ul id={id}>{children}</ul>
  );
}

function TableView({ id, block }: { id: string; block: TableBlock }): ReactNode {
  const total = block.widths?.reduce((sum, width) => sum + width, 0) ?? 0;
  const align = (col: number): CSSProperties | undefined => {
    const value = block.align?.[col];
    return value && value !== 'left' ? { textAlign: value } : undefined;
  };
  return (
    <div className="ak-document-table">
      <table id={id}>
        {block.caption ? <caption>{block.caption}</caption> : null}
        {block.widths && total > 0 ? (
          <colgroup>
            {block.widths.map((width, col) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
              <col key={col} style={{ width: `${((width / total) * 100).toFixed(2)}%` }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {block.header.map((cell, col) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
              <th key={col} scope="col" style={align(col)}>
                <Runs runs={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
            <tr key={r}>
              {row.map((cell, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                <td key={col} style={align(col)}>
                  <Runs runs={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {block.footer ? (
          <tfoot>
            <tr>
              {block.footer.map((cell, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                <td key={col} style={align(col)}>
                  <Runs runs={cell} />
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function Text({ text }: { text: string }): ReactNode {
  if (!text.includes('\n')) return text;
  const lines = text.split('\n');
  return lines.map((line, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
    <span key={index}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

function RunView({ run }: { run: Run }): ReactNode {
  let node: ReactNode = run.code ? <code>{run.text}</code> : <Text text={run.text} />;
  if (run.superscript) node = <sup>{node}</sup>;
  if (run.subscript) node = <sub>{node}</sub>;
  if (run.strike) node = <s>{node}</s>;
  if (run.underline) node = <u>{node}</u>;
  if (run.italic) node = <em>{node}</em>;
  if (run.bold) node = <strong>{node}</strong>;
  if (run.link && isSafeLink(run.link)) {
    const href = run.link.trim();
    if (href.startsWith('#')) node = <a href={`#${blockAnchor(href.slice(1))}`}>{node}</a>;
    else if (/^mailto:/i.test(href)) node = <a href={href}>{node}</a>;
    else
      node = (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {node}
        </a>
      );
  }
  return node;
}

export function Runs({ runs }: { runs: readonly Run[] }): ReactNode {
  return runs.map((run, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional.
    <RunView key={index} run={run} />
  ));
}
