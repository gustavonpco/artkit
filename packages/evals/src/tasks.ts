import type { Artifact } from '@artkit-ai/core';
import { Assertions, allText, mentionsNumber, normalize } from './checks.js';
import type { CheckContext, EvalTask, TaskContext, ToolCaller } from './types.js';

// Structural views of the native content, enough for the checks (each format owns the full types).
interface SheetContent {
  sheets: Record<
    string,
    { name: string; cellData: Record<string, Record<string, { v?: unknown; f?: string }>> }
  >;
}

const content = <T>(artifact: Artifact | undefined) => artifact?.content as T | undefined;

async function only(ctx: CheckContext, format: string, a: Assertions): Promise<Artifact | undefined> {
  const found = await ctx.artifacts(format);
  a.that(found.length >= 1, `a ${format} artifact exists`);
  return found[0];
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

function sheetCells(sheet: SheetContent): { v?: unknown; f?: string }[] {
  return Object.values(sheet.sheets).flatMap((s) =>
    Object.values(s.cellData).flatMap((row) => Object.values(row)),
  );
}

// ---------------------------------------------------------------------------------------- markdown

const markdownCreateProposal: EvalTask = {
  id: 'markdown-create-proposal',
  title: 'Create a proposal with sections, a table and a warning callout',
  category: 'create',
  formats: ['markdown'],
  prompt: [
    'Create a document titled "Proposta Portal de Fornecedores" with three sections: Escopo, Premissas and Investimento.',
    'Escopo: one paragraph saying the portal centralizes supplier onboarding.',
    'Premissas: put the assumptions in a warning callout: the client provides access to the ERP sandbox.',
    'Investimento: a table with columns Módulo and Horas, rows Login = 40 and Relatórios = 80, and a total of 120.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const text = String(content<string>(await only(ctx, 'markdown', a)) ?? '');
    for (const name of ['escopo', 'premissas', 'investimento']) {
      a.that(
        new RegExp(`^#+ .*${name}`, 'mi').test(normalize(text)) || normalize(text).includes(`## ${name}`),
        `heading "${name}"`,
      );
    }
    a.that(/\|\s*m[oó]dulo\s*\|\s*horas\s*\|/i.test(text), 'table header Módulo | Horas');
    a.that(mentionsNumber(text, 120), 'table shows the total 120');
    a.that(/\[!WARNING\]/.test(text), 'assumptions in a warning callout');
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      format: 'markdown',
      title: 'Proposta Portal de Fornecedores',
      content: [
        '## Escopo',
        '',
        'O portal centraliza o cadastro de fornecedores.',
        '',
        '## Premissas',
        '',
        '> [!WARNING]',
        '> O cliente disponibiliza acesso ao ambiente de testes do ERP.',
        '',
        '## Investimento',
        '',
        '| Módulo | Horas |',
        '| --- | --- |',
        '| Login | 40 |',
        '| Relatórios | 80 |',
        '',
        'Total: 120 horas.',
        '',
      ].join('\n'),
    });
  },
};

const markdownEditSection: EvalTask = {
  id: 'markdown-edit-section',
  title: 'Change one paragraph and keep the rest of the document',
  category: 'edit',
  formats: ['markdown'],
  async setup(ctx) {
    const created = await ctx.service.create(ctx.userScope, {
      format: 'markdown',
      title: 'Cronograma',
      content: '# Cronograma\n\nEntrega em 16 semanas.\n\n# Riscos\n\nAtraso na homologação.\n',
    });
    return { id: created.artifact.id };
  },
  prompt: 'In the artifact {{id}}, change the delivery time from 16 weeks to 12 weeks. Change nothing else.',
  async check(ctx) {
    const a = new Assertions();
    const artifact = await ctx.service.get(ctx.userScope, ctx.vars.id!);
    const text = String(artifact.content);
    a.that(text.includes('12 semanas'), 'delivery now says 12 semanas');
    a.that(!text.includes('16 semanas'), 'the old value is gone');
    a.that(text.includes('Atraso na homologação.'), 'the risks section is untouched');
    a.that(!usedReplaceContent(ctx), 'the edit used operations, not replace_content');
    return a.result();
  },
  async reference(tools, ctx) {
    await tools.call('artifact_apply', {
      id: ctx.vars.id,
      baseVersion: 1,
      operations: [{ op: 'replace_text', section: 'cronograma', find: '16 semanas', replace: '12 semanas' }],
    });
  },
};

