import type { Artifact } from '@artkit-ai/core';
import { Assertions, allText, mentionsNumber, near, normalize, runsText } from './checks.js';
import type { CheckContext, EvalTask, TaskContext, ToolCaller } from './types.js';

// Minimal structural views of kind content, enough for checks (the kinds own the full types).
interface DocBlock {
  id: string;
  type: string;
  level?: number;
  runs?: unknown;
  header?: unknown[];
  rows?: unknown[][];
  footer?: unknown[];
  tone?: string;
}
interface DocContent {
  blocks: DocBlock[];
}
interface SheetCell {
  v?: unknown;
  f?: string;
}
interface SheetContent {
  sheets: { id: string; name: string; cells: Record<string, SheetCell> }[];
  names?: { name: string; ref: string }[];
}
interface SlidesContent {
  slides: { id: string; layout: string; slots?: Record<string, unknown>; notes?: string }[];
}
interface DiagramContent {
  nodes: { id: string; label: string; shape?: string; group?: string }[];
  edges: { id: string; from: string; to: string; label?: string }[];
  groups: { id: string; label: string; kind?: string }[];
}

const content = <T>(artifact: Artifact | undefined) => artifact?.content as T | undefined;

async function only(ctx: CheckContext, kind: string, a: Assertions): Promise<Artifact | undefined> {
  const found = await ctx.artifacts(kind);
  a.that(found.length >= 1, `a ${kind} artifact exists`);
  return found[0];
}

async function byId(ctx: CheckContext, id: string): Promise<Artifact> {
  return ctx.service.get(ctx.userScope, id);
}

function usedReplaceContent(ctx: CheckContext): boolean {
  return ctx.calls.some(
    (call) =>
      call.name.startsWith('artifact_apply') &&
      JSON.stringify((call.input as { operations?: unknown })?.operations ?? []).includes(
        '"replace_content"',
      ),
  );
}

function sheetCells(sheet: SheetContent): SheetCell[] {
  return sheet.sheets.flatMap((s) => Object.values(s.cells));
}

// ---------------------------------------------------------------------------------------------- document

const docCreateProposal: EvalTask = {
  id: 'document-create-proposal',
  title: 'Create a proposal with sections, a table and a callout',
  category: 'create',
  kinds: ['document'],
  prompt: [
    'Create a document titled "Proposta Portal de Fornecedores" with three sections: Escopo, Premissas and Investimento.',
    'Escopo: one paragraph saying the portal centralizes supplier onboarding.',
    'Premissas: put the assumptions in a warning callout: the client provides access to the ERP sandbox.',
    'Investimento: a table with columns Módulo and Horas, rows Login = 40 and Relatórios = 80, and a total of 120.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const doc = content<DocContent>(await only(ctx, 'document', a));
    const blocks = doc?.blocks ?? [];
    const headings = blocks.filter((b) => b.type === 'heading').map((b) => normalize(runsText(b.runs)));
    for (const name of ['escopo', 'premissas', 'investimento']) {
      a.that(
        headings.some((h) => h.includes(name)),
        `heading "${name}"`,
      );
    }
    const table = blocks.find((b) => b.type === 'table');
    const header = (table?.header ?? []).map((cell) => normalize(runsText(cell)));
    a.that(
      header.some((h) => h.includes('modulo')) && header.some((h) => h.includes('horas')),
      'table header Módulo | Horas',
    );
    a.that((table?.rows ?? []).length >= 2, 'table has at least two rows');
    a.that(mentionsNumber(allText([table?.rows, table?.footer]), 120), 'table shows the total 120');
    a.that(
      blocks.some((b) => b.type === 'callout' && b.tone === 'warning'),
      'assumptions in a warning callout',
    );
    return a.result();
  },
  async reference(tools) {
    const created = await tools.call('artifact_create', {
      kind: 'document',
      title: 'Proposta Portal de Fornecedores',
      input: {
        format: 'markdown',
        source: [
          '## Escopo',
          '',
          'O portal centraliza o cadastro de fornecedores.',
          '',
          '## Premissas',
          '',
          '## Investimento',
          '',
          '| Módulo | Horas |',
          '| --- | ---: |',
          '| Login | 40 |',
          '| Relatórios | 80 |',
          '| Total | 120 |',
        ].join('\n'),
      },
    });
    const read = await tools.call<{ text: string; version: number }>('artifact_read', {
      id: created.id,
      mode: 'outline',
    });
    const premissas = /Premissas.*?#([A-Za-z0-9_-]+)/.exec(read.text)?.[1] ?? /(h\d+)/.exec(read.text)?.[1];
    await tools.call('artifact_apply', {
      id: created.id,
      baseVersion: read.version,
      operations: [
        {
          op: 'insert_block',
          after: premissas,
          block: {
            type: 'callout',
            tone: 'warning',
            title: 'Premissa',
            runs: [{ text: 'O cliente fornece acesso ao sandbox do ERP.' }],
          },
        },
      ],
    });
  },
};

