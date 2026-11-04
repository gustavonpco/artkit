import { ArtifactError, IdAllocator, ITEM_ID_PATTERN } from '@artkit-ai/core';
import {
  type DiagramContent,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type Direction,
  EDGE_LABEL_MAX,
  type EdgeArrow,
  type EdgeStyle,
  GROUP_LABEL_MAX,
  NODE_LABEL_MAX,
  type NodeShape,
} from './schema.js';
import { msg } from './text.js';

export interface MermaidParseOptions {
  locale?: string;
}

export interface MermaidParseResult {
  content: DiagramContent;
  /** Things that were accepted but dropped or approximated (styles, unsupported shapes, nested subgraphs). */
  notes: string[];
}

/** Syntax error with the 1-based source line and a hint the model can follow. */
export class MermaidSyntaxError extends Error {
  readonly line: number;
  readonly hint: string;

  constructor(line: number, message: string, hint: string) {
    super(message);
    this.name = 'MermaidSyntaxError';
    this.line = line;
    this.hint = hint;
  }
}

interface RawNode {
  id: string;
  label: string;
  shape: NodeShape;
  explicit: boolean;
  line: number;
  group?: string;
}

interface RawGroup {
  id: string;
  label: string;
  line: number;
  parent?: string;
}

interface RawEdge {
  from: string;
  to: string;
  label?: string;
  style: EdgeStyle;
  arrow: EdgeArrow;
  line: number;
}

interface Link {
  invisible: boolean;
  label?: string;
  style: EdgeStyle;
  arrow: EdgeArrow;
}

/** Shape openers, longest first, with their closers and the shape they map to. */
const SHAPES: { open: string; close: string[]; shape: NodeShape; note?: string }[] = [
  { open: '(((', close: [')))'], shape: 'ellipse', note: 'double circle' },
  { open: '((', close: ['))'], shape: 'ellipse' },
  { open: '([', close: ['])'], shape: 'round' },
  { open: '(', close: [')'], shape: 'round' },
  { open: '[(', close: [')]'], shape: 'cylinder' },
  { open: '[[', close: [']]'], shape: 'box', note: 'subroutine' },
  { open: '[/', close: ['/]', '\\]'], shape: 'box', note: 'parallelogram/trapezoid' },
  { open: '[\\', close: ['\\]', '/]'], shape: 'box', note: 'parallelogram/trapezoid' },
  { open: '[', close: [']'], shape: 'box' },
  { open: '{{', close: ['}}'], shape: 'box', note: 'hexagon' },
  { open: '{', close: ['}'], shape: 'diamond' },
  { open: '>', close: [']'], shape: 'box', note: 'asymmetric' },
];

const IGNORED = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|title)\b/;
const OTHER_DIAGRAMS =
  /^(sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|C4Context|sankey|xychart|block|architecture|kanban|packet|requirementDiagram)\b/;

/**
 * Small parser for the Mermaid `flowchart`/`graph` subset (spec §11.4). Pure; throws `MermaidSyntaxError`
 * with the line number for anything outside the subset.
 */
