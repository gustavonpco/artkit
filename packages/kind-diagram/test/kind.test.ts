import {
  ArtifactError,
  applyOperations,
  createRegistry,
  defaultTheme,
  prepareContent,
} from '@artkit-ai/core';
import { defineKindConformanceTests } from '@artkit-ai/core/testing';
import { describe, expect, it } from 'vitest';
import {
  type DiagramContent,
  diagramKind,
  diagramOperationTargets,
  parsePartialDiagram,
} from '../src/index.js';
import { flow, layered } from './fixtures.js';

defineKindConformanceTests(
  diagramKind,
  [
    {
      title: 'layered architecture',
      content: layered,
      batches: [
        [
          { op: 'add_node', id: 'cache', label: 'Redis', shape: 'cylinder', group: 'dados' },
          { op: 'add_edge', from: 'api', to: 'cache', label: 'cache' },
        ],
        [{ op: 'update_node', id: 'web', label: 'Portal', tone: 'info', icon: null }],
        [{ op: 'remove_node', id: 'auth' }],
        [{ op: 'pin_node', id: 'api', position: { x: 10, y: 20 } }],
        [{ op: 'remove_group', id: 'canais' }],
      ],
      rejects: [
        { operations: [{ op: 'remove_node', id: 'missing' }], code: 'OPERATION_FAILED' },
        { operations: [{ op: 'add_edge', from: 'web', to: 'nope' }], code: 'OPERATION_FAILED' },
        { operations: [{ op: 'add_node', id: 'web', label: 'Dup' }], code: 'OPERATION_FAILED' },
        { operations: [{ op: 'add_node', label: 'x'.repeat(61) }], code: 'INVALID_OPERATION' },
        { operations: [{ op: 'update_node', id: 'web', group: 'ghost' }], code: 'OPERATION_FAILED' },
        { operations: [{ op: 'set_direction', direction: 'RL' }], code: 'INVALID_OPERATION' },
      ],
    },
    { title: 'process flow', content: flow, batches: [[{ op: 'set_layout', layout: 'bands' }]] },
    {
      title: 'ids generated on creation',
      content: { nodes: [{ label: 'A' }, { label: 'B' }], edges: [{ from: 'n1', to: 'n2' }] },
    },
  ],
  { describe, it },
);

const registry = createRegistry({ kinds: [diagramKind] });

function apply(content: unknown, operations: unknown[], locale = 'en') {
  const base = prepareContent(registry, 'diagram', content).content;
  return applyOperations(
    registry,
    { kind: 'diagram', content: base, title: 'T', themeId: 'default', locale },
    operations,
  );
}