const docEditPoint: EvalTask = {
  id: 'document-edit-point',
  title: 'Change one fact and add a paragraph after it',
  category: 'edit',
  kinds: ['document'],
  prompt:
    'In document {{doc}}, the deadline changed from 16 to 18 weeks. Fix it and add, right after that paragraph, a new paragraph: "Inclui operação assistida de 4 semanas." Do not touch anything else.',
  async setup(ctx) {
    const { artifact } = await ctx.service.create(ctx.userScope, {
      kind: 'document',
      title: 'Cronograma do projeto',
      input: {
        format: 'markdown',
        source: [
          '# Cronograma <!-- #titulo -->',
          '',
          'O projeto começa em janeiro. <!-- #inicio -->',
          '',
          'O prazo total é de 16 semanas a partir do kickoff. <!-- #prazo -->',
          '',
          'Os marcos são revisados a cada quinzena. <!-- #marcos -->',
        ].join('\n'),
      },
    });
    return { doc: artifact.id };
  },
  async check(ctx) {
    const a = new Assertions();
    const doc = content<DocContent>(await byId(ctx, ctx.vars.doc!));
    const blocks = doc?.blocks ?? [];
    const text = blocks.map((b) => runsText(b.runs)).join('\n');
    a.that(text.includes('18 semanas'), 'deadline says 18 semanas');
    a.that(!text.includes('16 semanas'), 'old deadline removed');
    const index = blocks.findIndex((b) => runsText(b.runs).includes('18 semanas'));
    a.that(
      normalize(runsText(blocks[index + 1]?.runs)).includes('operacao assistida'),
      'new paragraph right after',
    );
    a.that(blocks.length === 5, 'exactly one block added');
    a.that(
      ['titulo', 'inicio', 'marcos'].every((id) => blocks.some((b) => b.id === id)),
      'other block ids kept',
    );
    a.that(!usedReplaceContent(ctx), 'edited with operations, not replace_content');
    return a.result();
  },
  async reference(tools, ctx) {
    const read = await tools.call<{ version: number }>('artifact_read', { id: ctx.vars.doc, mode: 'full' });
    await tools.call('artifact_apply', {
      id: ctx.vars.doc,
      baseVersion: read.version,
      operations: [
        { op: 'replace_text', id: 'prazo', find: '16 semanas', replace: '18 semanas' },
        {
          op: 'insert_block',
          after: 'prazo',
          block: { type: 'paragraph', runs: [{ text: 'Inclui operação assistida de 4 semanas.' }] },
        },
      ],
    });
  },
};

const LARGE_SECTIONS = 240;