export function parseMermaid(source: string, options: MermaidParseOptions = {}): MermaidParseResult {
  const locale = options.locale;
  const t = (en: string, pt: string) => msg(locale, en, pt);
  const notes: string[] = [];
  const fail = (line: number, en: string, pt: string, hintEn: string, hintPt: string): never => {
    throw new MermaidSyntaxError(line, t(`Line ${line}: ${en}`, `Linha ${line}: ${pt}`), t(hintEn, hintPt));
  };

  const statements = splitStatements(source, notes, t);
  if (statements.length === 0) {
    fail(
      1,
      'the diagram is empty.',
      'o diagrama está vazio.',
      'Start with "flowchart TD" followed by nodes and edges.',
      'Comece com "flowchart TD" seguido de nós e arestas.',
    );
  }
  const header = statements[0]!;
  const headerMatch = /^(flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?$/i.exec(header.text);
  if (!headerMatch) {
    if (OTHER_DIAGRAMS.test(header.text)) {
      fail(
        header.line,
        `only flowchart diagrams are supported, found "${header.text.split(/\s/)[0]}".`,
        `apenas fluxogramas são suportados, encontrado "${header.text.split(/\s/)[0]}".`,
        'Rewrite it as "flowchart TD" with nodes and edges, or use another artifact kind.',
        'Reescreva como "flowchart TD" com nós e arestas, ou use outro tipo de artefato.',
      );
    }
    fail(
      header.line,
      'expected a header like "flowchart TD" or "graph LR".',
      'esperado um cabeçalho como "flowchart TD" ou "graph LR".',
      'The first line must be "flowchart" or "graph" followed by TD, TB, LR, RL or BT.',
      'A primeira linha deve ser "flowchart" ou "graph" seguido de TD, TB, LR, RL ou BT.',
    );
  }
  const direction = mapDirection(headerMatch![2], header.line, notes, t);

  const nodes = new Map<string, RawNode>();
  const groups: RawGroup[] = [];
  const groupIds = new Set<string>();
  const stack: string[] = [];
  const edges: RawEdge[] = [];
  let finalDirection: Direction = direction;

  const touchNode = (id: string, line: number, shape?: { shape: NodeShape; label: string }) => {
    let node = nodes.get(id);
    if (!node) {
      node = { id, label: id, shape: 'box', explicit: false, line };
      nodes.set(id, node);
    }
    if (shape) {
      node.label = shape.label || id;
      node.shape = shape.shape;
      node.explicit = true;
    }
    const current = stack[stack.length - 1];
    if (current !== undefined) {
      if (node.group === undefined) node.group = current;
      else if (node.group !== current) {
        notes.push(
          t(
            `Line ${line}: node "${id}" already belongs to subgraph "${node.group}"; kept there.`,
            `Linha ${line}: o nó "${id}" já pertence ao subgrafo "${node.group}"; mantido nele.`,
          ),
        );
      }
    }
  };

  for (const statement of statements.slice(1)) {
    const { text, line } = statement;
    if (/^subgraph\b/.test(text)) {
      const group = parseSubgraph(text.slice('subgraph'.length).trim(), line, groupIds, fail);
      if (stack.length > 0) {
        group.parent = stack[stack.length - 1]!;
        notes.push(
          t(
            `Line ${line}: nested subgraph "${group.id}" flattened into a separate group.`,
            `Linha ${line}: subgrafo aninhado "${group.id}" achatado em um grupo separado.`,
          ),
        );
      }
      groups.push(group);
      groupIds.add(group.id);
      stack.push(group.id);
      continue;
    }
    if (text === 'end') {
      if (stack.length === 0) {
        fail(
          line,
          '"end" without an open subgraph.',
          '"end" sem subgrafo aberto.',
          'Remove the extra "end" or add the matching "subgraph".',
          'Remova o "end" extra ou adicione o "subgraph" correspondente.',
        );
      }
      stack.pop();
      continue;
    }
    const dirMatch = /^direction\s+(TB|TD|BT|RL|LR)$/i.exec(text);
    if (dirMatch) {
      if (stack.length > 0) {
        notes.push(
          t(
            `Line ${line}: subgraph direction ignored (one direction per diagram).`,
            `Linha ${line}: direção do subgrafo ignorada (uma direção por diagrama).`,
          ),
        );
      } else finalDirection = mapDirection(dirMatch[1], line, notes, t);
      continue;
    }
    const ignored = IGNORED.exec(text);
    if (ignored) {
      notes.push(
        t(
          `Line ${line}: "${ignored[1]}" ignored; colors and styles come from the theme and node tones.`,
          `Linha ${line}: "${ignored[1]}" ignorado; cores e estilos vêm do tema e dos tons dos nós.`,
        ),
      );
      continue;
    }
    parseChain(text, line, { touchNode, edges, notes, fail, t });
  }
  if (stack.length > 0) {
    const open = groups.find((group) => group.id === stack[stack.length - 1])!;
    fail(
      open.line,
      `subgraph "${open.id}" is not closed.`,
      `o subgrafo "${open.id}" não foi fechado.`,
      'Add "end" after its nodes.',
      'Adicione "end" depois dos nós dele.',
    );
  }

  for (const node of nodes.values()) {
    if (!groupIds.has(node.id)) continue;
    const line = edges.find((edge) => edge.from === node.id || edge.to === node.id)?.line ?? node.line;
    fail(
      line,
      `"${node.id}" is a subgraph; edges to or from subgraphs are not supported.`,
      `"${node.id}" é um subgrafo; arestas de ou para subgrafos não são suportadas.`,
      'Connect a node inside the subgraph instead, and keep node and subgraph ids distinct.',
      'Conecte um nó dentro do subgrafo e mantenha ids de nós e subgrafos distintos.',
    );
  }

  // Ids must follow the artifact id pattern; Mermaid is more permissive.
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const mapId = (raw: string) => {
    const known = idMap.get(raw);
    if (known) return known;
    let id = raw;
    if (!ITEM_ID_PATTERN.test(id)) {
      id =
        raw
          .replace(/[^A-Za-z0-9_-]/g, '-')
          .replace(/^[^A-Za-z0-9]+/, '')
          .slice(0, 60) || 'n';
      notes.push(t(`Id "${raw}" renamed to "${id}".`, `Id "${raw}" renomeado para "${id}".`));
    }
    let unique = id;
    for (let n = 2; used.has(unique); n++) unique = `${id.slice(0, 58)}-${n}`;
    used.add(unique);
    idMap.set(raw, unique);
    return unique;
  };
  for (const group of groups) mapId(group.id);
  for (const node of nodes.values()) mapId(node.id);

  const contentGroups: DiagramGroup[] = groups.map((group) => ({
    id: idMap.get(group.id)!,
    label: group.label,
    kind: 'box',
  }));
  const contentNodes: DiagramNode[] = [...nodes.values()].map((node) => ({
    id: idMap.get(node.id)!,
    label: node.label,
    shape: node.shape,
    ...(node.group !== undefined ? { group: idMap.get(node.group)! } : {}),
  }));
  const allocator = new IdAllocator(used);
  const contentEdges: DiagramEdge[] = edges.map((edge) => ({
    id: allocator.next('e'),
    from: idMap.get(edge.from)!,
    to: idMap.get(edge.to)!,
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    style: edge.style,
    arrow: edge.arrow,
  }));

  const ordered = bandOrder(groups, nodes, edges);
  let layout: DiagramContent['layout'] = 'auto';
  let finalGroups = contentGroups;
  if (ordered) {
    layout = 'bands';
    const byId = new Map(contentGroups.map((group) => [group.id, group]));
    finalGroups = ordered.map((raw) => ({ ...byId.get(idMap.get(raw)!)!, kind: 'band' as const }));
  }
  return {
    content: {
      direction: finalDirection,
      layout,
      nodes: contentNodes,
      edges: contentEdges,
      groups: finalGroups,
    },
    notes,
  };
}

/**
 * Subgraphs become bands when they read as layers: at least two subgraphs, none nested, and the edges between
 * them never loop back (the group graph is acyclic). Bands are then ordered along the flow (topological order,
 * ties by declaration). Otherwise subgraphs stay plain boxes.
 */
function bandOrder(groups: RawGroup[], nodes: Map<string, RawNode>, edges: RawEdge[]): string[] | undefined {
  if (groups.length < 2 || groups.some((group) => group.parent !== undefined)) return undefined;
  const ids = groups.map((group) => group.id);
  const succ = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    const a = nodes.get(edge.from)?.group;
    const b = nodes.get(edge.to)?.group;
    if (a === undefined || b === undefined || a === b || succ.get(a)!.has(b)) continue;
    succ.get(a)!.add(b);
    indegree.set(b, indegree.get(b)! + 1);
  }
  const order: string[] = [];
  const ready = ids.filter((id) => indegree.get(id) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const id = ready.shift()!;
    order.push(id);
    for (const next of succ.get(id)!) {
      const left = indegree.get(next)! - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return order.length === ids.length ? order : undefined;
}

type Translate = (en: string, pt: string) => string;
type Fail = (line: number, en: string, pt: string, hintEn: string, hintPt: string) => never;

function mapDirection(raw: string | undefined, line: number, notes: string[], t: Translate): Direction {
  const value = (raw ?? 'TB').toUpperCase();
  if (value === 'LR') return 'LR';
  if (value === 'RL') {
    notes.push(t(`Line ${line}: RL drawn as LR.`, `Linha ${line}: RL desenhado como LR.`));
    return 'LR';
  }
  if (value === 'BT') notes.push(t(`Line ${line}: BT drawn as TB.`, `Linha ${line}: BT desenhado como TB.`));
  return 'TB';
}

/** Splits the source into statements (lines and `;`), dropping comments, directives and front matter. */
function splitStatements(source: string, notes: string[], t: Translate): { text: string; line: number }[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: { text: string; line: number }[] = [];
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === '') index++;
  if (lines[index]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > index && line.trim() === '---');
    if (close > index) {
      notes.push(t('Front matter ignored.', 'Front matter ignorado.'));
      index = close + 1;
    }
  }
  for (; index < lines.length; index++) {
    const raw = lines[index]!;
    if (raw.trim().startsWith('%%')) continue;
    let quote = false;
    let depth = 0;
    let pipe = false;
    let current = '';
    const flush = () => {
      const text = current.trim();
      if (text) out.push({ text, line: index + 1 });
      current = '';
    };
    for (let i = 0; i < raw.length; i++) {
      const char = raw[i]!;
      if (char === '"') quote = !quote;
      else if (!quote) {
        if (char === '%' && raw[i + 1] === '%' && depth === 0 && !pipe) break;
        if ('[({'.includes(char)) depth++;
        else if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
        else if (char === '|' && depth === 0) pipe = !pipe;
        else if (char === ';' && depth === 0 && !pipe) {
          flush();
          continue;
        }
      }
      current += char;
    }
    flush();
  }
  return out;
}

