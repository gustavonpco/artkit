// @vitest-environment jsdom
import {
  applyOperations,
  createRegistry,
  defaultTheme,
  type EmitOptions,
  type RenderContext,
} from '@artkit-ai/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  connectionToOperation,
  DiagramEditor,
  deletionToOperations,
  diagramEditorCss,
  dragToOperations,
  groupSelectionOperations,
  labelEditOperation,
  toFlowEdges,
  toFlowNodes,
  ungroupOperations,
} from '../src/edit/index.js';
import { type DiagramContent, type DiagramOperation, diagramKind, layoutDiagram } from '../src/index.js';
import { flow, layered } from './fixtures.js';

const registry = createRegistry({ kinds: [diagramKind] });
const applies = (content: DiagramContent, operations: DiagramOperation[]) =>
  applyOperations(
    registry,
    { kind: 'diagram', content, title: 'T', themeId: 'default', locale: 'en' },
    operations,
  ).content as DiagramContent;

describe('conversions', () => {
  const layout = layoutDiagram(layered);

  it('maps content and layout to React Flow nodes and edges', () => {
    const nodes = toFlowNodes(layered, layout, new Set(['api']));
    expect(nodes).toHaveLength(6);
    const api = nodes.find((node) => node.id === 'api')!;
    const placed = layout.nodes.find((node) => node.id === 'api')!;
    expect(api).toMatchObject({
      type: 'diagramNode',
      position: { x: placed.x, y: placed.y },
      width: placed.width,
      height: placed.height,
      selected: true,
      ariaLabel: 'API',
    });
    expect(api.data.rect).toEqual({ x: placed.x, y: placed.y, width: placed.width, height: placed.height });
    const edges = toFlowEdges(layered, layout);
    expect(edges[0]).toMatchObject({
      id: 'e1',
      source: 'web',
      target: 'api',
      type: 'diagramEdge',
      ariaLabel: 'Portal web → API (HTTPS)',
    });
    expect(edges[0]!.data!.points).toEqual(layout.edges[0]!.points);
  });

  it('turns a connection into add_edge and ignores self connections', () => {
    expect(connectionToOperation({ source: 'web', target: 'pg' })).toEqual({
      op: 'add_edge',
      from: 'web',
      to: 'pg',
    });
    expect(connectionToOperation({ source: 'web', target: 'web' })).toBeUndefined();
    expect(connectionToOperation({ source: null, target: 'web' })).toBeUndefined();
  });

  it('turns a drag end into pin_node only for moved nodes', () => {
    const api = layout.nodes.find((node) => node.id === 'api')!;
    const web = layout.nodes.find((node) => node.id === 'web')!;
    const ops = dragToOperations(
      [
        { id: 'api', position: { x: api.x + 30.4, y: api.y - 10.6 } },
        { id: 'web', position: { x: web.x, y: web.y } },
        { id: 'ghost', position: { x: 0, y: 0 } },
      ],
      layout,
    );
    expect(ops).toEqual([
      { op: 'pin_node', id: 'api', position: { x: Math.round(api.x + 30.4), y: Math.round(api.y - 10.6) } },
    ]);
    const pinned = applies(layered, ops);
    expect(pinned.layout).toBe('manual');
    expect(layoutDiagram(pinned).nodes.find((node) => node.id === 'api')).toMatchObject({
      x: Math.round(api.x + 30.4),
      pinned: true,
    });
  });

  it('deletes nodes without removing their edges twice', () => {
    const ops = deletionToOperations(
      [{ id: 'api' }],
      [
        { id: 'e1', source: 'web', target: 'api' },
        { id: 'e6', source: 'web', target: 'pg' },
      ],
    );
    expect(ops).toEqual([
      { op: 'remove_node', id: 'api' },
      { op: 'remove_edge', id: 'e6' },
    ]);
    expect(applies(layered, ops).edges).toEqual([]);
  });

  it('groups and ungroups selections', () => {
    expect(groupSelectionOperations(flow, ['check', 'save', 'ghost'], 'Core')).toEqual([
      { op: 'add_group', label: 'Core', kind: 'box', nodes: ['check', 'save'] },
    ]);
    expect(groupSelectionOperations(layered, ['pg'], 'X')[0]).toMatchObject({ kind: 'band' });
    expect(groupSelectionOperations(flow, [], 'X')).toEqual([]);
    const grouped = applies(flow, groupSelectionOperations(flow, ['check', 'save'], 'Core'));
    expect(grouped.nodes.filter((node) => node.group === 'g1').map((node) => node.id)).toEqual([
      'check',
      'save',
    ]);
    expect(ungroupOperations(grouped, ['check', 'start'])).toEqual([
      { op: 'update_node', id: 'check', group: null },
    ]);
  });

  it('maps label edits', () => {
    expect(labelEditOperation('node', 'api', 'API', '  Gateway  ')).toEqual({
      op: 'update_node',
      id: 'api',
      label: 'Gateway',
    });
    expect(labelEditOperation('node', 'api', 'API', '   ')).toBeUndefined();
    expect(labelEditOperation('node', 'api', 'API', 'API')).toBeUndefined();
    expect(labelEditOperation('edge', 'e1', 'HTTPS', '')).toEqual({
      op: 'update_edge',
      id: 'e1',
      label: null,
    });
    expect(labelEditOperation('edge', 'e3', undefined, '')).toBeUndefined();
    expect(labelEditOperation('edge', 'e3', undefined, 'x'.repeat(50))).toEqual({
      op: 'update_edge',
      id: 'e3',
      label: 'x'.repeat(40),
    });
    expect(labelEditOperation('group', 'dados', 'Dados', 'Data')).toEqual({
      op: 'update_group',
      id: 'dados',
      label: 'Data',
    });
  });
});