const docLargeRead: EvalTask = {
  id: 'document-large-paginated',
  title: 'Edit one paragraph of a large document using outline and range reads',
  category: 'large',
  kinds: ['document'],
  prompt:
    'Document {{doc}} is long. The paragraph right under the heading "Seção 187" must say exactly "Revisado pelo jurídico." Replace only that paragraph text; do not rewrite or reread the whole document.',
  async setup(ctx) {
    const parts: string[] = [];
    for (let i = 1; i <= LARGE_SECTIONS; i++) {
      parts.push(
        `## Seção ${i} <!-- #s${i} -->`,
        '',
        `Texto provisório da seção ${i}, aguardando revisão. <!-- #p${i} -->`,
        '',
      );
    }
    const { artifact } = await ctx.service.create(ctx.userScope, {
      kind: 'document',
      title: 'Contrato longo',
      input: { format: 'markdown', source: parts.join('\n') },
    });
    return { doc: artifact.id };
  },
  async check(ctx) {
    const a = new Assertions();
    const doc = content<DocContent>(await byId(ctx, ctx.vars.doc!));
    const blocks = doc?.blocks ?? [];
    const target = blocks.find((b) => b.id === 'p187');
    a.that(runsText(target?.runs).trim() === 'Revisado pelo jurídico.', 'paragraph under Seção 187 replaced');
    a.that(blocks.length === LARGE_SECTIONS * 2, 'no blocks added or removed');
    a.that(
      blocks.filter((b) => b.type === 'paragraph' && runsText(b.runs).includes('aguardando revisão'))
        .length ===
        LARGE_SECTIONS - 1,
      'other paragraphs untouched',
    );
    a.that(!usedReplaceContent(ctx), 'did not rewrite the document');
    return a.result();
  },
  async reference(tools, ctx) {
    const outline = await tools.call<{ version: number }>('artifact_read', {
      id: ctx.vars.doc,
      mode: 'outline',
      maxTokens: 2000,
    });
    await tools.call('artifact_read', { id: ctx.vars.doc, mode: 'range', range: 's187..p187' });
    await tools.call('artifact_apply', {
      id: ctx.vars.doc,
      baseVersion: outline.version,
      operations: [
        { op: 'update_block', id: 'p187', fields: { runs: [{ text: 'Revisado pelo jurídico.' }] } },
      ],
    });
  },
};

// ------------------------------------------------------------------------------------------------- sheet

const sheetCreateEstimate: EvalTask = {
  id: 'sheet-create-estimate',
  title: 'Create an estimate with parameters, computed column and totals',
  category: 'create',
  kinds: ['sheet'],
  prompt: [
    'Create a spreadsheet "Estimativa de esforço".',
    'Parameters: hourly rate 150 and margin 20%.',
    'Activities with hours: Login 10, Relatórios 20.5, Treinamento 8.',
    'Each activity has a subtotal = hours × hourly rate, a total of the subtotals, and a total with margin.',
    'All computed values must be formulas, never typed numbers.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const sheet = content<SheetContent>(await only(ctx, 'sheet', a));
    const cells = sheet ? sheetCells(sheet) : [];
    const formulas = cells.filter((cell) => typeof cell.f === 'string');
    a.that(formulas.length >= 5, 'subtotals and totals are formulas');
    a.that(
      formulas.some((cell) => near(cell.v, 5775)),
      'a formula computes the total 5775',
    );
    a.that(
      formulas.some((cell) => near(cell.v, 6930)),
      'a formula computes the total with margin 6930',
    );
    a.that(
      !cells.some((cell) => cell.f === undefined && (near(cell.v, 5775) || near(cell.v, 6930))),
      'totals are not typed',
    );
    a.that(
      cells.some((cell) => near(cell.v, 150)) && cells.some((cell) => near(cell.v, 0.2)),
      'parameters stored once',
    );
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      kind: 'sheet',
      title: 'Estimativa de esforço',
      content: {
        sheets: [
          {
            id: 'estimativa',
            name: 'Estimativa',
            cells: {
              A1: { v: 'Valor hora' },
              B1: { v: 150, fmt: 'currency' },
              A2: { v: 'Margem' },
              B2: { v: 0.2, fmt: 'percent' },
              A4: { v: 'Atividade' },
              B4: { v: 'Horas' },
              C4: { v: 'Subtotal' },
              A5: { v: 'Login' },
              B5: { v: 10 },
              C5: { f: 'B5*$B$1', fmt: 'currency' },
              A6: { v: 'Relatórios' },
              B6: { v: 20.5 },
              C6: { f: 'B6*$B$1', fmt: 'currency' },
              A7: { v: 'Treinamento' },
              B7: { v: 8 },
              C7: { f: 'B7*$B$1', fmt: 'currency' },
              A8: { v: 'Total' },
              C8: { f: 'SUM(C5:C7)', fmt: 'currency' },
              A9: { v: 'Total com margem' },
              C9: { f: 'C8*(1+$B$2)', fmt: 'currency' },
            },
          },
        ],
      },
    });
  },
};

