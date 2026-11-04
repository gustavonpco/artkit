import { cellKey, MAX_COLS, parseCellKey, type Rect, rectContains } from '../address.js';
import type { CellValue, SheetContent } from '../schema.js';
import { evaluateFormula } from './evaluator.js';
import {
  FUNCTION_ALTERNATIVES,
  FUNCTION_NAMES,
  FUNCTIONS,
  PROHIBITED_FUNCTIONS,
  similarFunctions,
} from './functions.js';
import { type Node, parseCached, walk } from './parser.js';
import type { EvalContext } from './runtime.js';
import { FormulaSyntaxError, refInBounds } from './tokenizer.js';
import { ERR } from './values.js';
import { cellIndex, cellScalar, refRect, type SheetIndex, WorkbookIndex } from './workbook.js';

/** A cell addressed by sheet id and A1 key. */
export interface CellRef {
  sheetId: string;
  address: string;
}

export interface CellValueUpdate extends CellRef {
  value: CellValue;
}

export type FormulaIssueCode =
  | 'SYNTAX'
  | 'UNKNOWN_FUNCTION'
  | 'PROHIBITED_FUNCTION'
  | 'ARGUMENT_COUNT'
  | 'UNKNOWN_SHEET'
  | 'UNKNOWN_NAME'
  | 'OUT_OF_BOUNDS'
  | 'CIRCULAR';

export interface FormulaIssue {
  code: FormulaIssueCode;
  message: string;
  hint?: string;
  /** Character span in the formula (without `=`), for editor highlighting. */
  start?: number;
  end?: number;
}

export interface SheetContext {
  content: SheetContent;
  /** Sheet where the formula lives; unprefixed references resolve here. */
  sheetId: string;
  /** Cell of the formula; enables the circular-reference check. */
  address?: string;
}

/**
 * Pluggable formula engine (spec §11.2). The same implementation runs on the server (authority) and in the
 * browser (editor preview), so both produce identical values.
 */
export interface FormulaEngine {
  validate(formula: string, ctx: SheetContext): FormulaIssue[];
  /** Recalculates the changed cells and every formula that depends on them, in dependency order. */
  recalculate(content: SheetContent, changed: CellRef[]): CellValueUpdate[];
}

export interface FormulaEngineOptions {
  /** Language of issue messages (`pt*` → Portuguese, anything else → English). */
  locale?: string;
}

// ---- Dependency graph ----

interface GraphNode {
  sheet: SheetIndex;
  row: number;
  col: number;
  formula: string;
  ast: Node | undefined;
  precedents: { sheet: SheetIndex; rect: Rect }[];
}

const SHEET_STRIDE = 2 ** 31;
const globalKey = (sheet: SheetIndex, row: number, col: number) =>
  sheet.position * SHEET_STRIDE + cellIndex(row, col);

function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Precedent ranges of a formula: direct references and defined names. */
function precedentsOf(ast: Node, wb: WorkbookIndex, sheet: SheetIndex): { sheet: SheetIndex; rect: Rect }[] {
  const out: { sheet: SheetIndex; rect: Rect }[] = [];
  walk(ast, (node) => {
    if (node.type === 'ref') {
      const target = node.ref.sheet === undefined ? sheet : wb.sheetByName(node.ref.sheet);
      if (target && refInBounds(node.ref)) out.push({ sheet: target, rect: refRect(node.ref) });
    } else if (node.type === 'name') {
      const defined = wb.definedName(node.name);
      if (!defined) return;
      try {
        const nameAst = parseCached(defined.ref).ast;
        if (nameAst.type !== 'ref' || !refInBounds(nameAst.ref)) return;
        const target = nameAst.ref.sheet === undefined ? sheet : wb.sheetByName(nameAst.ref.sheet);
        if (target) out.push({ sheet: target, rect: refRect(nameAst.ref) });
      } catch (error) {
        if (!(error instanceof FormulaSyntaxError)) throw error;
      }
    }
  });
  return out;
}

class DependencyGraph {
  readonly nodes: GraphNode[] = [];
  readonly #byKey = new Map<number, number>();
  /** Per sheet: sorted columns holding formulas and, per column, sorted rows. */
  readonly #columns = new Map<number, { cols: number[]; rows: Map<number, number[]> }>();
  readonly dependents: number[][];