// ---------------------------------------------------------------------------------------- sheet

const sheetCreateEstimate: EvalTask = {
  id: 'sheet-create-estimate',
  title: 'Create an estimate with a formula total and currency format',
  category: 'create',
  formats: ['univer-sheet'],
  prompt: [
    'Create a spreadsheet titled "Estimativa" with a sheet "Estimativa".',
    'Columns: Perfil, Horas, Valor hora, Total. Row 2: Tech Lead, 120, 165, and the Total as a formula of hours times hourly value.',
    'Format the Total as currency.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const sheet = content<SheetContent>(await only(ctx, 'univer-sheet', a));
    const cells = sheet ? sheetCells(sheet) : [];
    a.that(
      cells.some((cell) => cell.f && /B2\s*\*\s*C2/i.test(cell.f)),
      'the total is a formula over B2 and C2',
    );
    a.that(
      cells.some((cell) => cell.v === 'Tech Lead'),
      'the profile row exists',
    );
    a.that(
      cells.some((cell) => cell.v === 165),
      'the hourly value 165 is a number',
    );
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      format: 'univer-sheet',
      title: 'Estimativa',
      operations: [
        { op: 'add_sheet', name: 'Estimativa' },
        {
          op: 'set_values',
          sheet: 'Estimativa',
          at: 'A1',
          values: [['Perfil', 'Horas', 'Valor hora', 'Total']],
        },
        { op: 'set_values', sheet: 'Estimativa', at: 'A2', values: [['Tech Lead', 120, 165, '=B2*C2']] },
        { op: 'set_format', sheet: 'Estimativa', range: 'D2', format: 'currency' },
      ],
    });
  },
};

// ---------------------------------------------------------------------------------------- openui