const sheetEditInsertRow: EvalTask = {
  id: 'sheet-edit-insert-row',
  title: 'Insert a row above the total and keep formulas correct',
  category: 'edit',
  kinds: ['sheet'],
  prompt:
    'In spreadsheet {{sheet}}, add the activity "Treinamento" in group "Implantação" with 8 hours, above the Total row. Its subtotal must use the same formula as the other rows and the totals must include it.',
  async setup(ctx) {
    const { artifact } = await ctx.service.create(ctx.userScope, {
      kind: 'sheet',
      title: 'Estimativa',
      content: {
        sheets: [
          {
            id: 'estimativa',
            name: 'Estimativa',
            cells: {
              A1: { v: 'Atividade' },
              B1: { v: 'Grupo' },
              C1: { v: 'Horas' },
              D1: { v: 'Subtotal' },
              A2: { v: 'Login' },
              B2: { v: 'Construção' },
              C2: { v: 10 },
              D2: { f: 'C2*valor_hora', fmt: 'currency' },
              A3: { v: 'Relatórios' },
              B3: { v: 'Construção' },
              C3: { v: 20.5 },
              D3: { f: 'C3*valor_hora', fmt: 'currency' },
              A4: { v: 'Total' },
              C4: { f: 'SUM(C2:C3)' },
              D4: { f: 'SUM(D2:D3)', fmt: 'currency' },
              F1: { v: 'Valor hora' },
              G1: { v: 150 },
            },
          },
        ],
        names: [{ name: 'valor_hora', ref: 'Estimativa!$G$1' }],
      },
    });
    return { sheet: artifact.id };
  },
  async check(ctx) {
    const a = new Assertions();
    const sheet = content<SheetContent>(await byId(ctx, ctx.vars.sheet!));
    const cells = sheet?.sheets.find((s) => s.id === 'estimativa')?.cells ?? {};
    const row = Object.entries(cells)
      .find(([, cell]) => cell.v === 'Treinamento')?.[0]
      ?.replace(/[A-Z]+/, '');
    a.that(row !== undefined, 'Treinamento row exists');
    a.that(cells[`B${row}`]?.v === 'Implantação' && near(cells[`C${row}`]?.v, 8), 'group and hours set');
    a.that(
      typeof cells[`D${row}`]?.f === 'string' && near(cells[`D${row}`]?.v, 1200),
      'subtotal formula = 1200',
    );
    const totals = Object.values(cells).filter((cell) => cell.f?.toUpperCase().includes('SUM('));
    a.that(
      totals.some((cell) => near(cell.v, 38.5)),
      'hours total includes the new row',
    );
    a.that(
      totals.some((cell) => near(cell.v, 5775)),
      'subtotal total includes the new row',
    );
    const totalRow = Object.entries(cells)
      .find(([, cell]) => cell.v === 'Total')?.[0]
      ?.replace(/[A-Z]+/, '');
    a.that(Number(totalRow) > Number(row), 'new row is above Total');
    return a.result();
  },
  async reference(tools, ctx) {
    const read = await tools.call<{ version: number }>('artifact_read', { id: ctx.vars.sheet, mode: 'full' });
    await tools.call('artifact_apply', {
      id: ctx.vars.sheet,
      baseVersion: read.version,
      operations: [
        { op: 'insert_rows', sheet: 'estimativa', at: 4, count: 1 },
        {
          op: 'set_cells',
          sheet: 'estimativa',
          cells: { A4: { v: 'Treinamento' }, B4: { v: 'Implantação' }, C4: { v: 8 } },
        },
        { op: 'fill_range', sheet: 'estimativa', source: 'D3', target: 'D4' },
        // Inserting right below SUM(C2:C3) does not expand it (Excel semantics), so totals are updated too.
        {
          op: 'set_cells',
          sheet: 'estimativa',
          cells: { C5: { f: 'SUM(C2:C4)' }, D5: { f: 'SUM(D2:D4)', fmt: 'currency' } },
        },
      ],
    });
  },
};