  constructor(readonly wb: WorkbookIndex) {
    for (const sheet of wb.sheets) {
      for (const [index, cell] of sheet.cells) {
        if (cell.f === undefined) continue;
        const row = Math.floor(index / MAX_COLS);
        const col = index - row * MAX_COLS;
        let ast: Node | undefined;
        try {
          ast = parseCached(cell.f).ast;
        } catch (error) {
          if (!(error instanceof FormulaSyntaxError)) throw error;
        }
        const id = this.nodes.length;
        this.nodes.push({
          sheet,
          row,
          col,
          formula: cell.f,
          ast,
          precedents: ast ? precedentsOf(ast, wb, sheet) : [],
        });
        this.#byKey.set(globalKey(sheet, row, col), id);
        let entry = this.#columns.get(sheet.position);
        if (!entry) {
          entry = { cols: [], rows: new Map() };
          this.#columns.set(sheet.position, entry);
        }
        let rows = entry.rows.get(col);
        if (!rows) {
          rows = [];
          entry.rows.set(col, rows);
          entry.cols.push(col);
        }
        rows.push(row);
      }
    }
    for (const entry of this.#columns.values()) {
      entry.cols.sort((a, b) => a - b);
      for (const rows of entry.rows.values()) rows.sort((a, b) => a - b);
    }
    this.dependents = this.nodes.map(() => []);
    this.nodes.forEach((node, id) => {
      const seen = new Set<number>();
      for (const precedent of node.precedents) {
        for (const source of this.nodesIn(precedent.sheet, precedent.rect)) {
          if (seen.has(source)) continue;
          seen.add(source);
          this.dependents[source]!.push(id);
        }
      }
    });
  }

  nodeAt(sheet: SheetIndex, row: number, col: number): number | undefined {
    return this.#byKey.get(globalKey(sheet, row, col));
  }