describe('DiagramEditor (jsdom smoke)', () => {
  beforeAll(() => {
    // React Flow measures with ResizeObserver and reads transforms with DOMMatrixReadOnly; jsdom has neither.
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    class DOMMatrixMock {
      m22: number;
      constructor(transform?: string) {
        const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
        this.m22 = scale ? Number(scale[1]) : 1;
      }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixMock);
  });
  afterEach(cleanup);

  const ctx: RenderContext = { theme: defaultTheme, locale: 'en', mode: 'screen' };

  function mount(content: DiagramContent = layered, readOnly = false) {
    const emitted: { ops: DiagramOperation[]; options: EmitOptions | undefined }[] = [];
    const emit = (ops: DiagramOperation[], options?: EmitOptions) => emitted.push({ ops, options });
    const lint = diagramKind.lint(content, { locale: 'en', theme: defaultTheme });
    const utils = render(
      <div style={{ width: 1000, height: 700 }}>
        <DiagramEditor content={content} ctx={ctx} emit={emit} readOnly={readOnly} lint={lint} />
      </div>,
    );
    return { ...utils, emitted };
  }

  it('renders nodes, groups and toolbar controls', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(6);
    expect(container.querySelectorAll('.ak-diagram-editor-node .ak-diagram-node')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Canais' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Diagram tools' })).toBeTruthy();
    expect(diagramEditorCss).toContain('.react-flow__node');
  });

  it('emits operations from the toolbar', () => {
    const { emitted } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'LR' } });
    fireEvent.change(screen.getByLabelText('Layout'), { target: { value: 'manual' } });
    expect(emitted.map((entry) => entry.ops)).toEqual([
      [{ op: 'add_node', label: 'New node' }],
      [{ op: 'set_direction', direction: 'LR' }],
      [{ op: 'set_layout', layout: 'manual' }],
    ]);
  });

  it('edits a selected group through the inspector and inline', () => {
    const { emitted } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Dados' }));
    const label = screen.getByLabelText('Label') as HTMLInputElement;
    expect(label.value).toBe('Dados');
    fireEvent.blur(label, { target: { value: 'Data' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'box' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove group (keep nodes)' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Canais' }));
    const inline = screen.getByLabelText('Group label') as HTMLInputElement;
    fireEvent.keyDown(inline, { key: 'Enter', target: { value: 'Channels' } });
    expect(emitted.map((entry) => entry.ops)).toEqual([
      [{ op: 'update_group', id: 'dados', label: 'Data' }],
      [{ op: 'update_group', id: 'dados', kind: 'box' }],
      [{ op: 'remove_group', id: 'dados' }],
      [{ op: 'update_group', id: 'canais', label: 'Channels' }],
    ]);
  });

  it('selects a node, edits it and groups it', () => {
    const { container, emitted } = mount();
    const api = container.querySelector('.react-flow__node[data-id="api"]') as HTMLElement;
    act(() => {
      fireEvent.click(api);
    });
    expect(screen.getByRole('region', { name: 'Node properties' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Shape'), { target: { value: 'diamond' } });
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    fireEvent.change(screen.getByLabelText('Icon'), { target: { value: 'server' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.doubleClick(container.querySelector('.ak-diagram-editor-node[data-id="api"]')!);
    fireEvent.keyDown(screen.getByLabelText('Node label'), { key: 'Enter', target: { value: 'Gateway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(emitted.map((entry) => entry.ops)).toEqual([
      [{ op: 'update_node', id: 'api', shape: 'diamond' }],
      [{ op: 'update_node', id: 'api', tone: null }],
      [{ op: 'update_node', id: 'api', icon: 'server' }],
      [{ op: 'update_node', id: 'api', group: null }],
      [{ op: 'update_node', id: 'api', group: null }],
      [{ op: 'add_group', label: 'Group', kind: 'band', nodes: ['api'] }],
      [{ op: 'update_node', id: 'api', label: 'Gateway' }],
      [{ op: 'remove_node', id: 'api' }],
    ]);
  });

  it('uses the standard toolbar for shapes, clipboard, alignment and edges', () => {
    const { container, emitted } = mount();
    expect(container.querySelector('.ak-diagram-editor-toolbar.ak-tb')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add shape' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Database' }));
    act(() => {
      fireEvent.click(container.querySelector('.react-flow__node[data-id="api"]') as HTMLElement);
    });
    const editor = screen.getByRole('group', { name: 'Diagram editor' });
    fireEvent.keyDown(editor, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'c', ctrlKey: true });
    expect((screen.getByRole('button', { name: 'Paste' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(emitted.map((entry) => entry.ops)).toEqual([
      [{ op: 'add_node', label: 'New node', shape: 'cylinder' }],
      [{ op: 'add_node', id: 'n1', label: 'API', shape: 'round', tone: 'accent', group: 'servicos' }],
      [{ op: 'add_node', id: 'n1', label: 'API', shape: 'round', tone: 'accent', group: 'servicos' }],
    ]);
    expect((screen.getByRole('button', { name: 'Align nodes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Minimap' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Minimap' }));
    expect(container.querySelector('.react-flow__minimap')).not.toBeNull();
  });

  it('marks lint issues and announces actions', () => {
    const content: DiagramContent = {
      ...flow,
      nodes: [...flow.nodes, { id: 'lonely', label: 'Lonely', shape: 'box' }],
    };
    const { container } = mount(content);
    expect(
      container.querySelector('.ak-diagram-editor-node[data-id="lonely"] .ak-diagram-editor-issue'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('Node added');
  });

  it('emits nothing in read-only mode', () => {
    const { emitted } = mount(layered, true);
    expect((screen.getByRole('button', { name: 'Add node' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    expect(emitted).toEqual([]);
  });
});
