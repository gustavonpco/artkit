// @vitest-environment jsdom
import { createMemoryAssetStore, defaultTheme, silentLogger } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import {
  contentToMermaid,
  diagramExporters,
  escapeXml,
  renderDiagramHtml,
  renderDiagramSvg,
} from '../src/export/index.js';
import type { DiagramContent } from '../src/index.js';
import { parseMermaid } from '../src/mermaid.js';
import { flow, layered } from './fixtures.js';

const tricky: DiagramContent = {
  ...layered,
  nodes: layered.nodes.map((node) => (node.id === 'web' ? { ...node, label: 'Portal <web> & "app"' } : node)),
  edges: layered.edges.map((edge) => (edge.id === 'e1' ? { ...edge, label: "HTTPS 'x' <y>" } : edge)),
  groups: layered.groups.map((group) =>
    group.id === 'dados' ? { ...group, label: 'Dados & <arquivos>' } : group,
  ),
};

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

describe('svg exporter', () => {
  it('is registered for the diagram kind with runtime any', () => {
    expect(
      diagramExporters.map((exporter) => [
        exporter.kind,
        exporter.format,
        exporter.mimeType,
        exporter.runtime,
      ]),
    ).toEqual([
      ['diagram', 'svg', 'image/svg+xml', 'any'],
      ['diagram', 'html', 'text/html; charset=utf-8', 'any'],
      ['diagram', 'md', 'text/markdown; charset=utf-8', 'any'],
    ]);
  });

  it('produces standalone, well-formed SVG with every label escaped', async () => {
    const warnings: string[] = [];
    const bytes = await diagramExporters[0]!.export(tricky, {
      title: 'Arquitetura <v1>',
      theme: defaultTheme,
      locale: 'pt-BR',
      assets: createMemoryAssetStore(),
      logger: silentLogger,
      warn: (message) => warnings.push(message),
    });
    const svg = new TextDecoder().decode(bytes);
    const doc = parse(svg);
    const root = doc.documentElement;
    expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('role')).toBe('img');
    expect(doc.querySelector('title')!.textContent).toBe('Arquitetura <v1>');
    expect(doc.querySelector('desc')!.textContent).toContain('Diagrama (de cima para baixo) com 6 nós');
    const text = [...doc.querySelectorAll('text')].map((node) => node.textContent).join('|');
    expect(text).toContain('Portal <web> & "app"');
    expect(text).toContain("HTTPS 'x' <y>");
    expect(text).toContain('DADOS & <ARQUIVOS>');
    for (const node of tricky.nodes) expect(svg).toContain(escapeXml(node.label).split(' ')[0]!);
    expect(svg).not.toContain('<web>');
    expect(svg.toLowerCase()).not.toContain('<script');
    expect(svg).not.toMatch(/\son[a-z]+=/i);
    expect(svg).not.toMatch(/href=|url\((?!#)/);
    expect(svg).not.toContain('var(--');
    expect(warnings).toEqual([]);
  });

  it('resolves theme colors to hex', () => {
    const svg = renderDiagramSvg(layered, { theme: defaultTheme });
    const doc = parse(svg);
    const api = doc.querySelector('[data-id="api"] .ak-diagram-node-body')!;
    expect(api.getAttribute('stroke')).toBe(defaultTheme.colors.accent);
    expect(api.getAttribute('fill')).toMatch(/^#[0-9A-F]{6}$/);
    const fills = [...doc.querySelectorAll('[fill]')].map((node) => node.getAttribute('fill')!);
    expect(fills.every((fill) => fill === 'none' || /^#[0-9A-F]{6}$/.test(fill))).toBe(true);
    expect(doc.querySelectorAll('.ak-diagram-node')).toHaveLength(layered.nodes.length);
    expect(doc.querySelectorAll('.ak-diagram-edge')).toHaveLength(layered.edges.length);
    expect(doc.querySelectorAll('[marker-start]')).toHaveLength(1);
    expect(doc.querySelectorAll('[stroke-dasharray="6 4"]')).toHaveLength(2);
    expect(doc.querySelectorAll('[data-icon]')).toHaveLength(2);
  });

  it('uses the layout bounds as viewBox and is deterministic', () => {
    const a = renderDiagramSvg(flow);
    expect(renderDiagramSvg(structuredClone(flow))).toBe(a);
    const root = parse(a).documentElement;
    const [, , width, height] = root.getAttribute('viewBox')!.split(' ').map(Number);
    expect(Number(root.getAttribute('width'))).toBe(width);
    expect(Number(root.getAttribute('height'))).toBe(height);
    expect(root.getAttribute('font-family')).toBe(`${defaultTheme.fonts.body}, system-ui, sans-serif`);
  });

  it('honors abort signals', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      diagramExporters[0]!.export(flow, {
        title: 'x',
        theme: defaultTheme,
        locale: 'en',
        assets: createMemoryAssetStore(),
        logger: silentLogger,
        warn: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe('mermaid and html exporters', () => {
  it('writes a Mermaid flowchart that parses back to the same graph', () => {
    const { source } = contentToMermaid(tricky);
    expect(source.startsWith(`flowchart ${tricky.direction}`)).toBe(true);
    expect(source).toContain('subgraph');
    const back = parseMermaid(source).content;
    expect(back.nodes.map((node) => [node.id, node.label]).sort()).toEqual(
      tricky.nodes.map((node) => [node.id, node.label]).sort(),
    );
    expect(back.edges.map((edge) => [edge.from, edge.to, edge.style, edge.arrow])).toEqual(
      tricky.edges.map((edge) => [edge.from, edge.to, edge.style, edge.arrow]),
    );
    expect(back.groups.map((group) => group.label)).toEqual(tricky.groups.map((group) => group.label));
  });

  it('renames reserved ids and notes what Mermaid cannot keep', () => {
    const { source, notes } = contentToMermaid({
      direction: 'LR',
      layout: 'auto',
      groups: [],
      nodes: [
        { id: 'end', label: 'Fim', shape: 'actor', tone: 'accent' },
        { id: 'a', label: 'A', shape: 'cylinder' },
      ],
      edges: [{ id: 'e1', from: 'a', to: 'end', style: 'dashed', arrow: 'both', label: 'x|y' }],
    });
    expect(source).toContain('end_1["Fim"]');
    expect(source).toContain('a[("A")]');
    expect(source).toContain('a <-.->|"x#124;y"| end_1');
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(parseMermaid(source).content.edges).toHaveLength(1);
  });

  it('wraps the Mermaid source in a markdown fence', async () => {
    const warnings: string[] = [];
    const exporter = diagramExporters.find((item) => item.format === 'md')!;
    const bytes = await exporter.export(layered, {
      title: 'Arquitetura',
      theme: defaultTheme,
      locale: 'pt-BR',
      logger: silentLogger,
      assets: createMemoryAssetStore(),
      warn: (message) => warnings.push(message),
    });
    const md = new TextDecoder().decode(bytes);
    expect(md.startsWith('# Arquitetura\n')).toBe(true);
    expect(md).toContain('```mermaid\nflowchart');
    expect(md.trimEnd().endsWith('```')).toBe(true);
  });

  it('writes a self-contained html page with the svg and element lists', () => {
    const html = renderDiagramHtml(tricky, { title: 'Arq & <x>', locale: 'pt-BR', theme: defaultTheme });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<?xml');
    expect(html).toContain('<svg');
    expect(html).toContain('Arq &amp; &lt;x&gt;');
    expect(html).toContain('Elementos do diagrama');
    expect(html).not.toContain('<script');
  });
});
