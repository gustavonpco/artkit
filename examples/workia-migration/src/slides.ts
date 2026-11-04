import type { CreateRequest } from '@artkit/core';
import type {
  LayoutDefinition,
  LayoutSlot,
  Paragraph,
  Run,
  SlideInput,
  SlotContent,
  SlotContentKind,
} from '@artkit/kind-slides';
import type { WorkiaBlock, WorkiaDeck } from './types.js';

// Workia's deck layouts are app-specific, so they are registered by the application (spec §20) instead of
// shipping as built-ins. Geometry follows the 13.333 × 7.5 in canvas.
const heading = (y = 0.4): LayoutSlot[] => [
  {
    name: 'title',
    accepts: ['text'],
    box: { x: 0.6, y, w: 8.6, h: 0.9 },
    role: 'title',
    required: true,
    valign: 'bottom',
  },
  {
    name: 'highlight',
    accepts: ['text'],
    box: { x: 9.3, y, w: 3.433, h: 0.9 },
    role: 'title',
    color: 'info',
    valign: 'bottom',
    align: 'right',
  },
  { name: 'subtitle', accepts: ['text'], box: { x: 0.6, y: y + 0.95, w: 12.133, h: 0.5 }, role: 'subtitle' },
];
const body = { x: 0.6, y: 2, w: 12.133, h: 4.8 };
const grid = (accepts: SlotContentKind[], columns: number): LayoutSlot => ({
  name: 'body',
  accepts,
  box: body,
  role: 'body',
  required: true,
  columns,
});
const coverSlots: LayoutSlot[] = [
  {
    name: 'title',
    accepts: ['text'],
    box: { x: 0.8, y: 1.6, w: 11.733, h: 1.6 },
    role: 'display',
    required: true,
    valign: 'bottom',
  },
  {
    name: 'highlight',
    accepts: ['text'],
    box: { x: 0.8, y: 3.2, w: 11.733, h: 0.9 },
    role: 'title',
    color: 'info',
  },
  { name: 'subtitle', accepts: ['text'], box: { x: 0.8, y: 4.3, w: 11.733, h: 0.9 }, role: 'subtitle' },
];

export const workiaLayouts: LayoutDefinition[] = [
  {
    name: 'capa',
    label: 'Capa',
    description: 'Cover slide.',
    footer: false,
    slots: coverSlots,
    decorations: [{ shape: 'rect', x: 0, y: 0, w: 0.3, h: 7.5, fill: 'accent' }],
  },
  {
    name: 'encerramento',
    label: 'Encerramento',
    description: 'Closing slide.',
    footer: false,
    slots: coverSlots,
  },
  { name: 'secao', label: 'Seção', description: 'Section divider.', footer: false, slots: coverSlots },
  {
    name: 'titulo-texto',
    label: 'Título e texto',
    description: 'Title and rich text.',
    slots: [...heading(), grid(['text', 'bullets'], 1)],
  },
  {
    name: 'duas-colunas',
    label: 'Duas colunas',
    description: 'Two text columns.',
    slots: [
      ...heading(),
      {
        name: 'left',
        accepts: ['text', 'bullets'],
        box: { ...body, w: 5.917 },
        role: 'body',
        required: true,
      },
      {
        name: 'right',
        accepts: ['text', 'bullets'],
        box: { ...body, x: 6.817, w: 5.917 },
        role: 'body',
        required: true,
      },
    ],
  },
  {
    name: 'indicadores',
    label: 'Indicadores',
    description: 'Up to four KPIs.',
    slots: [...heading(), grid(['stats'], 4)],
  },
  {
    name: 'etapas',
    label: 'Etapas',
    description: 'Process steps.',
    slots: [...heading(), grid(['steps'], 5)],
  },
  {
    name: 'lista-cartoes',
    label: 'Lista de cartões',
    description: 'Cards and images.',
    slots: [...heading(), grid(['cards'], 3)],
  },
];