function rejection(content: unknown, operations: unknown[], locale = 'en'): ArtifactError {
  try {
    apply(content, operations, locale);
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('operations', () => {
  it('add_node fills defaults and generates ids', () => {
    const result = apply(layered, [{ op: 'add_node', label: 'Queue', icon: 'queue', group: 'servicos' }]);
    const content = result.content as DiagramContent;
    const added = content.nodes.at(-1)!;
    expect(added).toEqual({ id: 'n1', label: 'Queue', shape: 'box', icon: 'queue', group: 'servicos' });
    expect(result.createdIds).toEqual(['n1']);
  });

  it('add_node rejects unknown groups with a path', () => {
    const error = rejection(layered, [{ op: 'add_node', label: 'X', group: 'nope' }]);
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues[0]!.path).toBe('operations[0].group');
    expect(error.issues[0]!.hint).toContain('canais');
  });

  it('update_node clears optional fields with null', () => {
    const result = apply(layered, [
      { op: 'update_node', id: 'api', tone: null, group: null, shape: 'diamond' },
    ]);
    const api = (result.content as DiagramContent).nodes.find((node) => node.id === 'api')!;
    expect(api).toEqual({ id: 'api', label: 'API', shape: 'diamond' });
  });

  it('remove_node removes connected edges', () => {
    const content = apply(layered, [{ op: 'remove_node', id: 'api' }]).content as DiagramContent;
    expect(content.edges.map((edge) => edge.id)).toEqual(['e6']);
  });

  it('add_edge and update_edge', () => {
    const added = apply(layered, [{ op: 'add_edge', id: 'x1', from: 'auth', to: 'pg', arrow: 'none' }])
      .content as DiagramContent;
    expect(added.edges.at(-1)).toEqual({ id: 'x1', from: 'auth', to: 'pg', style: 'solid', arrow: 'none' });
    const updated = apply(layered, [
      { op: 'update_edge', id: 'e1', label: null, to: 'auth', style: 'dashed' },
    ]).content as DiagramContent;
    expect(updated.edges[0]).toEqual({ id: 'e1', from: 'web', to: 'auth', style: 'dashed', arrow: 'end' });
  });

  it('update_edge rejects missing endpoints', () => {
    const error = rejection(layered, [{ op: 'update_edge', id: 'e1', from: 'ghost' }]);
    expect(error.issues[0]!.path).toBe('operations[0].from');
  });

  it('remove_edge and missing edges', () => {
    const content = apply(layered, [{ op: 'remove_edge', id: 'e3' }]).content as DiagramContent;
    expect(content.edges.some((edge) => edge.id === 'e3')).toBe(false);
    expect(rejection(layered, [{ op: 'remove_edge', id: 'zz' }]).issues[0]!.path).toBe('operations[0].id');
  });

  it('add_group with members and position', () => {
    const content = apply(layered, [
      { op: 'add_group', id: 'edge', label: 'Edge', kind: 'band', nodes: ['web'], after: 'canais' },
    ]).content as DiagramContent;
    expect(content.groups.map((group) => group.id)).toEqual(['canais', 'edge', 'servicos', 'dados']);
    expect(content.nodes.find((node) => node.id === 'web')!.group).toBe('edge');
    const error = rejection(layered, [{ op: 'add_group', label: 'G', nodes: ['web', 'ghost'] }]);
    expect(error.issues[0]!.path).toBe('operations[0].nodes[1]');
  });

  it('update_group renames, changes kind and reorders', () => {
    const content = apply(layered, [
      { op: 'update_group', id: 'dados', label: 'Data', kind: 'box', after: null },
    ]).content as DiagramContent;
    expect(content.groups[0]).toEqual({ id: 'dados', label: 'Data', kind: 'box' });
    const moved = apply(layered, [{ op: 'update_group', id: 'canais', after: 'dados' }])
      .content as DiagramContent;
    expect(moved.groups.map((group) => group.id)).toEqual(['servicos', 'dados', 'canais']);
    expect(rejection(layered, [{ op: 'update_group', id: 'canais', after: 'canais' }]).issues[0]!.path).toBe(
      'operations[0].after',
    );
  });

  it('remove_group ungroups members', () => {
    const content = apply(layered, [{ op: 'remove_group', id: 'servicos' }]).content as DiagramContent;
    expect(content.groups.map((group) => group.id)).toEqual(['canais', 'dados']);
    expect(content.nodes.filter((node) => node.group === undefined).map((node) => node.id)).toEqual([
      'api',
      'auth',
    ]);
  });

  it('set_direction and set_layout', () => {
    const content = apply(layered, [
      { op: 'set_direction', direction: 'LR' },
      { op: 'set_layout', layout: 'auto' },
    ]).content as DiagramContent;
    expect([content.direction, content.layout]).toEqual(['LR', 'auto']);
  });

  it('pin_node switches to manual and unpin_node clears the position', () => {
    const pinned = apply(layered, [{ op: 'pin_node', id: 'pg', position: { x: 5, y: -3 } }]);
    const content = pinned.content as DiagramContent;
    expect(content.layout).toBe('manual');
    expect(content.nodes.find((node) => node.id === 'pg')!.position).toEqual({ x: 5, y: -3 });
    expect(pinned.diff.map((change) => change.target)).toEqual(['diagram:layout', 'node:pg']);
    const unpinned = apply(content, [{ op: 'unpin_node', id: 'pg' }]).content as DiagramContent;
    expect(unpinned.nodes.find((node) => node.id === 'pg')!.position).toBeUndefined();
    expect(unpinned.layout).toBe('manual');
  });

  it('rejects positions out of range', () => {
    expect(rejection(layered, [{ op: 'pin_node', id: 'pg', position: { x: 1e9, y: 0 } }]).code).toBe(
      'INVALID_OPERATION',
    );
  });

  it('localizes failures in Portuguese', () => {
    const error = rejection(layered, [{ op: 'remove_node', id: 'zz' }], 'pt-BR');
    expect(error.issues[0]!.message).toBe('O nó "zz" não existe.');
  });

  it('targets use the diff vocabulary', () => {
    expect(diagramOperationTargets({ op: 'add_edge', from: 'a', to: 'b' })).toEqual([
      'edge:+',
      'node:a',
      'node:b',
    ]);
    expect(diagramOperationTargets({ op: 'update_node', id: 'a', group: 'g' })).toEqual([
      'node:a',
      'group:g',
    ]);
    expect(diagramOperationTargets({ op: 'set_layout', layout: 'manual' })).toEqual(['diagram:layout']);
    expect(diagramOperationTargets({ op: 'add_group', label: 'G', nodes: ['a'] })).toEqual([
      'group:+',
      'node:a',
    ]);
  });
});

describe('validation', () => {
  it('reports dangling references and duplicate ids with paths', () => {
    let error: ArtifactError | undefined;
    try {
      prepareContent(registry, 'diagram', {
        groups: [{ id: 'g', label: 'G' }],
        nodes: [
          { id: 'a', label: 'A', group: 'nope' },
          { id: 'g', label: 'Dup' },
        ],
        edges: [{ id: 'e', from: 'a', to: 'b' }],
      });
    } catch (caught) {
      error = caught as ArtifactError;
    }
    expect(error?.code).toBe('INVALID_CONTENT');
    const paths = error!.issues.map((issue) => issue.path);
    expect(paths).toContain('content.nodes[0].group');
    expect(paths).toContain('content.nodes[1].id');
    expect(paths).toContain('content.edges[0].to');
  });

  it('enforces limits', () => {
    const nodes = Array.from({ length: 301 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
    expect(() => prepareContent(registry, 'diagram', { nodes })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
  });
});

describe('projection', () => {
  const prepared = prepareContent(registry, 'diagram', layered).content as DiagramContent;

  it('follows spec §9.3 in Portuguese', () => {
    const text = diagramKind.project(prepared, { mode: 'full', locale: 'pt-BR' }).text;
    expect(text).toContain('direção: TB');
    expect(text).toContain(
      'grupo canais "Canais" [band]: web(box, icon=web) "Portal web", app(round, icon=mobile) "App mobile"',
    );
    expect(text).toContain('grupo dados "Dados" [band]: pg(cylinder) "PostgreSQL"');
    expect(text).toContain('aresta e1: web -> api "HTTPS"');
    expect(text).toContain('aresta e5: api <-> files');
    expect(text).toContain('aresta e6: web -> pg "relatórios" (dashed)');
  });

  it('uses English keywords consistently', () => {
    const text = diagramKind.project(prepared, { mode: 'full', locale: 'en' }).text;
    expect(text).toContain('direction: TB');
    expect(text).toContain(
      'group servicos "Serviços" [band]: api(round, tone=accent) "API", auth(box) "Auth"',
    );
    expect(text).toContain('edge e3: api -> auth (dashed)');
    expect(text).not.toMatch(/aresta|grupo /);
  });

  it('outline lists counts, groups and node ids only', () => {
    const text = diagramKind.project(prepared, { mode: 'outline', locale: 'en' }).text;
    expect(text).toContain('6 nodes, 6 edges, 3 groups');
    expect(text).toContain('group canais "Canais" [band]: web, app');
    expect(text).not.toContain('edge e1');
  });

  it('range selects a subgraph with the edges touching it', () => {
    const text = diagramKind.project(prepared, { mode: 'range', range: 'dados', locale: 'en' }).text;
    expect(text).toContain('group dados');
    expect(text).not.toContain('group canais');
    expect(text).toContain('edge e4: api -> pg');
    expect(text).toContain('edge e6');
    expect(text).not.toContain('edge e1');
    expect(diagramKind.project(prepared, { mode: 'range', range: 'zzz', locale: 'en' }).text).toContain(
      'Groups: canais, servicos, dados',
    );
  });

  it('paginates on item boundaries with a cursor', () => {
    const first = diagramKind.project(prepared, { mode: 'full', locale: 'en', maxTokens: 40 });
    expect(first.truncated).toBe(true);
    expect(first.remainingOutline).toContain('edge');
    const next = diagramKind.project(prepared, {
      mode: 'full',
      locale: 'en',
      maxTokens: 400,
      cursor: first.cursor!,
    });
    expect(next.truncated).toBe(false);
    expect(next.text).toContain('e6');
  });

  it('shows ungrouped nodes and pins', () => {
    const content = prepareContent(registry, 'diagram', {
      layout: 'manual',
      nodes: [{ id: 'a', label: 'A', position: { x: 1, y: 2 } }],
    }).content as DiagramContent;
    expect(diagramKind.project(content, { mode: 'full', locale: 'pt-BR' }).text).toContain(
      'sem grupo: a(box, x=1, y=2) "A"',
    );
  });
});

describe('lint', () => {
  const lint = (content: unknown) =>
    diagramKind.lint(prepareContent(registry, 'diagram', content).content, {
      locale: 'en',
      theme: defaultTheme,
    });

  it('flags isolated nodes, duplicate edges, long labels and empty groups', () => {
    const issues = lint({
      groups: [{ id: 'g', label: 'Empty' }],
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'Should we approve this very long request now?', shape: 'diamond' },
        { id: 'c', label: 'Alone' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b', label: 'x' },
        { id: 'e2', from: 'a', to: 'b', label: 'x' },
        { id: 'e3', from: 'a', to: 'b', label: 'y' },
      ],
    });
    expect(issues.map((issue) => `${issue.code}:${issue.target}`)).toEqual([
      'isolated-node:node:c',
      'duplicate-edge:edge:e2',
      'label-too-long:node:b',
      'empty-group:group:g',
    ]);
  });

  it('notes pins ignored outside manual layout', () => {
    const issues = lint({ layout: 'auto', nodes: [{ id: 'a', label: 'A', position: { x: 0, y: 0 } }] });
    expect(issues).toEqual([expect.objectContaining({ code: 'pins-ignored', severity: 'info' })]);
  });
});

describe('diff', () => {
  it('summarizes changes per item', () => {
    const before = prepareContent(registry, 'diagram', layered).content as DiagramContent;
    const after = structuredClone(before);
    after.direction = 'LR';
    after.nodes[0]!.label = 'Portal';
    after.nodes[0]!.position = { x: 1, y: 2 };
    after.edges.pop();
    after.groups.push({ id: 'ext', label: 'External', kind: 'box' });
    const diff = diagramKind.diff(before, after);
    expect(diff).toEqual([
      { type: 'changed', target: 'diagram:direction', summary: "direction: 'TB' to 'LR'." },
      { type: 'added', target: 'group:ext', summary: `Added: ext "External" after 'dados'.` },
      { type: 'changed', target: 'node:web', summary: "web: label 'Portal web' to 'Portal'; pinned at 1,2." },
      { type: 'removed', target: 'edge:e6', summary: 'Removed: e6 (web -> pg).' },
    ]);
  });
});

describe('parsePartial', () => {
  it('keeps complete items and drops dangling ones', () => {
    const partial = parsePartialDiagram({
      direction: 'LR',
      groups: [{ id: 'g', label: 'G' }, { id: 'h' }],
      nodes: [{ id: 'a', label: 'A', group: 'h' }, { label: 'B' }, { id: 'c', lab: 'C' }],
      edges: [{ from: 'a', to: 'n1' }, { from: 'a', to: 'c' }, { id: 'e9' }],
    });
    expect(partial).toEqual({
      direction: 'LR',
      layout: 'auto',
      groups: [{ id: 'g', label: 'G', kind: 'box' }],
      nodes: [
        { id: 'a', label: 'A', shape: 'box' },
        { id: 'n1', label: 'B', shape: 'box' },
      ],
      edges: [{ id: 'e10', from: 'a', to: 'n1', style: 'solid', arrow: 'end' }],
    });
    expect(parsePartialDiagram('nope')).toBeUndefined();
    expect(parsePartialDiagram({})).toEqual({
      direction: 'TB',
      layout: 'auto',
      nodes: [],
      edges: [],
      groups: [],
    });
  });
});