// ------------------------------------------------------------------------------------------------ slides

const slidesCreateDeck: EvalTask = {
  id: 'slides-create-deck',
  title: 'Create a five-slide deck with semantic layouts',
  category: 'create',
  kinds: ['slides'],
  prompt: [
    'Create a 5-slide presentation "Portal de Fornecedores":',
    '1. a title slide;',
    '2. the problem, as bullets (three disconnected systems, data typed twice, late reports) with speaker notes;',
    '3. a highlight number: onboarding 40% faster in the pilot;',
    '4. the plan in three steps: Descoberta, Construção, Implantação;',
    '5. a closing slide with the next step.',
    'Every slide needs a title; prefer layouts over free positioning.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const deck = content<SlidesContent>(await only(ctx, 'slides', a));
    const slides = deck?.slides ?? [];
    a.that(slides.length === 5, 'five slides');
    a.that(slides[0]?.layout === 'title', 'first slide uses the title layout');
    a.that(
      slides.every((s) => typeof s.slots?.title === 'string' || allText(s.slots?.title).trim().length > 0),
      'every slide has a title',
    );
    a.that(
      slides.some((s) => allText(s.slots).includes('40%')),
      'a slide highlights 40%',
    );
    const steps = slides
      .flatMap((s) => Object.values(s.slots ?? {}))
      .find((slot) => (slot as { type?: string })?.type === 'steps') as { items?: unknown[] } | undefined;
    a.that((steps?.items ?? []).length === 3, 'plan in three steps');
    a.that(
      slides.some((s) => (s.notes ?? '').trim().length > 0),
      'speaker notes present',
    );
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      kind: 'slides',
      title: 'Portal de Fornecedores',
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
              title: 'O cadastro manual atrasa a operação',
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
              stat: { type: 'stats', items: [{ value: '40%', label: 'mais rápido' }] },
            },
          },
          {
            id: 'plano',
            layout: 'title-content',
            slots: {
              title: 'Entrega em três etapas',
              body: {
                type: 'steps',
                items: [{ title: 'Descoberta' }, { title: 'Construção' }, { title: 'Implantação' }],
              },
            },
          },
          { id: 'fechamento', layout: 'section', slots: { title: 'Próximo passo: kickoff em janeiro' } },
        ],
      },
    });
  },
};

const slidesRestructure: EvalTask = {
  id: 'slides-restructure',
  title: 'Reorder and remove slides without rewriting the deck',
  category: 'restructure',
  kinds: ['slides'],
  prompt:
    'In presentation {{deck}}, make the schedule slide the second slide and delete the appendix slide. Keep everything else as it is.',
  async setup(ctx) {
    const { artifact } = await ctx.service.create(ctx.userScope, {
      kind: 'slides',
      title: 'Apresentação',
      content: {
        slides: [
          { id: 'capa', layout: 'title', slots: { title: 'Apresentação' } },
          {
            id: 'contexto',
            layout: 'title-content',
            slots: { title: 'Contexto', body: { type: 'bullets', items: ['A', 'B'] } },
          },
          {
            id: 'solucao',
            layout: 'title-content',
            slots: { title: 'Solução', body: { type: 'bullets', items: ['C'] } },
          },
          {
            id: 'cronograma',
            layout: 'title-content',
            slots: { title: 'Cronograma', body: { type: 'bullets', items: ['Fase 1'] } },
          },
          {
            id: 'anexo',
            layout: 'title-content',
            slots: { title: 'Anexo', body: { type: 'bullets', items: ['Detalhes'] } },
          },
        ],
      },
    });
    return { deck: artifact.id };
  },
  async check(ctx) {
    const a = new Assertions();
    const deck = content<SlidesContent>(await byId(ctx, ctx.vars.deck!));
    const ids = (deck?.slides ?? []).map((s) => s.id);
    a.that(
      ids.join(',') === 'capa,cronograma,contexto,solucao',
      `order capa,cronograma,contexto,solucao (got ${ids.join(',')})`,
    );
    a.that(!usedReplaceContent(ctx), 'restructured with operations');
    return a.result();
  },
  async reference(tools, ctx) {
    const read = await tools.call<{ version: number }>('artifact_read', {
      id: ctx.vars.deck,
      mode: 'outline',
    });
    await tools.call('artifact_apply', {
      id: ctx.vars.deck,
      baseVersion: read.version,
      operations: [
        { op: 'move_slide', slide: 'cronograma', after: 'capa' },
        { op: 'remove_slide', slide: 'anexo' },
      ],
    });
  },
};

