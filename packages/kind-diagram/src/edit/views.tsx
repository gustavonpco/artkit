import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  type NodeProps,
  Position,
  useInternalNode,
} from '@xyflow/react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import { polylinePath } from '../draw.js';
import { renderSceneElement } from '../react/svg-element.js';
import { msg } from '../text.js';
import { type EditingTarget, useDiagramEditor } from './context.js';
import { type DiagramFlowEdge, type DiagramFlowNode, SOURCE_HANDLE, TARGET_HANDLE } from './convert.js';

/** Text input used for inline label editing: Enter or blur commits, Escape cancels. */
export function InlineLabelInput({
  target,
  value,
  label,
  maxLength,
}: {
  target: EditingTarget;
  value: string;
  label: string;
  maxLength: number;
}) {
  const { finishEditing } = useDiagramEditor();
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (next: string | undefined) => {
    if (done.current) return;
    done.current = true;
    finishEditing(target, next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(event.currentTarget.value);
    else if (event.key === 'Escape') finish(undefined);
  };
  return (
    <input
      ref={ref}
      className="ak-diagram-editor-inline nodrag nopan nowheel"
      defaultValue={value}
      maxLength={maxLength}
      aria-label={label}
      onKeyDown={onKeyDown}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

export function DiagramNodeView({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const editor = useDiagramEditor();
  const element = editor.scene.nodes.find((node) => node.attrs['data-id'] === id);
  const node = data.node;
  const lr = data.direction === 'LR';
  const issues = editor.lint.get(`node:${id}`) ?? [];
  const editing = editor.editing?.kind === 'node' && editor.editing.id === id;
  const t = (en: string, pt: string) => msg(editor.locale, en, pt);
  // The scene draws the node at its layout position; the viewBox maps that rectangle onto this box.
  const box = data.rect;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; F2 renames from the keyboard.
    <div
      className={`ak-diagram-editor-node${selected ? ' is-selected' : ''}${issues.length > 0 ? ' has-issues' : ''}`}
      data-id={id}
      onDoubleClick={() => !editor.readOnly && editor.startEditing({ kind: 'node', id })}
    >
      {element && (
        <svg
          className="ak-diagram-editor-node-shape"
          width="100%"
          height="100%"
          overflow="visible"
          viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
          aria-hidden="true"
        >
          <g className={element.className}>
            {element.children?.map((child, index) =>
              editing && child.tag === 'text' ? null : renderSceneElement(child, index),
            )}
          </g>
        </svg>
      )}
      {editing && (
        <InlineLabelInput
          target={{ kind: 'node', id }}
          value={node.label}
          label={t('Node label', 'Rótulo do nó')}
          maxLength={60}
        />
      )}
      {data.pinned && (
        <span
          className="ak-diagram-editor-pin"
          role="img"
          title={t('Pinned position', 'Posição fixada')}
          aria-label={t('Pinned position', 'Posição fixada')}
        >
          •
        </span>
      )}
      {issues.length > 0 && (
        <span
          className="ak-diagram-editor-issue"
          title={issues.map((issue) => issue.message).join('\n')}
          role="img"
          aria-label={issues.map((issue) => issue.message).join(' ')}
        >
          !
        </span>
      )}
      <Handle
        type="target"
        id={TARGET_HANDLE}
        position={lr ? Position.Left : Position.Top}
        isConnectable={!editor.readOnly}
      />
      <Handle
        type="source"
        id={SOURCE_HANDLE}
        position={lr ? Position.Right : Position.Bottom}
        isConnectable={!editor.readOnly}
      />
    </div>
  );
}

const near = (a: { x: number; y: number } | undefined, b: { x: number; y: number }) =>
  a !== undefined && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

export function DiagramEdgeView(props: EdgeProps<DiagramFlowEdge>) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
    markerStart,
    selected,
  } = props;
  const editor = useDiagramEditor();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const t = (en: string, pt: string) => msg(editor.locale, en, pt);
  if (!data) return null;
  const intact =
    near(sourceNode?.internals.positionAbsolute, data.sourceAt) &&
    near(targetNode?.internals.positionAbsolute, data.targetAt);
  let path: string;
  let labelX: number;
  let labelY: number;
  if (intact) {
    path = polylinePath(data.points);
    const last = data.points[data.points.length - 1]!;
    const before = data.points[data.points.length - 2] ?? last;
    labelX = data.label ? data.label.x + data.label.width / 2 : (last.x + before.x) / 2;
    labelY = data.label ? data.label.y + data.label.height / 2 : (last.y + before.y) / 2;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 6,
    });
  }
  const editing = editor.editing?.kind === 'edge' && editor.editing.id === id;
  const label = data.edge.label;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`ak-diagram-editor-edge${data.edge.style === 'dashed' ? ' is-dashed' : ''}${selected ? ' is-selected' : ''}`}
        {...(markerEnd ? { markerEnd } : {})}
        {...(markerStart ? { markerStart } : {})}
        interactionWidth={14}
      />
      {(label || editing) && (
        <EdgeLabelRenderer>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; F2 renames from the keyboard. */}
          <div
            className={`ak-diagram-editor-edge-label nodrag nopan${selected ? ' is-selected' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onDoubleClick={() => !editor.readOnly && editor.startEditing({ kind: 'edge', id })}
          >
            {editing ? (
              <InlineLabelInput
                target={{ kind: 'edge', id }}
                value={label ?? ''}
                label={t('Edge label', 'Rótulo da aresta')}
                maxLength={40}
              />
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const nodeTypes = { diagramNode: DiagramNodeView };
export const edgeTypes = { diagramEdge: DiagramEdgeView };
