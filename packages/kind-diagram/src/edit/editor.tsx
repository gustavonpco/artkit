import { type EditorBindings, type EmitOptions, type LintIssue, themeCssVariables } from '@artkit/core';
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenu,
  type ToolbarMenuItem,
  ToolbarSelect,
  useOptionalArtkit,
} from '@artkit/react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  type EdgeChange,
  MarkerType,
  MiniMap,
  type NodeChange,
  type OnConnect,
  type OnDelete,
  type OnNodeDrag,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
} from '@xyflow/react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowRightLeft,
  Circle,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Cylinder,
  Diamond,
  FileText,
  Grid3x3,
  Group,
  type LucideIcon,
  Map as MapIcon,
  Maximize,
  MoveRight,
  Plus,
  RectangleHorizontal,
  Shapes,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Ungroup,
  User,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type DiagramLayout, type LayoutEngine, layoutDiagram } from '../layout/index.js';
import type { DiagramOperation } from '../operations.js';
import { buildDiagramScene } from '../scene.js';
import {
  type DiagramContent,
  type DiagramLayoutMode,
  type Direction,
  GROUP_LABEL_MAX,
  type NodeShape,
} from '../schema.js';
import { msg } from '../text.js';
import {
  alignOperations,
  autoArrangeOperations,
  copySelection,
  type DiagramClipboard,
  distributeOperations,
  duplicateOperations,
  edgeStyleOperations,
  type NodeAlign,
  pasteOperations,
  reverseEdgeOperations,
} from './actions.js';
import { DiagramEditorContext, type DiagramEditorContextValue, type EditingTarget } from './context.js';
import {
  connectionToOperation,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  deletionToOperations,
  dragToOperations,
  groupSelectionOperations,
  labelEditOperation,
  toFlowEdges,
  toFlowNodes,
  ungroupOperations,
} from './convert.js';
import { Inspector, type Selection } from './inspector.js';
import { edgeTypes, InlineLabelInput, nodeTypes } from './views.js';

export interface DiagramEditorProps extends EditorBindings<DiagramContent, DiagramOperation> {
  className?: string;
  /** Synchronous layout engine replacing the built-in ones. */
  engine?: LayoutEngine;
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const SHAPE_ICONS: Record<NodeShape, LucideIcon> = {
  box: Square,
  round: RectangleHorizontal,
  diamond: Diamond,
  ellipse: Circle,
  cylinder: Cylinder,
  document: FileText,
  actor: User,
};

const ALIGN_ICONS: Record<NodeAlign, LucideIcon> = {
  left: AlignStartVertical,
  center: AlignCenterVertical,
  right: AlignEndVertical,
  top: AlignStartHorizontal,
  middle: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
};

const isTyping = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Visual diagram editor on React Flow. Controlled: it renders `content` and turns every interaction into kind
 * operations through `emit` (never `replace_content`). A drag emits one `pin_node` per moved node at the end,
 * with `{ kind: 'continuous' }`.
 */
export function DiagramEditor(props: DiagramEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorCanvas {...props} />
    </ReactFlowProvider>
  );
}

function groupLint(lint: LintIssue[] | undefined): Map<string, LintIssue[]> {
  const map = new Map<string, LintIssue[]>();
  for (const issue of lint ?? []) map.set(issue.target, [...(map.get(issue.target) ?? []), issue]);
  return map;
}

