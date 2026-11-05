import type { ArtifactService, Scope } from '@artkit-ai/core';

const MARKDOWN = `---
cliente: Acme Indústria
data: Novembro de 2026
---
# Proposta técnica {#proposta}

## Escopo {#escopo}

O portal centraliza o **cadastro** e a **homologação** de fornecedores, com integração ao ERP.

- Cadastro com validação de documentos
- Fluxo de homologação com aprovação por área
- Painel de indicadores

## Investimento {#investimento}

| Módulo | Horas | Valor |
| --- | ---: | ---: |
| Cadastro | 120 | R$ 19.800,00 |
| Homologação | 80 | R$ 13.200,00 |

> [!WARNING]
> O cliente disponibiliza acesso ao ambiente de testes do ERP.
`;

const WORKBOOK = {
  id: 'estimativa',
  name: 'Estimativa',
  locale: 'pt-BR',
  sheetOrder: ['resumo'],
  sheets: {
    resumo: {
      id: 'resumo',
      name: 'Resumo',
      rowCount: 40,
      columnCount: 8,
      cellData: {
        '0': { '0': { v: 'Perfil' }, '1': { v: 'Horas' }, '2': { v: 'Valor hora' }, '3': { v: 'Total' } },
        '1': { '0': { v: 'Tech Lead' }, '1': { v: 120 }, '2': { v: 165 }, '3': { f: '=B2*C2', v: 19800 } },
        '2': { '0': { v: 'Dev' }, '1': { v: 80 }, '2': { v: 120 }, '3': { f: '=B3*C3', v: 9600 } },
      },
    },
  },
  styles: {},
  // Dropdown on the profile column: only these profiles are accepted there.
  validations: [{ sheet: 'resumo', range: 'A2:A20', list: ['Tech Lead', 'Dev', 'QA'] }],
};

const DECK = `root = Deck([capa, escopo, numeros])
capa = Slide("title", [Title("Portal de Fornecedores"), Subtitle("Acme Indústria")])
escopo = Slide("title-content", [Title("Escopo"), Bullets(["Cadastro e homologação", "Integração com o ERP", "Painel de indicadores"]), Notes("Confirmar o módulo de relatórios")])
numeros = Slide("big-number", [Title("Investimento"), StatCard("Horas", "200"), StatCard("Valor", "R$ 33.000")])
`;

/** Example artifacts, one per native format. */
export async function seed(service: ArtifactService, scope: Scope): Promise<string[]> {
  const doc = await service.create(scope, {
    format: 'markdown',
    title: 'Proposta técnica: Portal de Fornecedores',
    content: MARKDOWN,
  });
  const sheet = await service.create(scope, {
    format: 'univer-sheet',
    title: 'Estimativa',
    content: WORKBOOK,
  });
  const deck = await service.create(scope, { format: 'openui', title: 'Apresentação', content: DECK });
  return [doc.artifact.id, sheet.artifact.id, deck.artifact.id];
}

/** Operations an agent would send, per format, to try the edit path from the playground. */
export const SCENARIOS: Record<string, unknown[]> = {
  markdown: [
    { op: 'replace_text', section: 'escopo', find: 'cadastro', replace: 'cadastro de fornecedores' },
  ],
  'univer-sheet': [{ op: 'set_values', sheet: 'Resumo', at: 'A4', values: [['QA', 40, 130, '=B4*C4']] }],
  openui: [{ op: 'move_child', name: 'root', child: 'numeros', position: 1 }],
};
