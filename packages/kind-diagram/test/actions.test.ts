import { describe, expect, it } from 'vitest';
import {
  alignOperations,
  autoArrangeOperations,
  copySelection,
  distributeOperations,
  duplicateOperations,
  edgeStyleOperations,
  pasteOperations,
  reverseEdgeOperations,
} from '../src/edit/index.js';
import { type DiagramContent, diagramKind, layoutDiagram } from '../src/index.js';
import { layered } from './fixtures.js';

const apply = (content: DiagramContent, ops: Parameters<typeof diagramKind.apply>[1]) =>
  diagramKind.apply(content, ops, { locale: 'en' } as never) as unknown as { content: DiagramContent };

describe('diagram editor actions', () => {
  const layout = layoutDiagram(layered);

  it('duplicates nodes with fresh ids and the edges between them', () => {
    const result = duplicateOperations(layered, layout, ['api', 'auth']);
    expect(result.select).toEqual(['n1', 'n2']);
    expect(result.operations).toEqual([
      { op: 'add_node', id: 'n1', label: 'API', shape: 'round', tone: 'accent', group: 'servicos' },
      { op: 'add_node', id: 'n2', label: 'Auth', shape: 'box', group: 'servicos' },
      { op: 'add_edge', id: 'e7', from: 'n1', to: 'n2', style: 'dashed', arrow: 'end' },
    ]);
  });

  it('pastes with offset positions in manual layout and drops missing groups', () => {
    const clipboard = copySelection(layered, layout, ['web'])!;
    const manual: DiagramContent = { ...layered, layout: 'manual', groups: [] };
    const { operations } = pasteOperations(
      { ...manual, nodes: manual.nodes.map(({ group: _g, ...node }) => node) },
      clipboard,
    );
    const placed = layout.nodes.find((node) => node.id === 'web')!;
    expect(operations[0]).toMatchObject({
      op: 'add_node',
      label: 'Portal web',
      position: { x: Math.round(placed.x) + 32, y: Math.round(placed.y) + 32 },
    });
    expect(operations[0]).not.toHaveProperty('group');
  });

  it('aligns and distributes by pinning positions', () => {
    const left = alignOperations(layout, ['web', 'api', 'pg'], 'left');
    const minX = Math.min(...layout.nodes.filter((n) => ['web', 'api', 'pg'].includes(n.id)).map((n) => n.x));
    for (const op of left) expect(op).toMatchObject({ op: 'pin_node', position: { x: Math.round(minX) } });
    expect(alignOperations(layout, ['web'], 'left')).toEqual([]);
    expect(distributeOperations(layout, ['web', 'app'], 'horizontal')).toEqual([]);
    const spread = distributeOperations(layout, ['web', 'api', 'pg'], 'vertical');
    expect(spread.every((op) => op.op === 'pin_node')).toBe(true);
  });

  it('auto-arranges by unpinning and leaving manual layout', () => {
    const pinned: DiagramContent = {
      ...layered,
      layout: 'manual',
      nodes: layered.nodes.map((node) => (node.id === 'api' ? { ...node, position: { x: 1, y: 2 } } : node)),
    };
    expect(autoArrangeOperations(pinned)).toEqual([
      { op: 'unpin_node', id: 'api' },
      { op: 'set_layout', layout: 'auto' },
    ]);
    expect(autoArrangeOperations(layered)).toEqual([]);
  });

  it('styles and reverses edges, skipping unchanged ones', () => {
    expect(edgeStyleOperations(layered, ['e1', 'e3'], { style: 'dashed' })).toEqual([
      { op: 'update_edge', id: 'e1', style: 'dashed' },
    ]);
    expect(reverseEdgeOperations(layered, ['e1'])).toEqual([
      { op: 'update_edge', id: 'e1', from: 'api', to: 'web' },
    ]);
  });

  it('produces operations the kind accepts', () => {
    const { operations } = duplicateOperations(layered, layout, ['web', 'app', 'api']);
    expect(() => apply(layered, operations)).not.toThrow();
  });
});