function EditorCanvas({ content, ctx, emit, readOnly, lint, className, engine }: DiagramEditorProps) {
  const locale = ctx.locale;
  const hosted = useOptionalArtkit() !== null;
  const flow = useReactFlow<DiagramFlowNode, DiagramFlowEdge>();
  const [clipboard, setClipboard] = useState<DiagramClipboard | undefined>();
  const [minimap, setMinimap] = useState(false);
  const [snap, setSnap] = useState(false);
  const pendingSelect = useRef<string[] | undefined>(undefined);
  const t = useCallback((en: string, pt: string) => msg(locale, en, pt), [locale]);
  const layout: DiagramLayout = useMemo(
    () => layoutDiagram(content, engine ? { engine } : {}),
    [content, engine],
  );
  const scene = useMemo(() => buildDiagramScene(content, layout), [content, layout]);
  const lintMap = useMemo(() => groupLint(lint), [lint]);

  const [nodes, setNodes] = useState<DiagramFlowNode[]>(() => toFlowNodes(content, layout));
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>();
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dragging = useRef(false);
  const keyboardMoves = useRef(new Map<string, { x: number; y: number }>());

  // New content or layout: rebuild nodes, keeping the current selection.
  useEffect(() => {
    const pending = pendingSelect.current;
    pendingSelect.current = undefined;
    setNodes((current) =>
      toFlowNodes(
        content,
        layout,
        new Set(pending ?? current.filter((node) => node.selected).map((node) => node.id)),
      ),
    );
    keyboardMoves.current.clear();
  }, [content, layout]);

  const edges = useMemo(() => {
    const markerEnd = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--ak-color-muted)' };
    return toFlowEdges(content, layout, selectedEdges).map((edge) => ({
      ...edge,
      ...(edge.data!.edge.arrow !== 'none' ? { markerEnd } : {}),
      ...(edge.data!.edge.arrow === 'both'
        ? { markerStart: { ...markerEnd, orient: 'auto-start-reverse' } }
        : {}),
    }));
  }, [content, layout, selectedEdges]);

  const selection: Selection = {
    nodes: nodes.filter((node) => node.selected).map((node) => node.id),
    edges: [...selectedEdges].filter((id) => content.edges.some((edge) => edge.id === id)),
    ...(selectedGroup && content.groups.some((group) => group.id === selectedGroup)
      ? { group: selectedGroup }
      : {}),
  };

  const send = useCallback(
    (ops: DiagramOperation[], message: string, options?: EmitOptions) => {
      if (readOnly || ops.length === 0) return;
      emit(ops, options);
      setAnnouncement(message);
    },
    [emit, readOnly],
  );

  const onNodesChange = useCallback((changes: NodeChange<DiagramFlowNode>[]) => {
    // Removals become operations in onDelete; the content update removes the node afterwards.
    const kept = changes.filter((change) => change.type !== 'remove');
    for (const change of kept) {
      if (change.type === 'position' && change.position && !dragging.current && change.dragging !== true) {
        keyboardMoves.current.set(change.id, change.position);
      }
      if (change.type === 'select' && change.selected) setSelectedGroup(undefined);
    }
    setNodes((current) => applyNodeChanges(kept, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<DiagramFlowEdge>[]) => {
    setSelectedEdges((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type !== 'select') continue;
        if (next === current) next = new Set(current);
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      }
      return next;
    });
    if (changes.some((change) => change.type === 'select' && change.selected)) setSelectedGroup(undefined);
  }, []);

  const onNodeDragStart = useCallback(() => {
    dragging.current = true;
  }, []);

  const onNodeDragStop: OnNodeDrag<DiagramFlowNode> = useCallback(
    (_event, _node, dragged) => {
      dragging.current = false;
      for (const node of dragged) keyboardMoves.current.delete(node.id);
      send(
        dragToOperations(
          dragged.map((node) => ({ id: node.id, position: node.position })),
          layout,
        ),
        t('Position pinned', 'Posição fixada'),
        { kind: 'continuous' },
      );
    },
    [layout, send, t],
  );

  const copy = () => {
    const copied = copySelection(content, layout, selection.nodes);
    if (!copied) return;
    setClipboard(copied);
    setAnnouncement(t('Copied', 'Copiado'));
  };
  const paste = (from: DiagramClipboard | undefined = clipboard) => {
    if (!from) return;
    const result = pasteOperations(content, from);
    pendingSelect.current = result.select;
    send(result.operations, t('Pasted', 'Colado'));
  };
  const duplicate = () => {
    const result = duplicateOperations(content, layout, selection.nodes);
    pendingSelect.current = result.select;
    send(result.operations, t('Duplicated', 'Duplicado'));
  };
  const groupSelection = () =>
    send(
      groupSelectionOperations(content, selection.nodes, t('Group', 'Grupo')),
      t('Nodes grouped', 'Nós agrupados'),
    );
  const ungroupSelection = () =>
    send(ungroupOperations(content, selection.nodes), t('Nodes ungrouped', 'Nós desagrupados'));
  const addNode = (shape?: NodeShape) =>
    send(
      [
        {
          op: 'add_node',
          label: t('New node', 'Novo nó'),
          ...(shape && shape !== 'box' ? { shape } : {}),
          ...(selection.group ? { group: selection.group } : {}),
        },
      ],
      t('Node added', 'Nó adicionado'),
    );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || isTyping(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'c' && selection.nodes.length > 0) {
      event.preventDefault();
      copy();
      return;
    }
    if (mod && key === 'a') {
      event.preventDefault();
      setNodes((current) => current.map((node) => ({ ...node, selected: true })));
      return;
    }
    if (readOnly) return;
    if (mod && key === 'v' && clipboard) {
      event.preventDefault();
      paste();
      return;
    }
    if (mod && key === 'x' && selection.nodes.length > 0) {
      event.preventDefault();
      copy();
      deleteSelection();
      return;
    }
    if (mod && key === 'd' && selection.nodes.length > 0) {
      event.preventDefault();
      duplicate();
      return;
    }
    if (mod && key === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroupSelection();
      else groupSelection();
      return;
    }
    // F2 renames the selected node or edge, the keyboard counterpart of double-click.
    if (event.key !== 'F2') return;
    const target: EditingTarget | undefined =
      selection.nodes.length === 1 && selection.edges.length === 0
        ? { kind: 'node', id: selection.nodes[0]! }
        : selection.edges.length === 1 && selection.nodes.length === 0
          ? { kind: 'edge', id: selection.edges[0]! }
          : selection.group
            ? { kind: 'group', id: selection.group }
            : undefined;
    if (!target || readOnly) return;
    event.preventDefault();
    setEditing(target);
  };

  // Arrow keys move selected nodes in React Flow; the gesture ends when the key is released.
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.has(event.key) || keyboardMoves.current.size === 0) return;
    const moved = [...keyboardMoves.current.entries()].map(([id, position]) => ({ id, position }));
    keyboardMoves.current.clear();
    send(dragToOperations(moved, layout), t('Position pinned', 'Posição fixada'), { kind: 'continuous' });
  };

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const op = connectionToOperation(connection);
      if (op) send([op], t('Edge added', 'Aresta adicionada'));
    },
    [send, t],
  );

  const onDelete: OnDelete<DiagramFlowNode, DiagramFlowEdge> = useCallback(
    ({ nodes: removedNodes, edges: removedEdges }) => {
      send(deletionToOperations(removedNodes, removedEdges), t('Deleted', 'Excluído'));
    },
    [send, t],
  );

  const deleteSelection = () => {
    if (selection.group) {
      send([{ op: 'remove_group', id: selection.group }], t('Group removed', 'Grupo removido'));
      setSelectedGroup(undefined);
      return;
    }
    const removedEdges = content.edges
      .filter((edge) => selection.edges.includes(edge.id))
      .map((edge) => ({ id: edge.id, source: edge.from, target: edge.to }));
    send(
      deletionToOperations(
        selection.nodes.map((id) => ({ id })),
        removedEdges,
      ),
      t('Deleted', 'Excluído'),
    );
  };

  const startEditing = useCallback((target: EditingTarget) => setEditing(target), []);
  const finishEditing = useCallback(
    (target: EditingTarget, value: string | undefined) => {
      setEditing(null);
      if (value === undefined) return;
      const previous =
        target.kind === 'node'
          ? content.nodes.find((node) => node.id === target.id)?.label
          : target.kind === 'edge'
            ? content.edges.find((edge) => edge.id === target.id)?.label
            : content.groups.find((group) => group.id === target.id)?.label;
      const op = labelEditOperation(target.kind, target.id, previous, value);
      if (op) send([op], t('Label changed', 'Rótulo alterado'));
    },
    [content, send, t],
  );

  const contextValue: DiagramEditorContextValue = useMemo(
    () => ({ readOnly, locale, scene, lint: lintMap, editing, startEditing, finishEditing }),
    [readOnly, locale, scene, lintMap, editing, startEditing, finishEditing],
  );

  const groupKind =
    content.layout === 'bands' || content.groups.some((group) => group.kind === 'band') ? 'band' : 'box';
  const shapeNames: Record<NodeShape, string> = {
    box: t('Box', 'Caixa'),
    round: t('Rounded', 'Arredondado'),
    diamond: t('Decision', 'Decisão'),
    ellipse: t('Ellipse', 'Elipse'),
    cylinder: t('Database', 'Banco de dados'),
    document: t('Document', 'Documento'),
    actor: t('Person', 'Pessoa'),
  };
  const shapeItems: ToolbarMenuItem[] = (Object.keys(SHAPE_ICONS) as NodeShape[]).map((shape) => ({
    key: shape,
    label: shapeNames[shape],
    icon: SHAPE_ICONS[shape],
    onSelect: () => addNode(shape),
  }));
  const alignNames: Record<NodeAlign, string> = {
    left: t('Align left', 'Alinhar à esquerda'),
    center: t('Align centers', 'Centralizar na horizontal'),
    right: t('Align right', 'Alinhar à direita'),
    top: t('Align top', 'Alinhar ao topo'),
    middle: t('Align middles', 'Centralizar na vertical'),
    bottom: t('Align bottom', 'Alinhar à base'),
  };
  const alignItems: (ToolbarMenuItem | 'separator')[] = [
    ...(Object.keys(ALIGN_ICONS) as NodeAlign[]).map((mode) => ({
      key: mode,
      label: alignNames[mode],
      icon: ALIGN_ICONS[mode],
      onSelect: () =>
        send(alignOperations(layout, selection.nodes, mode), t('Nodes aligned', 'Nós alinhados')),
    })),
    'separator',
    {
      key: 'distribute-h',
      label: t('Distribute horizontally', 'Distribuir na horizontal'),
      icon: AlignHorizontalDistributeCenter,
      disabled: selection.nodes.length < 3,
      onSelect: () =>
        send(
          distributeOperations(layout, selection.nodes, 'horizontal'),
          t('Nodes distributed', 'Nós distribuídos'),
        ),
    },
    {
      key: 'distribute-v',
      label: t('Distribute vertically', 'Distribuir na vertical'),
      icon: AlignVerticalDistributeCenter,
      disabled: selection.nodes.length < 3,
      onSelect: () =>
        send(
          distributeOperations(layout, selection.nodes, 'vertical'),
          t('Nodes distributed', 'Nós distribuídos'),
        ),
    },
  ];
  const selectedEdges_ = content.edges.filter((edge) => selection.edges.includes(edge.id));
  const allEdges = <K extends 'style' | 'arrow'>(key: K, value: string) =>
    selectedEdges_.length > 0 && selectedEdges_.every((edge) => edge[key] === value);
  const lineItems: ToolbarMenuItem[] = [
    { value: 'solid' as const, label: t('Solid', 'Contínua') },
    { value: 'dashed' as const, label: t('Dashed', 'Tracejada') },
  ].map(({ value, label }) => ({
    key: value,
    label,
    checked: allEdges('style', value),
    onSelect: () =>
      send(
        edgeStyleOperations(content, selection.edges, { style: value }),
        t('Edge updated', 'Aresta atualizada'),
      ),
  }));
  const arrowItems: ToolbarMenuItem[] = [
    { value: 'end' as const, label: t('Arrow at the end', 'Seta no destino') },
    { value: 'both' as const, label: t('Arrows at both ends', 'Setas nas duas pontas') },
    { value: 'none' as const, label: t('No arrows', 'Sem setas') },
  ].map(({ value, label }) => ({
    key: value,
    label,
    checked: allEdges('arrow', value),
    onSelect: () =>
      send(
        edgeStyleOperations(content, selection.edges, { arrow: value }),
        t('Edge updated', 'Aresta atualizada'),
      ),
  }));

  const groupLabels = new Map(content.groups.map((group) => [group.id, group.label]));
  const classes = ['ak-diagram-editor', readOnly ? 'is-readonly' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <DiagramEditorContext.Provider value={contextValue}>
      {/* biome-ignore lint/a11y/useSemanticElements: an editing surface, not a form fieldset. */}
      <div
        className={classes}
        // Inside <ArtifactProvider> the host sets the theme variables (with dark mode); standalone uses the artifact theme.
        style={hosted ? undefined : (themeCssVariables(ctx.theme) as CSSProperties)}
        role="group"
        aria-label={t('Diagram editor', 'Editor de diagrama')}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
      >
        <Toolbar label={t('Diagram tools', 'Ferramentas do diagrama')} className="ak-diagram-editor-toolbar">
          <ToolbarGroup label={t('Insert', 'Inserir')}>
            <ToolbarButton
              icon={Plus}
              label={t('Add node', 'Adicionar nó')}
              showLabel
              disabled={readOnly}
              onClick={() => addNode()}
            />
            <ToolbarMenu
              icon={Shapes}
              label={t('Add shape', 'Adicionar forma')}
              disabled={readOnly}
              items={[
                ...shapeItems,
                'separator',
                {
                  key: 'group',
                  label: t('Empty group', 'Grupo vazio'),
                  icon: SquareDashed,
                  onSelect: () =>
                    send(
                      [{ op: 'add_group', label: t('Group', 'Grupo'), kind: groupKind }],
                      t('Group added', 'Grupo adicionado'),
                    ),
                },
              ]}
            />
          </ToolbarGroup>
          <ToolbarGroup label={t('Edit', 'Edição')}>
            <ToolbarButton
              icon={Copy}
              label={t('Copy', 'Copiar')}
              shortcut="Ctrl+C"
              disabled={selection.nodes.length === 0}
              onClick={copy}
            />
            <ToolbarButton
              icon={ClipboardPaste}
              label={t('Paste', 'Colar')}
              shortcut="Ctrl+V"
              disabled={readOnly || !clipboard}
              onClick={() => paste()}
            />
            <ToolbarButton
              icon={CopyPlus}
              label={t('Duplicate', 'Duplicar')}
              shortcut="Ctrl+D"
              disabled={readOnly || selection.nodes.length === 0}
              onClick={duplicate}
            />
            <ToolbarButton
              icon={Trash2}
              label={t('Delete', 'Excluir')}
              variant="danger"
              disabled={
                readOnly || (selection.nodes.length === 0 && selection.edges.length === 0 && !selection.group)
              }
              onClick={deleteSelection}
            />
          </ToolbarGroup>
          <ToolbarGroup label={t('Arrange', 'Organizar')}>
            <ToolbarButton
              icon={Group}
              label={t('Group', 'Agrupar')}
              shortcut="Ctrl+G"
              disabled={readOnly || selection.nodes.length === 0}
              onClick={groupSelection}
            />
            <ToolbarButton
              icon={Ungroup}
              label={t('Ungroup', 'Desagrupar')}
              shortcut="Ctrl+Shift+G"
              disabled={readOnly || ungroupOperations(content, selection.nodes).length === 0}
              onClick={ungroupSelection}
            />
            <ToolbarMenu
              icon={AlignStartVertical}
              label={t('Align nodes', 'Alinhar nós')}
              disabled={readOnly || selection.nodes.length < 2}
              items={alignItems}
            />
            <ToolbarButton
              icon={WandSparkles}
              label={t('Auto-arrange', 'Reorganizar automaticamente')}
              disabled={readOnly || autoArrangeOperations(content).length === 0}
              onClick={() =>
                send(autoArrangeOperations(content), t('Diagram rearranged', 'Diagrama reorganizado'))
              }
            />
          </ToolbarGroup>
          <ToolbarGroup label={t('Layout', 'Layout')}>
            <ToolbarSelect<Direction>
              label={t('Direction', 'Direção')}
              value={content.direction}
              disabled={readOnly}
              options={[
                { value: 'TB', label: t('Top to bottom', 'De cima para baixo') },
                { value: 'LR', label: t('Left to right', 'Da esquerda para a direita') },
              ]}
              onChange={(direction) =>
                send([{ op: 'set_direction', direction }], t('Direction changed', 'Direção alterada'))
              }
            />
            <ToolbarSelect<DiagramLayoutMode>
              label={t('Layout', 'Layout')}
              value={content.layout}
              disabled={readOnly}
              options={[
                { value: 'auto', label: t('Automatic', 'Automático') },
                { value: 'bands', label: t('Bands', 'Faixas') },
                { value: 'manual', label: t('Manual', 'Manual') },
              ]}
              onChange={(mode) =>
                send([{ op: 'set_layout', layout: mode }], t('Layout changed', 'Layout alterado'))
              }
            />
          </ToolbarGroup>
          {selection.edges.length > 0 ? (
            <ToolbarGroup label={t('Edge', 'Aresta')}>
              <ToolbarMenu
                icon={Spline}
                label={t('Line style', 'Estilo da linha')}
                disabled={readOnly}
                items={lineItems}
              />
              <ToolbarMenu
                icon={MoveRight}
                label={t('Arrowheads', 'Pontas da seta')}
                disabled={readOnly}
                items={arrowItems}
              />
              <ToolbarButton
                icon={ArrowRightLeft}
                label={t('Reverse direction', 'Inverter sentido')}
                disabled={readOnly}
                onClick={() =>
                  send(
                    reverseEdgeOperations(content, selection.edges),
                    t('Edge reversed', 'Aresta invertida'),
                  )
                }
              />
            </ToolbarGroup>
          ) : null}
          <ToolbarGroup label={t('View', 'Exibição')}>
            <ToolbarButton
              icon={ZoomOut}
              label={t('Zoom out', 'Diminuir zoom')}
              keepFocus={false}
              onClick={() => flow.zoomOut()}
            />
            <ToolbarButton
              icon={ZoomIn}
              label={t('Zoom in', 'Aumentar zoom')}
              keepFocus={false}
              onClick={() => flow.zoomIn()}
            />
            <ToolbarButton
              icon={Maximize}
              label={t('Fit to screen', 'Ajustar à tela')}
              keepFocus={false}
              onClick={() => flow.fitView({ padding: 0.15 })}
            />
            <ToolbarButton
              icon={MapIcon}
              label={t('Minimap', 'Minimapa')}
              pressed={minimap}
              onClick={() => setMinimap((value) => !value)}
            />
            <ToolbarButton
              icon={Grid3x3}
              label={t('Snap to grid', 'Alinhar à grade')}
              pressed={snap}
              onClick={() => setSnap((value) => !value)}
            />
          </ToolbarGroup>
        </Toolbar>
        <div className="ak-diagram-editor-body">
          <div className="ak-diagram-editor-canvas">
            <ReactFlow<DiagramFlowNode, DiagramFlowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onDelete={onDelete}
              onEdgeDoubleClick={(_event, edge) => !readOnly && startEditing({ kind: 'edge', id: edge.id })}
              onPaneClick={() => setSelectedGroup(undefined)}
              isValidConnection={(connection) => connection.source !== connection.target}
              connectionMode={ConnectionMode.Loose}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              elementsSelectable
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={['Meta', 'Control']}
              fitView
              snapToGrid={snap}
              snapGrid={[16, 16]}
              minZoom={0.2}
              maxZoom={3}
            >
              <ViewportPortal>
                <div className="ak-diagram-editor-groups">
                  {layout.groups.map((group) => {
                    const label = groupLabels.get(group.id) ?? group.id;
                    const editingGroup = editing?.kind === 'group' && editing.id === group.id;
                    return (
                      <div
                        key={group.id}
                        className={`ak-diagram-editor-group is-${group.variant}${selection.group === group.id ? ' is-selected' : ''}`}
                        style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
                      >
                        {editingGroup ? (
                          <span
                            className={`ak-diagram-editor-group-label${group.label.rotated ? ' is-rotated' : ''}`}
                          >
                            <InlineLabelInput
                              target={{ kind: 'group', id: group.id }}
                              value={label}
                              label={t('Group label', 'Rótulo do grupo')}
                              maxLength={GROUP_LABEL_MAX}
                            />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={`ak-diagram-editor-group-label nodrag nopan${group.label.rotated ? ' is-rotated' : ''}`}
                            aria-pressed={selection.group === group.id}
                            onClick={() => {
                              setSelectedGroup(group.id);
                              setSelectedEdges(new Set());
                              setNodes((current) =>
                                current.map((node) => (node.selected ? { ...node, selected: false } : node)),
                              );
                            }}
                            onDoubleClick={() => !readOnly && startEditing({ kind: 'group', id: group.id })}
                          >
                            {label}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ViewportPortal>
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              {minimap ? (
                <MiniMap
                  pannable
                  zoomable
                  ariaLabel={t('Minimap', 'Minimapa')}
                  nodeColor="var(--ak-color-border-strong)"
                  maskColor="color-mix(in srgb, var(--ak-color-background) 70%, transparent)"
                />
              ) : null}
            </ReactFlow>
          </div>
          <Inspector
            content={content}
            selection={selection}
            readOnly={readOnly}
            locale={locale}
            theme={ctx.theme}
            lint={lintMap}
            send={(ops, message) => send(ops, message)}
          />
        </div>
        <div className="ak-diagram-sr-only" aria-live="polite">
          {announcement}
        </div>
      </div>
    </DiagramEditorContext.Provider>
  );
}
