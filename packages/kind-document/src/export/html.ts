import { type ArtifactExporter, type ExportContext, isSafeLink, themeCssText, toDataUrl } from '@artkit/core';
import { documentCss } from '../react/css.js';
import { pageRuleCss, pageVariables } from '../react/page-css.js';
import type { Block, CalloutBlock, DocumentContent, ListItem, Run, TableBlock } from '../schema.js';
import { DEFAULT_TOC_LEVEL, tocEntries } from '../toc.js';

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const anchor = (id: string) => `ak-${id}`;
const pt = (locale: string) => locale.toLowerCase().startsWith('pt');

function textHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function runsHtml(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      let html = run.code ? `<code>${escapeHtml(run.text)}</code>` : textHtml(run.text);
      if (run.superscript) html = `<sup>${html}</sup>`;
      if (run.subscript) html = `<sub>${html}</sub>`;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.underline) html = `<u>${html}</u>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.link && isSafeLink(run.link)) {
        const href = run.link.trim();
        if (href.startsWith('#')) html = `<a href="#${escapeHtml(anchor(href.slice(1)))}">${html}</a>`;
        else if (/^mailto:/i.test(href)) html = `<a href="${escapeHtml(href)}">${html}</a>`;
        else html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      }
      return html;
    })
    .join('');
}

function listHtml(
  items: readonly ListItem[],
  ordered: boolean,
  start: number | undefined,
  id?: string,
): string {
  const tag = ordered ? 'ol' : 'ul';
  const attrs = `${id ? ` id="${escapeHtml(id)}"` : ''}${ordered && start !== undefined && start !== 1 ? ` start="${start}"` : ''}`;
  const body = items
    .map(
      (item) =>
        `<li>${runsHtml(item.runs)}${item.children?.length ? listHtml(item.children, item.childrenOrdered ?? ordered, undefined) : ''}</li>`,
    )
    .join('');
  return `<${tag}${attrs}>${body}</${tag}>`;
}

function tableHtml(block: TableBlock): string {
  const total = block.widths?.reduce((sum, width) => sum + width, 0) ?? 0;
  const style = (col: number) => {
    const align = block.align?.[col];
    return align && align !== 'left' ? ` style="text-align:${align}"` : '';
  };
  const row = (cells: Run[][], tag: 'th' | 'td') =>
    `<tr>${cells.map((cell, col) => `<${tag}${tag === 'th' ? ' scope="col"' : ''}${style(col)}>${runsHtml(cell)}</${tag}>`).join('')}</tr>`;
  const parts = [`<div class="ak-document-table"><table id="${escapeHtml(anchor(block.id))}">`];
  if (block.caption) parts.push(`<caption>${escapeHtml(block.caption)}</caption>`);
  if (block.widths && total > 0) {
    parts.push(
      `<colgroup>${block.widths.map((width) => `<col style="width:${((width / total) * 100).toFixed(2)}%">`).join('')}</colgroup>`,
    );
  }
  parts.push(
    `<thead>${row(block.header, 'th')}</thead><tbody>${block.rows.map((cells) => row(cells, 'td')).join('')}</tbody>`,
  );
  if (block.footer) parts.push(`<tfoot>${row(block.footer, 'td')}</tfoot>`);
  parts.push('</table></div>');
  return parts.join('');
}

const CALLOUT_LABELS: Record<CalloutBlock['tone'], [string, string]> = {
  info: ['Informação', 'Note'],
  warning: ['Atenção', 'Warning'],
  success: ['Dica', 'Tip'],
  danger: ['Cuidado', 'Caution'],
};

/** Image sources by asset reference; missing entries render a placeholder. */
export type ImageSources = ReadonlyMap<string, string>;

export function blockHtml(
  block: Block,
  content: DocumentContent,
  locale: string,
  images: ImageSources,
): string {
  const id = escapeHtml(anchor(block.id));
  switch (block.type) {
    case 'heading':
      return `<h${block.level} id="${id}">${runsHtml(block.runs)}</h${block.level}>`;
    case 'paragraph': {
      const cls = block.align && block.align !== 'left' ? ` class="ak-document-align-${block.align}"` : '';
      return `<p id="${id}"${cls}>${runsHtml(block.runs)}</p>`;
    }
    case 'list':
      return listHtml(block.items, Boolean(block.ordered), block.start, anchor(block.id));
    case 'table':
      return tableHtml(block);
    case 'callout': {
      const label = block.title ?? CALLOUT_LABELS[block.tone][pt(locale) ? 0 : 1];
      const title = block.title ? `<p class="ak-document-callout-title">${escapeHtml(block.title)}</p>` : '';
      return `<aside id="${id}" class="ak-document-callout ak-document-callout--${block.tone}" role="note" aria-label="${escapeHtml(label)}">${title}<p>${runsHtml(block.runs)}</p></aside>`;
    }
    case 'quote': {
      const caption = block.attribution ? `<figcaption>— ${escapeHtml(block.attribution)}</figcaption>` : '';
      return `<figure id="${id}" class="ak-document-quote"><blockquote><p>${runsHtml(block.runs)}</p></blockquote>${caption}</figure>`;
    }
    case 'code': {
      const lang = block.language ? ` class="language-${escapeHtml(block.language)}"` : '';
      return `<pre id="${id}" class="ak-document-code"><code${lang}>${escapeHtml(block.text)}</code></pre>`;
    }
    case 'image': {
      const src = images.get(block.asset);
      const style = block.width ? ` style="width:${Math.round(block.width * 100)}%"` : '';
      const media = src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}">`
        : `<div class="ak-document-image-placeholder" role="img" aria-label="${escapeHtml(block.alt)}">${escapeHtml(block.alt)}</div>`;
      const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : '';
      return `<figure id="${id}" class="ak-document-image"${style}>${media}${caption}</figure>`;
    }
    case 'divider':
      return `<hr id="${id}">`;
    case 'pageBreak': {
      const label = pt(locale) ? 'Quebra de página' : 'Page break';
      return `<div id="${id}" class="ak-document-page-break" role="separator" aria-label="${label}"><span aria-hidden="true">${label}</span></div>`;
    }
    case 'toc': {
      const title = block.title ?? (pt(locale) ? 'Sumário' : 'Contents');
      const entries = tocEntries(content.blocks, block.maxLevel ?? DEFAULT_TOC_LEVEL)
        .map(
          (entry) =>
            `<li class="ak-document-toc-level-${entry.level}"><a href="#${escapeHtml(anchor(entry.id))}">${escapeHtml(entry.text)}</a></li>`,
        )
        .join('');
      return `<nav id="${id}" class="ak-document-toc" aria-label="${escapeHtml(title)}"><p class="ak-document-toc-title">${escapeHtml(title)}</p><ol>${entries}</ol></nav>`;
    }
  }
}