function parseSubgraph(rest: string, line: number, existing: Set<string>, fail: Fail): RawGroup {
  if (!rest) {
    fail(
      line,
      'subgraph without a name.',
      'subgrafo sem nome.',
      'Write "subgraph id [Label]".',
      'Escreva "subgraph id [Rótulo]".',
    );
  }
  let id: string;
  let label: string;
  const bracket = /^([A-Za-z0-9_-]+)\s*\[\s*(.*?)\s*\]$/.exec(rest);
  if (bracket) {
    id = bracket[1]!;
    label = cleanLabel(bracket[2]!);
  } else if (/^"[^"]*"$/.test(rest)) {
    label = cleanLabel(rest);
    id = slug(label);
  } else if (/^[A-Za-z0-9_-]+$/.test(rest)) {
    id = rest;
    label = rest;
  } else {
    label = cleanLabel(rest);
    id = slug(label);
  }
  let unique = id;
  for (let n = 2; existing.has(unique); n++) unique = `${id}-${n}`;
  if (!label) label = unique;
  if (label.length > GROUP_LABEL_MAX) {
    fail(
      line,
      `subgraph label has ${label.length} characters (max ${GROUP_LABEL_MAX}).`,
      `o rótulo do subgrafo tem ${label.length} caracteres (máx. ${GROUP_LABEL_MAX}).`,
      'Shorten the label.',
      'Encurte o rótulo.',
    );
  }
  return { id: unique, label, line };
}