  /** Formula nodes inside a rectangle. */
  nodesIn(sheet: SheetIndex, rect: Rect): number[] {
    const entry = this.#columns.get(sheet.position);
    if (!entry) return [];
    const out: number[] = [];
    for (
      let i = lowerBound(entry.cols, rect.left);
      i < entry.cols.length && entry.cols[i]! <= rect.right;
      i++
    ) {
      const col = entry.cols[i]!;
      const rows = entry.rows.get(col)!;
      for (let j = lowerBound(rows, rect.top); j < rows.length && rows[j]! <= rect.bottom; j++) {
        out.push(this.#byKey.get(globalKey(sheet, rows[j]!, col))!);
      }
    }
    return out;
  }

  /** Strongly connected components that form cycles (size > 1 or a self reference). Iterative Tarjan. */
  cycles(): number[][] {
    const index = new Array<number>(this.nodes.length).fill(-1);
    const low = new Array<number>(this.nodes.length).fill(0);
    const onStack = new Array<boolean>(this.nodes.length).fill(false);
    const stack: number[] = [];
    const result: number[][] = [];
    let counter = 0;
    for (let root = 0; root < this.nodes.length; root++) {
      if (index[root] !== -1) continue;
      const work: { node: number; edge: number }[] = [{ node: root, edge: 0 }];
      index[root] = low[root] = counter++;
      stack.push(root);
      onStack[root] = true;
      while (work.length > 0) {
        const frame = work[work.length - 1]!;
        const edges = this.dependents[frame.node]!;
        if (frame.edge < edges.length) {
          const next = edges[frame.edge++]!;
          if (index[next] === -1) {
            index[next] = low[next] = counter++;
            stack.push(next);
            onStack[next] = true;
            work.push({ node: next, edge: 0 });
          } else if (onStack[next]) low[frame.node] = Math.min(low[frame.node]!, index[next]!);
          continue;
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low[parent.node] = Math.min(low[parent.node]!, low[frame.node]!);
        if (low[frame.node] === index[frame.node]) {
          const component: number[] = [];
          let member: number;
          do {
            member = stack.pop()!;
            onStack[member] = false;
            component.push(member);
          } while (member !== frame.node);
          const selfLoop = component.length === 1 && this.dependents[frame.node]!.includes(frame.node);
          if (component.length > 1 || selfLoop) result.push(component.reverse());
        }
      }
    }
    return result;
  }
}

function makeContext(
  wb: WorkbookIndex,
  computed: Map<number, CellValue>,
): Omit<EvalContext, 'sheet' | 'row' | 'col'> {
  return {
    wb,
    read(sheet, row, col) {
      const fresh = computed.get(globalKey(sheet, row, col));
      if (fresh !== undefined) return cellScalar({ v: fresh });
      return cellScalar(sheet.cells.get(cellIndex(row, col)));
    },
  };
}

/** Recalculates a set of formula nodes (and their dependents) in topological order. */
function recalculateNodes(graph: DependencyGraph, seeds: Iterable<number>): CellValueUpdate[] {
  const affected = new Set<number>();
  const queue: number[] = [];
  for (const seed of seeds) {
    if (affected.has(seed)) continue;
    affected.add(seed);
    queue.push(seed);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const dependent of graph.dependents[queue[i]!]!) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      queue.push(dependent);
    }
  }
  const indegree = new Map<number, number>();
  for (const id of affected) indegree.set(id, 0);
  for (const id of affected)
    for (const dependent of graph.dependents[id]!)
      if (affected.has(dependent)) indegree.set(dependent, indegree.get(dependent)! + 1);
  const order: number[] = [];
  const ready = [...affected].filter((id) => indegree.get(id) === 0).sort((a, b) => a - b);
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]!;
    order.push(id);
    for (const dependent of graph.dependents[id]!) {
      if (!affected.has(dependent)) continue;
      const left = indegree.get(dependent)! - 1;
      indegree.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }
  const computed = new Map<number, CellValue>();
  const base = makeContext(graph.wb, computed);
  // Cells left out of the order are in (or behind) a circular reference; validation rejects them.
  const cyclic = [...affected].filter((id) => indegree.get(id)! > 0);
  for (const id of cyclic) {
    const node = graph.nodes[id]!;
    computed.set(globalKey(node.sheet, node.row, node.col), { error: ERR.REF.code });
  }
  for (const id of order) {
    const node = graph.nodes[id]!;
    const value = evaluateFormula(node.formula, { ...base, sheet: node.sheet, row: node.row, col: node.col });
    computed.set(globalKey(node.sheet, node.row, node.col), value);
  }
  return [...order, ...cyclic].map((id) => {
    const node = graph.nodes[id]!;
    return {
      sheetId: node.sheet.id,
      address: cellKey(node.row, node.col),
      value: computed.get(globalKey(node.sheet, node.row, node.col))!,
    };
  });
}

/** Recalculates every formula of the workbook. */
export function recalculateAll(content: SheetContent): CellValueUpdate[] {
  const graph = new DependencyGraph(new WorkbookIndex(content));
  return recalculateNodes(
    graph,
    graph.nodes.map((_, id) => id),
  );
}

/** Groups of cells that form circular references. */
export function findCircularReferences(content: SheetContent): CellRef[][] {
  const graph = new DependencyGraph(new WorkbookIndex(content));
  return graph.cycles().map((component) =>
    component.map((id) => {
      const node = graph.nodes[id]!;
      return { sheetId: node.sheet.id, address: cellKey(node.row, node.col) };
    }),
  );
}

/**
 * Evaluates a formula as if it were in `address` without changing the content (editor preview). The
 * result uses the cached values of other cells.
 */
export function previewFormula(
  content: SheetContent,
  sheetId: string,
  address: string,
  formula: string,
): CellValue {
  const wb = new WorkbookIndex(content);
  const sheet = wb.sheetById(sheetId) ?? wb.sheets[0]!;
  const pos = parseCellKey(address) ?? { row: 0, col: 0 };
  return evaluateFormula(formula, { ...makeContext(wb, new Map()), sheet, row: pos.row, col: pos.col });
}

// ---- Validation ----