/** The Markdown subset Workia uses inside deck blocks: paragraphs, **bold**, *italic*, nested/numbered lists. */
export function markdownParagraphs(markdown: string): Paragraph[] {
  const runs = (text: string): Run[] => {
    const out: Run[] = [];
    let last = 0;
    for (const match of text.matchAll(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
      if (match.index > last) out.push({ text: text.slice(last, match.index) });
      const token = match[0];
      out.push(
        token.startsWith('**')
          ? { text: token.slice(2, -2), bold: true }
          : { text: token.slice(1, -1), italic: true },
      );
      last = match.index + token.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out.length > 0 ? out : [{ text: '' }];
  };
  const paragraphs: Paragraph[] = [];
  for (const block of markdown.split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*([-*]|\d+\.)\s+/.test(line))) {
      for (const line of lines) {
        const match = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)!;
        const level = Math.floor(match[1]!.length / 2);
        paragraphs.push({
          runs: runs(match[3]!),
          list: /\d/.test(match[2]!) ? 'number' : 'bullet',
          ...(level ? { level } : {}),
        });
      }
    } else {
      // Hard breaks ("  \n") stay inside the paragraph.
      paragraphs.push({ runs: runs(lines.map((line) => line.replace(/\s+$/, '')).join('\n')) });
    }
  }
  return paragraphs;
}

const textSlot = (block: WorkiaBlock): SlotContent => ({
  type: 'text',
  paragraphs: markdownParagraphs(block.markdown ?? ''),
});

/**
 * Workia images point at conversation inputs (`inputId`). The application uploads those files to its
 * AssetStore first and passes the mapping; unmapped images keep a placeholder reference and export warns.
 */
export function convertSlide(
  slide: WorkiaDeck['slides'][number],
  assets: Record<string, string> = {},
): SlideInput {
  const slots: Record<string, SlotContent> = { title: slide.titulo };
  if (slide.destaque) slots.highlight = slide.destaque;
  if (slide.subtitulo) slots.subtitle = slide.subtitulo;
  const blocks = slide.blocos;
  switch (slide.layout) {
    case 'titulo-texto':
      if (blocks[0]) slots.body = textSlot(blocks[0]);
      break;
    case 'duas-colunas':
      if (blocks[0]) slots.left = textSlot(blocks[0]);
      if (blocks[1]) slots.right = textSlot(blocks[1]);
      break;
    case 'indicadores':
      slots.body = {
        type: 'stats',
        items: blocks.map((block) => ({ value: block.valor ?? '', label: block.rotulo ?? '' })),
      };
      break;
    case 'etapas':
      slots.body = {
        type: 'steps',
        items: blocks.map((block) => ({
          title: block.titulo ?? '',
          ...(block.indice ? { marker: block.indice } : {}),
          ...(block.descricao ? { description: block.descricao } : {}),
        })),
      };
      break;
    case 'lista-cartoes':
      slots.body = {
        type: 'cards',
        items: blocks.map((block) =>
          block.tipo === 'imagem'
            ? {
                image: {
                  asset: assets[block.inputId ?? ''] ?? `asset://${block.inputId}`,
                  alt: block.legenda ?? block.inputId ?? '',
                },
                ...(block.legenda ? { caption: block.legenda } : {}),
              }
            : { title: block.titulo ?? '', ...(block.itens?.length ? { bullets: block.itens } : {}) },
        ),
      };
      break;
  }
  return {
    id: slide.id,
    layout: slide.layout,
    slots,
    elements: [],
    ...(slide.notas ? { notes: slide.notas } : {}),
  };
}

export function deckRequest(source: WorkiaDeck, assets: Record<string, string> = {}): CreateRequest {
  return {
    kind: 'slides',
    title: source.titulo,
    content: {
      slides: source.slides.map((slide) => convertSlide(slide, assets)),
      footer: { text: source.titulo, slideNumber: true },
    },
  };
}