function slug(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'group';
}

/** Normalizes a Mermaid label: quotes, `<br>`, markdown backticks and the common `#quot;` entities. */
function cleanLabel(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1);
  if (text.startsWith('`') && text.endsWith('`') && text.length >= 2) text = text.slice(1, -1);
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, '&')
    .replace(/#lt;/g, '<')
    .replace(/#gt;/g, '>')
    .replace(/#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

interface ChainContext {
  touchNode(id: string, line: number, shape?: { shape: NodeShape; label: string }): void;
  edges: RawEdge[];
  notes: string[];
  fail: Fail;
  t: Translate;
}

class Scanner {
  pos = 0;
  constructor(readonly text: string) {}
  get eof(): boolean {
    return this.pos >= this.text.length;
  }
  ws(): void {
    while (!this.eof && /\s/.test(this.text[this.pos]!)) this.pos++;
  }
  rest(): string {
    return this.text.slice(this.pos);
  }
  startsWith(token: string): boolean {
    return this.text.startsWith(token, this.pos);
  }
}

function isIdChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function parseChain(text: string, line: number, ctx: ChainContext): void {
  const sc = new Scanner(text);
  const { fail } = ctx;
  let left = parseNodeGroup(sc, line, ctx);
  if (!left) {
    fail(
      line,
      `cannot parse "${text}".`,
      `não foi possível interpretar "${text}".`,
      'Supported: nodes like A[Label], A(Label), A{Decision}, A((Circle)), A[(Database)] and edges like A --> B, A -- text --> B, A -->|text| B, A -.-> B, A ==> B.',
      'Suportado: nós como A[Rótulo], A(Rótulo), A{Decisão}, A((Círculo)), A[(Banco)] e arestas como A --> B, A -- texto --> B, A -->|texto| B, A -.-> B, A ==> B.',
    );
  }
  for (;;) {
    sc.ws();
    if (sc.eof) break;
    const link = parseLink(sc, line, ctx);
    sc.ws();
    const right = parseNodeGroup(sc, line, ctx);
    if (!right) {
      fail(
        line,
        `link without a target node near "${sc.rest().slice(0, 20)}".`,
        `ligação sem nó de destino perto de "${sc.rest().slice(0, 20)}".`,
        'Every link needs a node on both sides, e.g. "A --> B".',
        'Toda ligação precisa de um nó em cada lado, por exemplo "A --> B".',
      );
    }
    if (link.invisible) {
      ctx.notes.push(
        ctx.t(
          `Line ${line}: invisible link (~~~) ignored.`,
          `Linha ${line}: ligação invisível (~~~) ignorada.`,
        ),
      );
    } else {
      for (const from of left!) {
        for (const to of right!) {
          ctx.edges.push({
            from,
            to,
            ...(link.label !== undefined ? { label: link.label } : {}),
            style: link.style,
            arrow: link.arrow,
            line,
          });
        }
      }
    }
    left = right;
  }
}

function parseNodeGroup(sc: Scanner, line: number, ctx: ChainContext): string[] | undefined {
  const first = parseNode(sc, line, ctx);
  if (!first) return undefined;
  const ids = [first];
  for (;;) {
    const save = sc.pos;
    sc.ws();
    if (!sc.startsWith('&')) {
      sc.pos = save;
      break;
    }
    sc.pos++;
    sc.ws();
    const next = parseNode(sc, line, ctx);
    if (!next) {
      ctx.fail(
        line,
        'expected a node after "&".',
        'esperado um nó depois de "&".',
        'Write "A --> B & C".',
        'Escreva "A --> B & C".',
      );
    }
    ids.push(next!);
  }
  return ids;
}

function readId(sc: Scanner): string {
  const start = sc.pos;
  while (!sc.eof) {
    const char = sc.text[sc.pos]!;
    if (isIdChar(char)) sc.pos++;
    else if (char === '-' && sc.pos > start && isIdChar(sc.text[sc.pos + 1])) sc.pos++;
    else break;
  }
  return sc.text.slice(start, sc.pos);
}

function parseNode(sc: Scanner, line: number, ctx: ChainContext): string | undefined {
  const { fail, t } = ctx;
  const id = readId(sc);
  if (!id) return undefined;
  if (id === 'end' || id === 'subgraph') {
    fail(
      line,
      `"${id}" is a reserved word and cannot be a node id.`,
      `"${id}" é palavra reservada e não pode ser id de nó.`,
      'Rename the node (e.g. "fim").',
      'Renomeie o nó (por exemplo "fim").',
    );
  }
  if (sc.startsWith('@{')) {
    fail(
      line,
      `the "${id}@{ ... }" shape syntax is not supported.`,
      `a sintaxe de forma "${id}@{ ... }" não é suportada.`,
      'Use the classic shapes: A[box], A(round), A{diamond}, A((ellipse)), A[(cylinder)].',
      'Use as formas clássicas: A[caixa], A(arredondado), A{losango}, A((elipse)), A[(cilindro)].',
    );
  }
  const spec = SHAPES.find((candidate) => sc.startsWith(candidate.open));
  if (!spec) {
    ctx.touchNode(id, line);
    skipClass(sc, line, ctx);
    return id;
  }
  sc.pos += spec.open.length;
  let label: string;
  const afterOpen = sc.pos;
  while (!sc.eof && sc.text[sc.pos] === ' ') sc.pos++;
  if (sc.text[sc.pos] === '"') {
    const close = sc.text.indexOf('"', sc.pos + 1);
    if (close < 0) {
      fail(
        line,
        `unclosed quote in the label of node "${id}".`,
        `aspas sem fechamento no rótulo do nó "${id}".`,
        'Close the quote: A["Label"].',
        'Feche as aspas: A["Rótulo"].',
      );
    }
    label = sc.text.slice(sc.pos + 1, close);
    sc.pos = close + 1;
    while (!sc.eof && sc.text[sc.pos] === ' ') sc.pos++;
    const closer = spec.close.find((candidate) => sc.startsWith(candidate));
    if (!closer) {
      fail(
        line,
        `missing "${spec.close[0]}" to close node "${id}".`,
        `falta "${spec.close[0]}" para fechar o nó "${id}".`,
        `Write ${id}${spec.open}"Label"${spec.close[0]}.`,
        `Escreva ${id}${spec.open}"Rótulo"${spec.close[0]}.`,
      );
    }
    sc.pos += closer!.length;
  } else {
    sc.pos = afterOpen;
    let best = -1;
    let bestCloser = '';
    for (const closer of spec.close) {
      const at = sc.text.indexOf(closer, sc.pos);
      if (at >= 0 && (best < 0 || at < best)) {
        best = at;
        bestCloser = closer;
      }
    }
    if (best < 0) {
      fail(
        line,
        `missing "${spec.close[0]}" to close the label of node "${id}".`,
        `falta "${spec.close[0]}" para fechar o rótulo do nó "${id}".`,
        `Write ${id}${spec.open}Label${spec.close[0]}; quote labels with brackets: ${id}${spec.open}"a [b]"${spec.close[0]}.`,
        `Escreva ${id}${spec.open}Rótulo${spec.close[0]}; use aspas em rótulos com colchetes: ${id}${spec.open}"a [b]"${spec.close[0]}.`,
      );
    }
    label = sc.text.slice(sc.pos, best);
    sc.pos = best + bestCloser.length;
  }
  const clean = cleanLabel(label);
  if (clean.length > NODE_LABEL_MAX) {
    fail(
      line,
      `the label of node "${id}" has ${clean.length} characters (max ${NODE_LABEL_MAX}).`,
      `o rótulo do nó "${id}" tem ${clean.length} caracteres (máx. ${NODE_LABEL_MAX}).`,
      'Shorten the label; put details in the surrounding document.',
      'Encurte o rótulo; coloque detalhes no documento ao redor.',
    );
  }
  if (spec.note) {
    ctx.notes.push(
      t(
        `Line ${line}: ${spec.note} shape of "${id}" drawn as ${spec.shape}.`,
        `Linha ${line}: forma ${spec.note} de "${id}" desenhada como ${spec.shape}.`,
      ),
    );
  }
  ctx.touchNode(id, line, { shape: spec.shape, label: clean });
  skipClass(sc, line, ctx);
  return id;
}

function skipClass(sc: Scanner, line: number, ctx: ChainContext): void {
  const match = /^:::[A-Za-z0-9_-]+/.exec(sc.rest());
  if (!match) return;
  sc.pos += match[0].length;
  ctx.notes.push(
    ctx.t(
      `Line ${line}: class "${match[0].slice(3)}" ignored.`,
      `Linha ${line}: classe "${match[0].slice(3)}" ignorada.`,
    ),
  );
}

const TEXT_CLOSERS: Record<string, RegExp> = {
  '--': /-{2,}>|-{3,}|--[ox](?=\s|$|[A-Za-z0-9_])/,
  '==': /={2,}>|={3,}/,
  '-.': /\.-+>|\.-+/,
};

function parseLink(sc: Scanner, line: number, ctx: ChainContext): Link {
  const { fail, t } = ctx;
  const rest = sc.rest();
  const invisible = /^~{3,}/.exec(rest);
  if (invisible) {
    sc.pos += invisible[0].length;
    return { invisible: true, style: 'solid', arrow: 'none' };
  }
  const unsupported = () =>
    fail(
      line,
      `unsupported link near "${rest.slice(0, 16)}".`,
      `ligação não suportada perto de "${rest.slice(0, 16)}".`,
      'Use -->, ---, -.->, -.-, ==>, <--> with optional |label| or "-- label -->".',
      'Use -->, ---, -.->, -.-, ==>, <--> com |rótulo| opcional ou "-- rótulo -->".',
    );
  const complete = /^(<)?(-{2,}|={2,}|-\.+-)(>|o(?=[\s|]|$)|x(?=[\s|]|$))?/.exec(rest);
  const core = complete?.[2] ?? '';
  const isComplete =
    complete !== null &&
    (complete[3] !== undefined || core.startsWith('-.') || (core.length >= 3 && !core.startsWith('-.')));
  let style: EdgeStyle;
  let head: string | undefined;
  let back = false;
  let label: string | undefined;
  if (isComplete) {
    back = complete![1] !== undefined;
    head = complete![3];
    style = core.includes('.') ? 'dashed' : 'solid';
    if (core.startsWith('='))
      ctx.notes.push(
        t(`Line ${line}: thick link drawn as solid.`, `Linha ${line}: ligação grossa desenhada como sólida.`),
      );
    sc.pos += complete![0].length;
    const save = sc.pos;
    sc.ws();
    if (sc.startsWith('|')) {
      // A quoted label may contain "|" itself.
      const quoted = /^\|\s*"[^"]*"\s*\|/.exec(sc.rest());
      const close = quoted ? sc.pos + quoted[0].length - 1 : sc.text.indexOf('|', sc.pos + 1);
      if (close < 0) {
        fail(
          line,
          'unclosed |label| on a link.',
          '|rótulo| sem fechamento em uma ligação.',
          'Write A -->|label| B.',
          'Escreva A -->|rótulo| B.',
        );
      }
      label = cleanLabel(sc.text.slice(sc.pos + 1, close));
      sc.pos = close + 1;
    } else sc.pos = save;
  } else {
    const opening = /^(<)?(--|==|-\.)/.exec(rest);
    if (!opening) unsupported();
    back = opening![1] !== undefined;
    const kind = opening![2]!;
    const body = rest.slice(opening![0].length);
    const closer = TEXT_CLOSERS[kind]!.exec(body);
    if (!closer) {
      fail(
        line,
        `link text is not closed near "${rest.slice(0, 20)}".`,
        `texto da ligação sem fechamento perto de "${rest.slice(0, 20)}".`,
        'Write A -- label --> B or A -->|label| B.',
        'Escreva A -- rótulo --> B ou A -->|rótulo| B.',
      );
    }
    label = cleanLabel(body.slice(0, closer!.index));
    const token = closer![0];
    head = token.endsWith('>') ? '>' : /[ox]$/.test(token) ? token.slice(-1) : undefined;
    style = kind === '-.' ? 'dashed' : 'solid';
    if (kind === '==')
      ctx.notes.push(
        t(`Line ${line}: thick link drawn as solid.`, `Linha ${line}: ligação grossa desenhada como sólida.`),
      );
    sc.pos += opening![0].length + closer!.index + token.length;
  }
  if (head === 'o' || head === 'x') {
    ctx.notes.push(
      t(
        `Line ${line}: "${head}" link end drawn as an arrow.`,
        `Linha ${line}: ponta "${head}" desenhada como seta.`,
      ),
    );
  }
  if (back && head === undefined) unsupported();
  const arrow: EdgeArrow = head === undefined ? 'none' : back ? 'both' : 'end';
  if (label !== undefined && label.length === 0) label = undefined;
  if (label !== undefined && label.length > EDGE_LABEL_MAX) {
    fail(
      line,
      `the link label has ${label.length} characters (max ${EDGE_LABEL_MAX}).`,
      `o rótulo da ligação tem ${label.length} caracteres (máx. ${EDGE_LABEL_MAX}).`,
      'Shorten the label to a few words.',
      'Encurte o rótulo para poucas palavras.',
    );
  }
  return { invisible: false, ...(label !== undefined ? { label } : {}), style, arrow };
}

/** `ContentInput.toContent` wrapper: syntax errors become INVALID_CONTENT with line, message and hint. */
export function mermaidToContent(
  source: string,
  locale: string | undefined,
  note?: (message: string) => void,
): DiagramContent {
  try {
    const parsed = parseMermaid(source, locale === undefined ? {} : { locale });
    for (const message of parsed.notes) note?.(message);
    return parsed.content;
  } catch (error) {
    if (error instanceof MermaidSyntaxError) {
      throw new ArtifactError(
        'INVALID_CONTENT',
        msg(locale, 'Invalid Mermaid flowchart.', 'Fluxograma Mermaid inválido.'),
        {
          issues: [{ path: 'input.source', message: error.message, hint: error.hint }],
          details: { line: error.line },
          cause: error,
        },
      );
    }
    throw error;
  }
}