const openuiCreateDeck: EvalTask = {
  id: 'openui-create-deck',
  title: 'Create a three-slide deck with a title, bullets and speaker notes',
  category: 'create',
  formats: ['openui'],
  prompt: [
    'Create a presentation titled "Portal de Fornecedores".',
    'Slide 1: title slide with the title "Portal de Fornecedores" and subtitle "Grupo Meridiano".',
    'Slide 2: "Escopo" with bullets: Cadastro e homologação, Integração Protheus, Relatórios.',
    'Slide 3: "Cronograma" with the speaker note "Confirmar datas com o cliente".',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const text = String(content<string>(await only(ctx, 'openui', a)) ?? '');
    a.that(/root = Deck\(/.test(text), 'the root is a Deck');
    a.that((text.match(/= Slide\(/g) ?? []).length >= 3, 'three slides');
    a.that(/Bullets\(\[[^\]]*Cadastro/.test(text), 'bullets on the scope slide');
    a.that(/Notes\("Confirmar datas/.test(text), 'speaker notes on the timeline slide');
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      format: 'openui',
      title: 'Portal de Fornecedores',
      operations: [
        { op: 'set_statement', name: 'root', expr: 'Deck([capa, escopo, cronograma])' },
        {
          op: 'set_statement',
          name: 'capa',
          expr: 'Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])',
        },
        {
          op: 'set_statement',
          name: 'escopo',
          expr: 'Slide("title-content", [Title("Escopo"), Bullets(["Cadastro e homologação", "Integração Protheus", "Relatórios"])])',
        },
        {
          op: 'set_statement',
          name: 'cronograma',
          expr: 'Slide("title-content", [Title("Cronograma"), Notes("Confirmar datas com o cliente")])',
        },
      ],
    });
  },
};

const openuiEditDeck: EvalTask = {
  id: 'openui-edit-deck',
  title: 'Move a slide and rename a title without rewriting the deck',
  category: 'restructure',
  formats: ['openui'],
  async setup(ctx) {
    const created = await ctx.service.create(ctx.userScope, {
      format: 'openui',
      title: 'Deck',
      content:
        'root = Deck([capa, escopo])\ncapa = Slide("title", [Title("Portal"), Subtitle("Grupo")])\nescopo = Slide("title-content", [Title("Escopo"), Bullets(["Cadastro"])])\n',
    });
    return { id: created.artifact.id };
  },
  prompt:
    'In the artifact {{id}}, put the scope slide before the title slide and change the scope title to "Escopo do projeto".',
  async check(ctx) {
    const a = new Assertions();
    const artifact = await ctx.service.get(ctx.userScope, ctx.vars.id!);
    const text = String(artifact.content);
    a.that(/root = Deck\(\[escopo, capa\]\)/.test(text), 'the scope slide comes first');
    a.that(/Title\("Escopo do projeto"\)/.test(text), 'the scope title changed');
    a.that(/Bullets\(\["Cadastro"\]\)/.test(text), 'the bullets are untouched');
    return a.result();
  },
  async reference(tools, ctx) {
    await tools.call('artifact_apply', {
      id: ctx.vars.id,
      baseVersion: 1,
      operations: [
        { op: 'move_child', name: 'root', child: 'escopo', position: 0 },
        {
          op: 'set_statement',
          name: 'escopo',
          expr: 'Slide("title-content", [Title("Escopo do projeto"), Bullets(["Cadastro"])])',
        },
      ],
    });
  },
};

// ---------------------------------------------------------------------------------------- cross

const crossEstimateAndDeck: EvalTask = {
  id: 'cross-estimate-and-deck',
  title: 'Estimate in a sheet and summarize the total in a deck',
  category: 'cross',
  formats: ['univer-sheet', 'openui'],
  prompt: [
    'Create a spreadsheet "Estimativa" with Tech Lead, 120 hours at 165 per hour and the total as a formula.',
    'Then create a one-slide deck titled "Investimento" whose bullet says the total is 19.800 reais.',
  ].join('\n'),
  async check(ctx) {
    const a = new Assertions();
    const sheet = content<SheetContent>(await only(ctx, 'univer-sheet', a));
    const deck = String(content<string>(await only(ctx, 'openui', a)) ?? '');
    a.that(
      sheet ? sheetCells(sheet).some((cell) => cell.f && /B2\s*\*\s*C2/i.test(cell.f)) : false,
      'the sheet total is a formula',
    );
    a.that(
      mentionsNumber(allText([deck]), 19800) || /19\.?800/.test(deck),
      'the deck states the total 19.800',
    );
    return a.result();
  },
  async reference(tools) {
    await tools.call('artifact_create', {
      format: 'univer-sheet',
      title: 'Estimativa',
      operations: [
        { op: 'add_sheet', name: 'Estimativa' },
        { op: 'set_values', sheet: 'Estimativa', at: 'A2', values: [['Tech Lead', 120, 165, '=B2*C2']] },
      ],
    });
    await tools.call('artifact_create', {
      format: 'openui',
      title: 'Investimento',
      operations: [
        { op: 'set_statement', name: 'root', expr: 'Deck([total])' },
        {
          op: 'set_statement',
          name: 'total',
          expr: 'Slide("title-content", [Title("Investimento"), Bullets(["Total: 19.800 reais"])])',
        },
      ],
    });
  },
};

/** Built-in tasks: every category of spec §23.2 across the three native formats. */
export const defaultTasks: EvalTask[] = [
  markdownCreateProposal,
  markdownEditSection,
  sheetCreateEstimate,
  openuiCreateDeck,
  openuiEditDeck,
  crossEstimateAndDeck,
];

export type { TaskContext, ToolCaller };
