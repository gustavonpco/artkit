import {
  type AdapterContext,
  type ApplyResult,
  type ChangeSummary,
  defineFormat,
  type FormatAdapter,
  type FormatInstructions,
  type LintIssue,
  type ReadRequest,
  type ReadResult,
  type ValidationResult,
} from '@artkit-ai/core';
import { uiComponents, uiLibrary, VISUAL_ROOTS } from '@artkit-ai/openui-components';
import { createParser } from '@openuidev/lang-core';
import { diffOpenUI } from './diff.js';
import { lintOpenUI } from './lint.js';
import { applyOpenUIOperation, type OpenUIOperation, openuiOperationSchema } from './operations.js';
import { readOpenUI } from './read.js';
import { componentOf, parseStatements, references, type Statement, serializeStatements } from './syntax.js';

export { diffOpenUI } from './diff.js';
export { lintOpenUI } from './lint.js';
export * from './operations.js';
export { readOpenUI } from './read.js';
export * from './syntax.js';

export const OPENUI_LIMITS = { declarations: 2000, slides: 100 };
export const OPENUI_FORMAT_VERSION = 'openui-lang@1.1.0';

export const OPENUI_INSTRUCTIONS: FormatInstructions = {
  summary:
    'OpenUI Lang for visuals: slide decks, dashboards, reports, prototypes and diagrams built from the artkit component library. One declaration per line; the first declaration is root = <Visual>(...).',
  rules: [
    'Start with root = Deck(...) for presentations, Dashboard, Report, Prototype or Diagram for the other visuals.',
    'Declare each component on its own line with a lowercase name, then reference it from a parent by that name.',
    'Use only components listed in the catalog with the positional arguments of their schema.',
    'Give every slide a Title first; keep Bullets to six items or fewer.',
    'Give every Image an alternative text as its second argument and an asset://<id> source.',
    'Edit visuals by declaration: set_statement, insert_child, move_child, rename_statement; never rewrite the whole text.',
  ],
  examples: [
    {
      title: 'Two-slide deck',
      operations: [
        { op: 'set_statement', name: 'root', expr: 'Deck([capa, escopo])' },
        {
          op: 'set_statement',
          name: 'capa',
          expr: 'Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])',
        },
        {
          op: 'set_statement',
          name: 'escopo',
          expr: 'Slide("title-content", [Title("Escopo em 13 módulos"), Bullets(["Cadastro e homologação", "Integração Protheus"])])',
        },
      ],
    },
  ],
};

const COMPONENT_NAMES = new Set(uiComponents.map((component) => component.name));

function cycles(statements: readonly Statement[]): string[] {
  const byName = new Map(statements.map((statement) => [statement.name, statement]));
  const state = new Map<string, 'visiting' | 'done'>();
  const found: string[] = [];
  const visit = (name: string) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      found.push(name);
      return;
    }
    state.set(name, 'visiting');
    for (const ref of references(byName.get(name)?.expr ?? '')) if (byName.has(ref)) visit(ref);
    state.set(name, 'done');
  };
  for (const statement of statements) visit(statement.name);
  return found;
}

