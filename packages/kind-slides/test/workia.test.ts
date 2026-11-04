import { readFileSync } from 'node:fs';
import { createRegistry, defaultTheme, prepareContent, silentLogger } from '@artkit-ai/core';
import { describe, expect, it } from 'vitest';
import { createSlidesExporters } from '../src/export/index.js';
import {
  createSlidesKind,
  type LayoutDefinition,
  type LayoutSlot,
  type Paragraph,
  type Run,
  type SlideInput,
  type SlidesContent,
  type SlotContent,
  type SlotContentKind,
} from '../src/index.js';
import { readZip } from './zip.js';

/**
 * Compatibility with the first consumer: its decks use semantic layouts with typed blocks (cover, KPIs, steps,
 * cards…). None of them ship as built-ins; the application registers equivalent layouts.
 */
interface WorkiaBlock {
  id: string;
  tipo: 'texto' | 'indicador' | 'etapa' | 'cartao' | 'imagem';
  markdown?: string;
  valor?: string;
  rotulo?: string;
  indice?: string;
  titulo?: string;
  descricao?: string;
  itens?: string[];
  inputId?: string;
  legenda?: string;
}

interface WorkiaSlide {
  id: string;
  layout: string;
  titulo: string;
  destaque?: string;
  subtitulo?: string;
  notas?: string;
  blocos: WorkiaBlock[];
}

const deck = JSON.parse(readFileSync(new URL('./fixtures/workia-deck.json', import.meta.url), 'utf8')) as {
  titulo: string;
  slides: WorkiaSlide[];
};

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

const workiaLayouts: LayoutDefinition[] = [
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

/** Small Markdown subset used by the consumer: paragraphs, **bold**, *italic*, nested and numbered lists. */
function markdownParagraphs(markdown: string): Paragraph[] {
  const runs = (text: string): Run[] => {
    const out: Run[] = [];
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
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

function textSlot(block: WorkiaBlock): SlotContent {
  return { type: 'text', paragraphs: markdownParagraphs(block.markdown ?? '') };
}

function convertSlide(slide: WorkiaSlide): SlideInput {
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
                image: { asset: `asset://${block.inputId}`, alt: block.legenda ?? block.inputId ?? '' },
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

describe('workia deck compatibility', () => {
  const kind = createSlidesKind({ layouts: workiaLayouts });
  const registry = createRegistry({ kinds: [kind] });
  const raw = { slides: deck.slides.map(convertSlide), footer: { text: deck.titulo, slideNumber: true } };

  it('converts every slide into valid content with registered layouts', () => {
    const { content, lint } = prepareContent(registry, 'slides', raw);
    const slides = (content as SlidesContent).slides;
    expect(slides.map((slide) => slide.layout)).toEqual([
      'capa',
      'titulo-texto',
      'indicadores',
      'etapas',
      'lista-cartoes',
      'duas-colunas',
      'secao',
      'encerramento',
    ]);
    expect(slides[2]!.slots.body).toMatchObject({
      type: 'stats',
      items: [{ value: '40%' }, { value: '3x' }, { value: '1' }],
    });
    expect(lint.filter((issue) => issue.severity === 'warning')).toEqual([]);
    const projection = kind.project(content as SlidesContent, { mode: 'full', locale: 'pt-BR' }).text;
    expect(projection).toContain('Slide 3 (id: s3, layout: indicadores)');
    expect(projection).toContain('    - 40% — menos retrabalho');
    expect(projection).toContain('  notas: "Reforçar que os números vêm do piloto."');
  });

  it('exports the converted deck to pptx', async () => {
    const { content } = prepareContent(registry, 'slides', raw);
    const warnings: string[] = [];
    const [exporter] = createSlidesExporters({ layouts: kind.layouts });
    const bytes = await exporter!.export(content as SlidesContent, {
      title: deck.titulo,
      theme: defaultTheme,
      locale: 'pt-BR',
      logger: silentLogger,
      assets: { resolve: () => Promise.reject(new Error('inputs are not assets')) },
      warn: (message) => warnings.push(message),
    });
    const files = readZip(bytes);
    const slide = (n: number) => files.get(`ppt/slides/slide${n}.xml`) ?? '';
    expect(slide(1)).toContain('Portal do Cliente');
    expect(slide(1)).toContain('Acme Indústria');
    expect(slide(2)).toContain('três sistemas');
    expect(slide(2)).toContain('Relatórios atrasados');
    expect(slide(3)).toContain('mais rapidez nos relatórios');
    expect(slide(4)).toContain('Implantação');
    expect(slide(5)).toContain('Nuvem elástica');
    expect(slide(6)).toContain('<a:buAutoNum');
    expect(slide(8)).toContain('contato@mouts.info');
    expect(warnings.some((warning) => warning.includes('asset://in_arquitetura'))).toBe(true);
  });
});