const MESSAGES = {
  en: {
    syntax: (detail: string) => `Formula syntax error: ${detail}`,
    syntaxHint:
      'Write an Excel-style formula, e.g. SUM(B2:B9) or IF(A1>0,"yes","no"); separate arguments with commas.',
    unknownFunction: (name: string) => `Function ${name} is not supported.`,
    unknownFunctionHint: (similar: string, alternative?: string) =>
      `${alternative ? `Use ${alternative} instead. ` : ''}Similar supported functions: ${similar}.`,
    prohibited: (name: string) =>
      `Function ${name} is not allowed (external effects, macros or volatile references).`,
    prohibitedHint: 'Use literal values or references to cells in this workbook.',
    arity: (name: string, min: number, max: number, found: number) =>
      `${name} takes ${min === max ? min : `${min} to ${max === 255 ? 'many' : max}`} argument(s), got ${found}.`,
    arityHint: (signature: string) => `Signature: ${signature}.`,
    unknownSheet: (name: string) => `Sheet "${name}" does not exist.`,
    unknownSheetHint: (names: string) => `Existing sheets: ${names}. Quote names with spaces: 'My sheet'!A1.`,
    unknownName: (name: string) => `Name "${name}" is not defined.`,
    unknownNameHint: (names: string) =>
      names
        ? `Defined names: ${names}. Create one with set_name, or use a cell reference.`
        : 'Create it with set_name, or use a cell reference; text needs double quotes.',
    unknownNameFunctionHint: (name: string) => `Functions need parentheses: ${name}().`,
    outOfBounds: 'Reference outside the grid (max 100000 rows and 16384 columns).',
    outOfBoundsHint: 'Use rows 1–100000 and columns A–XFD.',
    circular: (address: string) => `Circular reference: ${address} depends on itself.`,
    circularHint: 'Remove the reference to the formula cell (or to a range that contains it).',
  },
  pt: {
    syntax: (detail: string) => `Erro de sintaxe na fórmula: ${detail}`,
    syntaxHint:
      'Escreva uma fórmula no estilo Excel, por exemplo SUM(B2:B9) ou IF(A1>0,"sim","não"); separe argumentos com vírgulas.',
    unknownFunction: (name: string) => `A função ${name} não é suportada.`,
    unknownFunctionHint: (similar: string, alternative?: string) =>
      `${alternative ? `Use ${alternative}. ` : ''}Funções suportadas parecidas: ${similar}.`,
    prohibited: (name: string) =>
      `A função ${name} não é permitida (efeitos externos, macros ou referências voláteis).`,
    prohibitedHint: 'Use valores literais ou referências a células desta pasta.',
    arity: (name: string, min: number, max: number, found: number) =>
      `${name} recebe ${min === max ? min : `${min} a ${max === 255 ? 'vários' : max}`} argumento(s), mas recebeu ${found}.`,
    arityHint: (signature: string) => `Assinatura: ${signature}.`,
    unknownSheet: (name: string) => `A aba "${name}" não existe.`,
    unknownSheetHint: (names: string) =>
      `Abas existentes: ${names}. Nomes com espaço vão entre apóstrofos: 'Minha aba'!A1.`,
    unknownName: (name: string) => `O nome "${name}" não está definido.`,
    unknownNameHint: (names: string) =>
      names
        ? `Nomes definidos: ${names}. Crie com set_name ou use uma referência de célula.`
        : 'Crie com set_name ou use uma referência de célula; texto vai entre aspas duplas.',
    unknownNameFunctionHint: (name: string) => `Funções precisam de parênteses: ${name}().`,
    outOfBounds: 'Referência fora da grade (máximo de 100000 linhas e 16384 colunas).',
    outOfBoundsHint: 'Use linhas de 1 a 100000 e colunas de A a XFD.',
    circular: (address: string) => `Referência circular: ${address} depende de si mesma.`,
    circularHint: 'Remova a referência à célula da fórmula (ou a um intervalo que a contém).',
  },
};

export type FormulaMessages = (typeof MESSAGES)['en'];

export function formulaMessages(locale: string | undefined): FormulaMessages {
  return locale?.toLowerCase().startsWith('pt') ? MESSAGES.pt : MESSAGES.en;
}