/** Validates OpenUI text: syntax, root, component names, references, cycles and the parser of OpenUI itself. */
export function validateOpenUI(text: string): ValidationResult<string> {
  const { statements, invalidLines } = parseStatements(text);
  const issues: { path: string; message: string; hint?: string }[] = [];
  for (const line of invalidLines) {
    issues.push({
      path: `content.line${line}`,
      message: `A linha ${line} não é uma declaração.`,
      hint: 'Use o formato nome = Componente(argumentos), uma por linha.',
    });
  }
  const seen = new Set<string>();
  for (const statement of statements) {
    if (seen.has(statement.name)) {
      issues.push({
        path: `content.${statement.name}`,
        message: `A declaração "${statement.name}" está repetida.`,
        hint: 'Cada nome precisa ser único.',
      });
    }
    seen.add(statement.name);
    const component = componentOf(statement.expr);
    if (!component || !COMPONENT_NAMES.has(component)) {
      issues.push({
        path: `content.${statement.name}`,
        message: `"${component ?? statement.expr}" não é um componente da biblioteca.`,
        hint: `Use um destes: ${[...COMPONENT_NAMES].slice(0, 12).join(', ')}, …`,
      });
    }
  }
  const root = statements.find((statement) => statement.name === 'root');
  if (!root) {
    issues.push({
      path: 'content.root',
      message: 'Falta a declaração root.',
      hint: 'Comece com root = Deck(...) ou outro visual.',
    });
  } else if (!VISUAL_ROOTS.includes(componentOf(root.expr) as never)) {
    issues.push({
      path: 'content.root',
      message: `A raiz "${componentOf(root.expr)}" não é um visual.`,
      hint: `Use uma destas raízes: ${VISUAL_ROOTS.join(', ')}.`,
    });
  }
  for (const name of cycles(statements)) {
    issues.push({
      path: `content.${name}`,
      message: `A declaração "${name}" referencia a si mesma em um ciclo.`,
      hint: 'Remova a referência circular.',
    });
  }
  if (issues.length === 0 && root) {
    const result = createParser(uiLibrary.toJSONSchema(), uiLibrary.root).parse(
      serializeStatements(statements),
    );
    for (const error of result.meta.errors) {
      issues.push({
        path: `content.${error.statementId ?? 'root'}`,
        message: error.message,
        hint: 'Confira o componente e os argumentos no catálogo.',
      });
    }
    for (const name of result.meta.unresolved) {
      issues.push({
        path: `content.${name}`,
        message: `"${name}" é usada mas não foi declarada.`,
        hint: 'Declare a referência em uma linha própria.',
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, content: serializeStatements(statements) };
}

/** OpenUI format adapter (spec §12), validated against the artkit component library. */
export function createOpenUIFormat(): FormatAdapter<string, OpenUIOperation> {
  return defineFormat({
    format: 'openui',
    formatVersion: OPENUI_FORMAT_VERSION,
    readableVersions: [OPENUI_FORMAT_VERSION],
    label: 'Visual',
    empty: () => 'root = Deck([])\n',
    validate(content: unknown, _ctx: AdapterContext): ValidationResult<string> {
      if (typeof content !== 'string') {
        return {
          ok: false,
          issues: [
            {
              path: 'content',
              message: 'O visual deve ser texto OpenUI Lang.',
              hint: 'Envie as declarações como texto.',
            },
          ],
        };
      }
      return validateOpenUI(content);
    },
    operationSchema: openuiOperationSchema,
    async apply(
      content: string,
      operations: OpenUIOperation[],
      ctx: AdapterContext,
    ): Promise<ApplyResult<string>> {
      const state = { statements: parseStatements(content).statements, createdRefs: [] as string[] };
      for (const op of operations) applyOpenUIOperation(state, op, ctx);
      const text = serializeStatements(state.statements);
      const validation = validateOpenUI(text);
      if (!validation.ok)
        ctx.fail(validation.issues[0]?.message ?? 'Visual inválido.', { hint: validation.issues[0]?.hint });
      return {
        content: validation.content,
        createdRefs: state.createdRefs,
        warnings: lintOpenUI(validation.content),
      };
    },
    read(content: string, request: ReadRequest): ReadResult {
      return readOpenUI(content, request);
    },
    diff: (before: string, after: string): ChangeSummary[] => diffOpenUI(before, after),
    lint: (content: string): LintIssue[] => lintOpenUI(content),
    parsePartial(raw: string): string | undefined {
      if (raw.trim() === '') return undefined;
      // Keep only complete lines: the last line may still be streaming.
      const lines = raw.split('\n');
      const complete = raw.endsWith('\n') ? lines : lines.slice(0, -1);
      return `${complete.filter((line) => line.trim() !== '').join('\n')}\n`;
    },
    migrations: [],
    limits: OPENUI_LIMITS,
    measure: (content: string) => ({
      declarations: parseStatements(content).statements.length,
      slides: parseStatements(content).statements.filter(
        (statement) => componentOf(statement.expr) === 'Slide',
      ).length,
    }),
    instructions: OPENUI_INSTRUCTIONS,
  });
}

/** Default OpenUI format adapter with the artkit component library. */
export const openuiFormat = createOpenUIFormat();