/** The document body (`<article class="ak-document">…</article>`), same markup as the React renderer. */
export function documentBodyHtml(
  content: DocumentContent,
  locale: string,
  images: ImageSources = new Map(),
): string {
  const style = Object.entries(pageVariables(content.page))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  const parts = [`<article class="ak-document" lang="${escapeHtml(locale)}" style="${style}">`];
  if (content.page?.header)
    parts.push(
      `<div class="ak-document-running ak-document-running--header">${escapeHtml(content.page.header)}</div>`,
    );
  const cover = content.cover;
  if (cover) {
    parts.push('<header class="ak-document-cover">');
    if (cover.eyebrow) parts.push(`<p class="ak-document-cover-eyebrow">${escapeHtml(cover.eyebrow)}</p>`);
    parts.push(`<h1 class="ak-document-cover-title">${escapeHtml(cover.title)}</h1>`);
    if (cover.subtitle) parts.push(`<p class="ak-document-cover-subtitle">${escapeHtml(cover.subtitle)}</p>`);
    if (cover.fields?.length) {
      parts.push(
        `<dl class="ak-document-cover-fields">${cover.fields.map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`).join('')}</dl>`,
      );
    }
    parts.push('</header>');
  }
  for (const block of content.blocks) parts.push(blockHtml(block, content, locale, images));
  if (content.page?.footer)
    parts.push(
      `<div class="ak-document-running ak-document-running--footer">${escapeHtml(content.page.footer)}</div>`,
    );
  parts.push('</article>');
  return parts.join('\n');
}

/** Resolves every image asset into a data URL, warning (and leaving a placeholder) on failures. */
export async function resolveImages(
  content: DocumentContent,
  ctx: ExportContext,
): Promise<Map<string, { bytes: Uint8Array; mimeType: string }>> {
  const out = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  for (const block of content.blocks) {
    if (block.type !== 'image' || out.has(block.asset)) continue;
    ctx.signal?.throwIfAborted();
    try {
      out.set(block.asset, await ctx.assets.resolve(block.asset));
    } catch {
      ctx.warn(`Image ${block.asset} could not be loaded; a placeholder was used.`);
    }
  }
  return out;
}

/** Static, self-contained HTML page: inline CSS with the theme colors and images as data URLs. */
export const documentHtmlExporter: ArtifactExporter<DocumentContent> = {
  kind: 'document',
  format: 'html',
  mimeType: 'text/html; charset=utf-8',
  extension: 'html',
  runtime: 'any',
  async export(content, ctx) {
    const resolved = await resolveImages(content, ctx);
    const images = new Map(
      [...resolved].map(([ref, asset]) => [ref, toDataUrl(asset.bytes, asset.mimeType)]),
    );
    const css = [
      themeCssText(ctx.theme),
      documentCss,
      pageRuleCss(content.page),
      'body { margin: 0; background: var(--ak-color-surface, #f3f6f8); }',
      '@media print { body { background: none; } }',
    ]
      .join('\n')
      .replace(/<\//g, '<\\/');
    const html = `<!doctype html>
<html lang="${escapeHtml(ctx.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)}</title>
<style>${css}</style>
</head>
<body>
${documentBodyHtml(content, ctx.locale, images)}
</body>
</html>
`;
    return new TextEncoder().encode(html);
  },
};
