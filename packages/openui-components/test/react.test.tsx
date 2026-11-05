// @vitest-environment jsdom

import { defaultTheme } from '@artkit-ai/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenUIRenderer } from '../src/react/index.js';

afterEach(cleanup);

const deck = `root = Deck([capa, escopo, numeros])
capa = Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])
escopo = Slide("title-content", [Title("Escopo"), Bullets(["Cadastro e homologação", "Integração Protheus"])])
numeros = Slide("big-number", [Title("Números"), StatCard("Módulos", "13"), Table(["Módulo", "Horas"], [["Login", "40"]])])
`;

describe('OpenUIRenderer', () => {
  it('renders a deck of slides with titles, bullets and tables from the artkit library', async () => {
    const { container } = render(
      <OpenUIRenderer content={deck} ctx={{ theme: defaultTheme, locale: 'pt-BR', mode: 'screen' }} />,
    );
    expect(await screen.findByText('Portal de Fornecedores')).toBeTruthy();
    expect(screen.getByText('Cadastro e homologação')).toBeTruthy();
    expect(container.querySelectorAll('section.ak-slide').length).toBe(3);
    expect(container.querySelector('table.ak-table')).not.toBeNull();
  });
});

describe('openui html export', () => {
  it('writes a self-contained page with the rendered slides and no scripts', async () => {
    const { openuiHtmlExporter } = await import('../src/export/index.js');
    const bytes = await openuiHtmlExporter.export(deck, {
      title: 'Portal',
      theme: defaultTheme,
      locale: 'pt-BR',
      assets: {} as never,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      warn: () => {},
    });
    const html = new TextDecoder().decode(bytes);
    expect(html).toContain('Portal de Fornecedores');
    expect(html).toContain('ak-slide');
    expect(html).not.toContain('<script');
  });
});