/** Static checks: syntax, supported functions and arity, existing sheets and names, grid bounds. */
export function validateFormula(formula: string, ctx: SheetContext, locale?: string): FormulaIssue[] {
  const m = formulaMessages(locale);
  let ast: Node;
  try {
    ast = parseCached(formula).ast;
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
    return [
      {
        code: 'SYNTAX',
        message: m.syntax(error.message),
        hint: m.syntaxHint,
        start: error.position,
        end: error.position + 1,
      },
    ];
  }
  const issues: FormulaIssue[] = [];
  const sheetNames = ctx.content.sheets.map((sheet) => sheet.name);
  const definedNames = (ctx.content.names ?? []).map((name) => name.name);
  walk(ast, (node) => {
    const span = { start: node.start, end: node.end };
    if (node.type === 'call') {
      const spec = FUNCTIONS.get(node.name);
      if (!spec) {
        if (PROHIBITED_FUNCTIONS.has(node.name)) {
          issues.push({
            code: 'PROHIBITED_FUNCTION',
            message: m.prohibited(node.name),
            hint: m.prohibitedHint,
            ...span,
          });
        } else {
          issues.push({
            code: 'UNKNOWN_FUNCTION',
            message: m.unknownFunction(node.name),
            hint: m.unknownFunctionHint(
              similarFunctions(node.name).join(', '),
              FUNCTION_ALTERNATIVES[node.name],
            ),
            ...span,
          });
        }
      } else if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        issues.push({
          code: 'ARGUMENT_COUNT',
          message: m.arity(spec.name, spec.minArgs, spec.maxArgs, node.args.length),
          hint: m.arityHint(spec.signature),
          ...span,
        });
      }
    } else if (node.type === 'ref') {
      if (
        node.ref.sheet !== undefined &&
        !sheetNames.some((name) => name.toUpperCase() === node.ref.sheet!.toUpperCase())
      ) {
        issues.push({
          code: 'UNKNOWN_SHEET',
          message: m.unknownSheet(node.ref.sheet),
          hint: m.unknownSheetHint(sheetNames.join(', ')),
          ...span,
        });
      } else if (!refInBounds(node.ref)) {
        issues.push({ code: 'OUT_OF_BOUNDS', message: m.outOfBounds, hint: m.outOfBoundsHint, ...span });
      }
    } else if (node.type === 'name') {
      if (!definedNames.some((name) => name.toUpperCase() === node.name)) {
        const hint = FUNCTION_NAMES.includes(node.name)
          ? m.unknownNameFunctionHint(node.name)
          : m.unknownNameHint(definedNames.join(', '));
        issues.push({ code: 'UNKNOWN_NAME', message: m.unknownName(node.name), hint, ...span });
      }
    }
  });
  if (issues.length === 0 && ctx.address) {
    const sheetIndex = ctx.content.sheets.findIndex((sheet) => sheet.id === ctx.sheetId);
    if (sheetIndex >= 0 && parseCellKey(ctx.address)) {
      const sheets = ctx.content.sheets.map((sheet, index) =>
        index === sheetIndex
          ? {
              ...sheet,
              cells: { ...sheet.cells, [ctx.address!]: { ...sheet.cells[ctx.address!], f: formula } },
            }
          : sheet,
      );
      const cycles = findCircularReferences({ ...ctx.content, sheets });
      if (
        cycles.some((group) =>
          group.some((ref) => ref.sheetId === ctx.sheetId && ref.address === ctx.address),
        )
      ) {
        issues.push({ code: 'CIRCULAR', message: m.circular(ctx.address), hint: m.circularHint });
      }
    }
  }
  return issues;
}

/** Builds the default engine. */
export function createFormulaEngine(options: FormulaEngineOptions = {}): FormulaEngine {
  return {
    validate: (formula, ctx) => validateFormula(formula, ctx, options.locale),
    recalculate(content, changed) {
      const wb = new WorkbookIndex(content);
      const graph = new DependencyGraph(wb);
      const seeds = new Set<number>();
      const plain: { sheet: SheetIndex; row: number; col: number }[] = [];
      for (const ref of changed) {
        const sheet = wb.sheetById(ref.sheetId);
        const pos = parseCellKey(ref.address);
        if (!sheet || !pos) continue;
        const node = graph.nodeAt(sheet, pos.row, pos.col);
        if (node !== undefined) seeds.add(node);
        else plain.push({ sheet, ...pos });
      }
      if (plain.length > 0) {
        graph.nodes.forEach((node, id) => {
          if (
            node.precedents.some((p) =>
              plain.some((cell) => cell.sheet === p.sheet && rectContains(p.rect, cell.row, cell.col)),
            )
          )
            seeds.add(id);
        });
      }
      return recalculateNodes(graph, seeds);
    },
  };
}

/** Default engine instance (English messages). */
export const defaultFormulaEngine: FormulaEngine = createFormulaEngine();
