import { type ChangeSummary, deepEqual, diffCollection, ellipsis } from '@artkit/core';
import { canonicalBlock } from './normalize.js';
import { blockText } from './runs.js';
import type { Block, DocumentContent } from './schema.js';

const TYPE_LABEL: Record<Block['type'], string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  table: 'Table',
  callout: 'Callout',
  quote: 'Quote',
  code: 'Code block',
  image: 'Image',
  divider: 'Divider',
  pageBreak: 'Page break',
  toc: 'Table of contents',
};

const TYPE_LABEL_PT: Record<Block['type'], string> = {
  heading: 'Título',
  paragraph: 'Parágrafo',
  list: 'Lista',
  table: 'Tabela',
  callout: 'Destaque',
  quote: 'Citação',
  code: 'Bloco de código',
  image: 'Imagem',
  divider: 'Divisor',
  pageBreak: 'Quebra de página',
  toc: 'Sumário',
};

type Say = (en: string, pt: string) => string;
const sayer =
  (locale?: string): Say =>
  (en, pt) =>
    locale?.toLowerCase().startsWith('pt') ? pt : en;
const typeLabel = (type: Block['type'], locale?: string) =>
  (locale?.toLowerCase().startsWith('pt') ? TYPE_LABEL_PT : TYPE_LABEL)[type];

function label(block: Block, locale?: string): string {
  const text = blockText(block);
  return text ? `${typeLabel(block.type, locale)} '${ellipsis(text, 40)}'` : typeLabel(block.type, locale);
}

function describeChange(before: Block, after: Block, locale?: string): string {
  const say = sayer(locale);
  const to = say('to', 'para');
  if (before.type !== after.type)
    return `${typeLabel(before.type, locale)} ${say('changed to', 'virou')} ${typeLabel(after.type, locale).toLowerCase()} '${ellipsis(blockText(after), 40)}'.`;
  if (before.type === 'table' && after.type === 'table') {
    const parts: string[] = [];
    if (before.rows.length !== after.rows.length)
      parts.push(`${say('rows', 'linhas')} ${before.rows.length} ${to} ${after.rows.length}`);
    if (before.header.length !== after.header.length)
      parts.push(`${say('columns', 'colunas')} ${before.header.length} ${to} ${after.header.length}`);
    if (parts.length > 0) return `${typeLabel('table', locale)}: ${parts.join(', ')}.`;
  }
  if (
    before.type === 'heading' &&
    after.type === 'heading' &&
    before.level !== after.level &&
    blockText(before) === blockText(after)
  ) {
    return `${typeLabel('heading', locale)} '${ellipsis(blockText(after), 40)}': ${say('level', 'nível')} ${before.level} ${to} ${after.level}.`;
  }
  const a = blockText(before);
  const b = blockText(after);
  if (a !== b) return `${typeLabel(after.type, locale)}: '${ellipsis(a, 40)}' ${to} '${ellipsis(b, 40)}'.`;
  return `${typeLabel(after.type, locale)}: ${say('formatting changed', 'formatação alterada')}: '${ellipsis(b, 40)}'.`;
}

/** Block changes by id, plus `cover` and `page` changes. */
export function diffDocument(
  before: DocumentContent,
  after: DocumentContent,
  locale?: string,
): ChangeSummary[] {
  const say = sayer(locale);
  const changes: ChangeSummary[] = [];
  for (const key of ['cover', 'page'] as const) {
    const a = before[key];
    const b = after[key];
    if (deepEqual(a, b)) continue;
    const name = key === 'cover' ? say('Cover', 'Capa') : say('Page setup', 'Configuração de página');
    const title = key === 'cover' && after.cover ? ` '${ellipsis(after.cover.title, 40)}'` : '';
    changes.push({
      type: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed',
      target: key,
      summary:
        a === undefined
          ? `${name} ${say('set', 'definida')}${title}.`
          : b === undefined
            ? `${name} ${say('removed', 'removida')}.`
            : `${name} ${say('changed', 'alterada')}${title}.`,
    });
  }
  changes.push(
    ...diffCollection(before.blocks, after.blocks, {
      prefix: 'block',
      id: (block) => block.id,
      label: (block) => label(block, locale),
      locale,
      // Run splits that render the same are not changes.
      equals: (a, b) => deepEqual(canonicalBlock(a), canonicalBlock(b)),
      describeChange: (a, b) => describeChange(a, b, locale),
    }),
  );
  return changes;
}
