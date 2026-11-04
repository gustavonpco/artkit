import type { ArtifactService, Scope } from '@artkit/core';

/** Example artifacts and one operation scenario per kind, shown in the playground. */
export async function seed(service: ArtifactService, scope: Scope): Promise<string[]> {
  const doc = await service.create(scope, {
    kind: 'document',
    title: 'Proposta técnica: Portal de Fornecedores',
    input: {
      format: 'markdown',
      source: {
        cover: {
          eyebrow: 'Proposta técnica',
          title: 'Portal de Fornecedores',
          subtitle: 'Cadastro e homologação em um só lugar',
          fields: [
            { label: 'Cliente', value: 'Acme Indústria' },
            { label: 'Data', value: 'Novembro de 2026' },
          ],
        },
        markdown: [
          '## 1. Escopo <!-- #escopo -->',
          '',
          'O portal centraliza o **cadastro** e a **homologação** de fornecedores, com integração ao ERP. <!-- #escopo-p1 -->',
          '',
          '- Cadastro com validação de documentos',
          '- Fluxo de homologação com aprovação por área',
          '- Painel de indicadores',
          '',
          '## 2. Investimento <!-- #investimento -->',
          '',
          '| Módulo | Horas | Valor |',
          '| --- | ---: | ---: |',
          '| Cadastro | 120 | R$ 19.800,00 |',
          '| Homologação | 80 | R$ 13.200,00 |',
          '| **Total** | **200** | **R$ 33.000,00** |',
        ].join('\n'),
      },
    },
  });
  const sheet = await service.create(scope, {
    kind: 'sheet',
    title: 'Estimativa de esforço',
    content: {
      sheets: [
        {
          id: 'estimativa',
          name: 'Estimativa',
          frozen: { rows: 1, cols: 0 },
          columns: { A: { width: 22 }, D: { width: 16 } },
          cells: {
            A1: { v: 'Atividade', s: { bold: true } },
            B1: { v: 'Grupo', s: { bold: true } },
            C1: { v: 'Horas', s: { bold: true } },
            D1: { v: 'Subtotal', s: { bold: true } },
            A2: { v: 'Login' },
            B2: { v: 'Construção' },
            C2: { v: 10 },
            D2: { f: 'C2*valor_hora', fmt: 'currency' },
            A3: { v: 'Relatórios' },
            B3: { v: 'Construção' },
            C3: { v: 20.5 },
            D3: { f: 'C3*valor_hora', fmt: 'currency' },
            A4: { v: 'Treinamento' },
            B4: { v: 'Implantação' },
            C4: { v: 8 },
            D4: { f: 'C4*valor_hora', fmt: 'currency' },
            A5: { v: 'Total', s: { bold: true } },
            C5: { f: 'SUM(C2:C4)' },
            D5: { f: 'SUM(D2:D4)', fmt: 'currency', s: { bold: true } },
            F1: { v: 'Valor hora', s: { bold: true } },
            G1: { v: 150, fmt: 'currency' },
          },
        },
      ],
      names: [{ name: 'valor_hora', ref: 'Estimativa!$G$1' }],
    },
  });
  const deck = await service.create(scope, {
    kind: 'slides',
    title: 'Apresentação comercial',
    content: {
      slides: [
        {
          id: 'capa',
          layout: 'title',
          slots: { title: 'Portal de Fornecedores', subtitle: 'Proposta 2026' },
        },
        {
          id: 'problema',
          layout: 'title-content',
          slots: {
            title: 'O cadastro manual leva 12 dias por fornecedor',
            body: {
              type: 'bullets',
              items: ['Três sistemas desconectados', 'Dados digitados duas vezes', 'Relatórios atrasados'],
            },
          },
          notes: 'Citar a auditoria de março.',
        },
        {
          id: 'impacto',
          layout: 'big-number',
          slots: {
            title: 'O piloto acelerou o cadastro',
            stat: {
              type: 'stats',
              items: [
                { value: '40%', label: 'mais rápido' },
                { value: '3x', label: 'menos erros' },
              ],
            },
          },
        },
        {
          id: 'crescimento',
          layout: 'title-content',
          slots: {
            title: 'Fornecedores cadastrados dobram a cada trimestre',
            body: {
              type: 'chart',
              chartType: 'column',
              categories: ['T1', 'T2', 'T3'],
              series: [{ name: 'Fornecedores', values: [120, 250, 510] }],
              showValues: true,
            },
          },
        },
      ],
      footer: { text: 'Acme · Confidencial', slideNumber: true },
    },
  });
  const diagram = await service.create(scope, {
    kind: 'diagram',
    title: 'Arquitetura do portal',
    input: {
      format: 'mermaid',
      source: [
        'flowchart TB',
        '  subgraph canais [Canais]',
        '    web[Portal web]',
        '    app(App mobile)',
        '  end',
        '  subgraph servicos [Serviços]',
        '    api[API]',
        '    auth[Autenticação]',
        '  end',
        '  subgraph dados [Dados]',
        '    pg[(PostgreSQL)]',
        '    redis[(Redis)]',
        '  end',
        '  web -->|HTTPS| api',
        '  app -->|HTTPS| api',
        '  api --> auth',
        '  api --> pg',
        '  api -.-> redis',
      ].join('\n'),
    },
  });
  return [doc.artifact.id, sheet.artifact.id, deck.artifact.id, diagram.artifact.id];
}

export const SCENARIOS: Record<string, unknown[]> = {
  document: [
    {
      op: 'insert_block',
      after: 'escopo-p1',
      block: {
        type: 'callout',
        tone: 'warning',
        title: 'Premissa',
        runs: [{ text: 'O ERP expõe APIs REST.' }],
      },
    },
    { op: 'replace_text', id: 'escopo-p1', find: 'centraliza', replace: 'unifica' },
  ],
  sheet: [{ op: 'set_cells', sheet: 'estimativa', cells: { G1: { v: 165, fmt: 'currency' } } }],
  slides: [{ op: 'move_slide', slide: 'impacto', after: 'capa' }],
  diagram: [
    { op: 'add_node', id: 'fila', label: 'Fila de eventos', shape: 'cylinder', group: 'dados' },
    { op: 'add_edge', from: 'api', to: 'fila', label: 'eventos', style: 'dashed' },
  ],
};
