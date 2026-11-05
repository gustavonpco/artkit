// @vitest-environment node

import { defaultTheme } from '@artkit-ai/core';
import { describe, expect, it } from 'vitest';
import { deckPptxExporter, deckSlides } from '../src/index.js';

const deck = `root = Deck([capa, escopo])
capa = Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])
escopo = Slide("title-content", [Title("Escopo"), Bullets(["Cadastro", "Integração"]), Notes("Falar do prazo")])
`;

describe('pptx export of decks', () => {
  it('reads slides in order with titles, bullets and notes', () => {
    const slides = deckSlides(deck);
    expect(slides.map((slide) => slide.title)).toEqual(['Portal de Fornecedores', 'Escopo']);
    expect(slides[1]!.bullets).toEqual(['Cadastro', 'Integração']);
    expect(slides[1]!.notes).toBe('Falar do prazo');
  });

  it('writes a pptx package', async () => {
    const bytes = await deckPptxExporter.export(deck, {
      title: 'Deck',
      theme: defaultTheme,
      locale: 'pt-BR',
      assets: {} as never,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      warn: () => {},
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK');
  });
});