// ----------------------------------------------------------------------------------------------- diagram

const diagramCreate: EvalTask = {
  id: 'diagram-create-architecture',
  title: 'Create a layered architecture diagram',
  category: 'create',
  kinds: ['diagram'],
  prompt: [
    'Create an architecture diagram "Arquitetura do portal" with three layers (top to bottom):',
    'Canais: Portal web and App mobile; Serviços: API and Autenticação; Dados: PostgreSQL (a database) and Redis.',
    'Connections: Portal web → API, App mobile → API, API → Autenticação, API → PostgreSQL, API → Redis.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const diagram = content<DiagramContent>(await only(ctx, 'diagram', a));
    const nodes = diagram?.nodes ?? [];
    const find = (word: string) => nodes.find((n) => normalize(n.label).includes(normalize(word)));
    a.that((diagram?.groups ?? []).length === 3, 'three groups');
    for (const word of ['portal web', 'app mobile', 'api', 'autentica', 'postgres', 'redis'])
      a.that(find(word), `node ${word}`);
    a.that(find('postgres')?.shape === 'cylinder', 'PostgreSQL drawn as a database');
    const edge = (from: string, to: string) =>
      (diagram?.edges ?? []).some((e) => e.from === find(from)?.id && e.to === find(to)?.id);
    for (const [from, to] of [
      ['portal web', 'api'],
      ['app mobile', 'api'],
      ['api', 'autentica'],
      ['api', 'postgres'],
      ['api', 'redis'],
    ] as const) {
      a.that(edge(from, to), `edge ${from} -> ${to}`);
    }
    a.that(
      nodes.every((n) => n.group !== undefined),
      'every node belongs to a layer',
    );
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
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
          '  web --> api',
          '  app --> api',
          '  api --> auth',
          '  api --> pg',
          '  api --> redis',
        ].join('\n'),
      },
    });
  },
};

const diagramConflict: EvalTask = {
  id: 'diagram-fix-after-conflict',
  title: 'Recover from a concurrent human edit (VERSION_CONFLICT)',
  category: 'fix',
  kinds: ['diagram'],
  prompt:
    'In diagram {{diagram}}, rename the node "api" to "API Gateway" and add a new node "Fila" (id "fila") connected from it. Read the diagram first.',
  async setup(ctx) {
    const { artifact } = await ctx.service.create(ctx.userScope, {
      kind: 'diagram',
      title: 'Integrações',
      input: { format: 'mermaid', source: 'flowchart LR\n  web[Portal] --> api[API]\n  api --> db[(Banco)]' },
    });
    return { diagram: artifact.id };
  },
  // A human renames the same node right after the model's first read, so its first apply conflicts.
  async afterToolCall(ctx, call, index) {
    if (call.name !== 'artifact_read' || index !== 0) return;
    const current = await ctx.service.get(ctx.userScope, ctx.vars.diagram!);
    await ctx.service.apply(ctx.userScope, {
      artifactId: current.id,
      baseVersion: current.version,
      operations: [{ op: 'update_node', id: 'api', label: 'Core API' }],
    });
  },
  async check(ctx) {
    const a = new Assertions();
    const diagram = content<DiagramContent>(await byId(ctx, ctx.vars.diagram!));
    const api = diagram?.nodes.find((n) => n.id === 'api');
    a.that(api?.label === 'API Gateway', 'api renamed to API Gateway');
    a.that(
      diagram?.nodes.some((n) => n.id === 'fila'),
      'fila node exists',
    );
    a.that(
      diagram?.edges.some((e) => e.from === 'api' && e.to === 'fila'),
      'edge api -> fila',
    );
    return a.result();
  },
  async reference(tools, ctx) {
    const operations = [
      { op: 'update_node', id: 'api', label: 'API Gateway' },
      { op: 'add_node', id: 'fila', label: 'Fila', shape: 'cylinder' },
      { op: 'add_edge', from: 'api', to: 'fila' },
    ];
    let read = await tools.call<{ version: number }>('artifact_read', { id: ctx.vars.diagram, mode: 'full' });
    let result = await tools.call('artifact_apply', {
      id: ctx.vars.diagram,
      baseVersion: read.version,
      operations,
    });
    if (!result.ok) {
      read = await tools.call<{ version: number }>('artifact_read', { id: ctx.vars.diagram, mode: 'full' });
      result = await tools.call('artifact_apply', {
        id: ctx.vars.diagram,
        baseVersion: read.version,
        operations,
      });
    }
  },
};

// ------------------------------------------------------------------------------------------------- cross

const crossEstimateProposal: EvalTask = {
  id: 'cross-estimate-proposal',
  title: 'Spreadsheet estimate and proposal document that agree',
  category: 'cross',
  kinds: ['sheet', 'document'],
  prompt: [
    'Create two artifacts that agree with each other:',
    '1. a spreadsheet "Estimativa" with a Tech Lead working 120 hours at 165 per hour, with the total as a formula;',
    '2. a document "Proposta" with an Investimento section that states the same total value.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const sheet = content<SheetContent>(await only(ctx, 'sheet', a));
    const doc = content<DocContent>(await only(ctx, 'document', a));
    const cells = sheet ? sheetCells(sheet) : [];
    a.that(
      cells.some((cell) => typeof cell.f === 'string' && near(cell.v, 19800)),
      'sheet total 19800 is a formula',
    );
    const text = (doc?.blocks ?? [])
      .map((b) => `${runsText(b.runs)} ${allText(b.rows)} ${allText(b.footer)}`)
      .join('\n');
    a.that(normalize(text).includes('investimento'), 'document has an Investimento section');
    a.that(mentionsNumber(text, 19800), 'document states 19800');
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      kind: 'sheet',
      title: 'Estimativa',
      content: {
        sheets: [
          {
            id: 'resumo',
            name: 'Resumo',
            cells: {
              A1: { v: 'Perfil' },
              B1: { v: 'Horas' },
              C1: { v: 'Valor hora' },
              D1: { v: 'Total' },
              A2: { v: 'Tech Lead' },
              B2: { v: 120 },
              C2: { v: 165, fmt: 'currency' },
              D2: { f: 'B2*C2', fmt: 'currency' },
            },
          },
        ],
      },
    });
    await tools.call('artifact_create', {
      kind: 'document',
      title: 'Proposta',
      input: { format: 'markdown', source: '## Investimento\n\nO investimento total é de R$ 19.800,00.' },
    });
  },
};

/** Built-in tasks: every category of spec §21.2 across the four kinds. */
export function defaultTasks(): EvalTask[] {
  return [
    docCreateProposal,
    docEditPoint,
    docLargeRead,
    sheetCreateEstimate,
    sheetEditInsertRow,
    slidesCreateDeck,
    slidesRestructure,
    diagramCreate,
    diagramConflict,
    crossEstimateProposal,
  ];
}

export type { TaskContext, ToolCaller };
