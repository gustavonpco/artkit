import { diagramCss } from '../react/css.js';

/**
 * Minimal React Flow structure styles, written for the editor so it works without importing
 * `@xyflow/react/dist/style.css` (hosts may still add it).
 */
const flowCss = `
.ak-diagram-editor .react-flow { position: relative; width: 100%; height: 100%; overflow: hidden; direction: ltr; z-index: 0; }
.ak-diagram-editor .react-flow__container { position: absolute; width: 100%; height: 100%; top: 0; left: 0; }
.ak-diagram-editor .react-flow__pane { z-index: 1; touch-action: none; }
.ak-diagram-editor .react-flow__pane.draggable { cursor: grab; }
.ak-diagram-editor .react-flow__pane.dragging { cursor: grabbing; }
.ak-diagram-editor .react-flow__viewport { transform-origin: 0 0; z-index: 2; pointer-events: none; }
.ak-diagram-editor .react-flow__renderer { z-index: 4; }
.ak-diagram-editor .react-flow__selection { z-index: 6; }
.ak-diagram-editor .react-flow__selection, .ak-diagram-editor .react-flow__nodesselection-rect {
  background: color-mix(in srgb, var(--ak-color-accent) 8%, transparent);
  border: 1px dotted var(--ak-color-accent);
}
.ak-diagram-editor .react-flow__edges { position: absolute; }
.ak-diagram-editor .react-flow__edges svg { overflow: visible; position: absolute; pointer-events: none; }
.ak-diagram-editor .react-flow__edge { pointer-events: visibleStroke; }
.ak-diagram-editor .react-flow__edge.selectable { cursor: pointer; }
.ak-diagram-editor .react-flow__edge:focus-visible { outline: none; }
.ak-diagram-editor .react-flow__edge-path { fill: none; stroke: var(--ak-color-muted); stroke-width: 1.5; }
.ak-diagram-editor .react-flow__edge.selected .react-flow__edge-path,
.ak-diagram-editor .react-flow__edge:focus-visible .react-flow__edge-path { stroke: var(--ak-color-accent); stroke-width: 2.5; }
.ak-diagram-editor .react-flow__edge-interaction { fill: none; stroke-opacity: 0; }
.ak-diagram-editor .react-flow__connection { pointer-events: none; }
.ak-diagram-editor .react-flow__connection-path { fill: none; stroke: var(--ak-color-accent); stroke-width: 1.5; }
.ak-diagram-editor svg.react-flow__connectionline { z-index: 1001; overflow: visible; position: absolute; }
.ak-diagram-editor .react-flow__nodes { pointer-events: none; transform-origin: 0 0; }
.ak-diagram-editor .react-flow__node { position: absolute; user-select: none; pointer-events: all; transform-origin: 0 0; box-sizing: border-box; cursor: default; }
.ak-diagram-editor .react-flow__node.selectable { cursor: pointer; }
.ak-diagram-editor .react-flow__node.draggable { cursor: grab; }
.ak-diagram-editor .react-flow__node.dragging { cursor: grabbing; }
.ak-diagram-editor .react-flow__node:focus-visible { outline: 2px solid var(--ak-color-focus); outline-offset: 3px; border-radius: var(--ak-radius-sm, 6px); }
.ak-diagram-editor .react-flow__nodesselection { z-index: 3; transform-origin: left top; pointer-events: none; }
.ak-diagram-editor .react-flow__nodesselection-rect { position: absolute; pointer-events: all; cursor: grab; }
.ak-diagram-editor .react-flow__handle {
  position: absolute; pointer-events: none; width: 9px; height: 9px; border-radius: 50%;
  background: var(--ak-color-accent); border: 1.5px solid var(--ak-color-background); opacity: 0; transition: opacity 0.1s;
}
.ak-diagram-editor .react-flow__node:hover .react-flow__handle,
.ak-diagram-editor .react-flow__node.selected .react-flow__handle,
.ak-diagram-editor .react-flow__node:focus-visible .react-flow__handle,
.ak-diagram-editor .react-flow__handle.connectingfrom { opacity: 1; }
.ak-diagram-editor.is-readonly .react-flow__handle { display: none; }
.ak-diagram-editor .react-flow__handle.connectingfrom, .ak-diagram-editor .react-flow__handle.connectionindicator { pointer-events: all; cursor: crosshair; }
.ak-diagram-editor .react-flow__handle-bottom { top: auto; left: 50%; bottom: 0; transform: translate(-50%, 50%); }
.ak-diagram-editor .react-flow__handle-top { top: 0; left: 50%; transform: translate(-50%, -50%); }
.ak-diagram-editor .react-flow__handle-left { top: 50%; left: 0; transform: translate(-50%, -50%); }
.ak-diagram-editor .react-flow__handle-right { top: 50%; right: 0; transform: translate(50%, -50%); }
.ak-diagram-editor .react-flow__panel { position: absolute; z-index: 5; margin: 12px; }
.ak-diagram-editor .react-flow__panel.top { top: 0; }
.ak-diagram-editor .react-flow__panel.bottom { bottom: 0; }
.ak-diagram-editor .react-flow__panel.left { left: 0; }
.ak-diagram-editor .react-flow__panel.right { right: 0; }
.ak-diagram-editor .react-flow__attribution { font-size: 10px; background: color-mix(in srgb, var(--ak-color-background) 60%, transparent); padding: 2px 3px; margin: 0; }
.ak-diagram-editor .react-flow__attribution a { color: var(--ak-color-muted); text-decoration: none; }
.ak-diagram-editor .react-flow__edgelabel-renderer { position: absolute; width: 100%; height: 100%; pointer-events: none; user-select: none; left: 0; top: 0; }
.ak-diagram-editor .react-flow__viewport-portal { position: absolute; width: 100%; height: 100%; left: 0; top: 0; user-select: none; }
.ak-diagram-editor .react-flow__background { pointer-events: none; z-index: -1; position: absolute; width: 100%; height: 100%; top: 0; left: 0; }
.ak-diagram-editor .react-flow__background-pattern.dots { fill: color-mix(in srgb, var(--ak-color-muted) 35%, transparent); }
.ak-diagram-editor .react-flow__controls { display: flex; flex-direction: column; border-radius: var(--ak-radius-sm, 6px); overflow: hidden; border: 1px solid var(--ak-color-border); }
.ak-diagram-editor .react-flow__controls-button {
  display: flex; justify-content: center; align-items: center; width: 28px; height: 28px; padding: 6px;
  border: none; border-bottom: 1px solid var(--ak-color-surface); background: var(--ak-color-background); color: var(--ak-color-text); cursor: pointer;
}
.ak-diagram-editor .react-flow__controls-button:focus-visible { outline: 2px solid var(--ak-color-focus); outline-offset: -2px; }
.ak-diagram-editor .react-flow__controls-button svg { width: 100%; max-width: 12px; max-height: 12px; fill: currentColor; }
`;

const editorCss = `
.ak-diagram-editor {
  container: ak-diagram-editor / inline-size;
  display: flex; flex-direction: column; gap: 8px;
  height: 100%; min-height: 520px;
  color: var(--ak-color-text, #1d2f3c);
  font-family: var(--ak-font-body, "Sora", "Segoe UI", system-ui, sans-serif);
  font-size: 13px;
}
.ak-diagram-editor-body { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 12px; min-height: 480px; }
.ak-diagram-editor-canvas {
  position: relative; min-height: 480px; overflow: hidden;
  background: var(--ak-color-background, #fff);
  border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-md, 8px);
}
.ak-diagram-editor-canvas:focus-within { border-color: var(--ak-color-border-strong, #8e979d); }
.ak-diagram-editor-side { max-height: none; align-self: stretch; }
.ak-diagram-editor-side code { font-family: var(--ak-font-mono, ui-monospace, monospace); font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--ak-color-muted, #56636d); }
.ak-diagram-editor-route { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; font-size: 13px; color: var(--ak-color-muted, #56636d); }
.ak-diagram-editor-route span { padding: 2px 8px; border-radius: 999px; background: var(--ak-color-surface, #f4f7f7); color: var(--ak-color-text, #1d2f3c); font-weight: 600; }
.ak-diagram-editor-hint-icon { width: 14px; height: 14px; margin-right: 6px; vertical-align: -2px; }
.ak-diagram-editor-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; }
.ak-diagram-editor-stats div { padding: 8px; border-radius: var(--ak-radius-sm, 6px); background: var(--ak-color-surface, #f4f7f7); text-align: center; }
.ak-diagram-editor-stats dt { font-size: 11px; color: var(--ak-color-muted, #56636d); }
.ak-diagram-editor-stats dd { margin: 2px 0 0; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ak-diagram-editor-issues { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.ak-diagram-editor-lint { padding: 6px 8px; border-radius: var(--ak-radius-sm, 6px); font-size: 12px; background: var(--ak-color-surface, #f4f7f7); border: 1px solid var(--ak-color-border, #dde0e2); }
.ak-diagram-editor-lint.is-warning { color: var(--ak-color-warning, #73692f); background: var(--ak-color-fill-warning, #f1f0ea); border-color: var(--ak-color-warning, #73692f); }
.ak-diagram-editor-lint span { color: var(--ak-color-muted, #56636d); }
.ak-diagram-editor .react-flow__minimap { background: var(--ak-color-surface, #f4f7f7); border: 1px solid var(--ak-color-border, #dde0e2); border-radius: var(--ak-radius-sm, 6px); overflow: hidden; }
.ak-diagram-editor .react-flow__minimap svg { display: block; }
.ak-diagram-editor .react-flow__minimap-mask { fill-rule: evenodd; }
.ak-diagram-editor .react-flow__minimap-node { stroke: none; }
@container ak-diagram-editor (max-width: 760px) { .ak-diagram-editor-body { grid-template-columns: 1fr; } }
.ak-diagram-editor-node { position: relative; width: 100%; height: 100%; }
.ak-diagram-editor-node-shape { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.ak-diagram-editor-node.is-selected .ak-diagram-node-body,
.ak-diagram-editor-node.is-selected .ak-diagram-node-figure { stroke: var(--ak-color-primary-deep); stroke-width: 2.5; }
.ak-diagram-editor-inline {
  position: absolute; left: 4px; right: 4px; top: 50%; transform: translateY(-50%);
  min-width: 0; text-align: center; z-index: 2;
}
.ak-diagram-editor-pin {
  position: absolute; top: -6px; left: -6px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--ak-color-accent); color: var(--ak-color-background); font-size: 10px; line-height: 12px; text-align: center;
}
.ak-diagram-editor-issue {
  position: absolute; top: -7px; right: -7px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--ak-color-warning); color: var(--ak-color-background); font-size: 10px; font-weight: 700; line-height: 14px; text-align: center;
}
.ak-diagram-editor-edge.is-dashed { stroke-dasharray: 6 4; }
.ak-diagram-editor-edge-label {
  position: absolute; pointer-events: all; padding: 1px 4px; border-radius: var(--ak-radius-sm, 6px);
  background: var(--ak-color-background); color: var(--ak-color-text); font-size: 12px; white-space: nowrap;
}
.ak-diagram-editor-edge-label.is-selected { outline: 1px solid var(--ak-color-accent); }
.ak-diagram-editor-edge-label .ak-diagram-editor-inline { position: static; transform: none; width: 160px; }
.ak-diagram-editor-groups { position: absolute; left: 0; top: 0; z-index: -1; }
.ak-diagram-editor-group {
  position: absolute; box-sizing: border-box; pointer-events: none; border-radius: var(--ak-radius-md, 8px);
  background: color-mix(in srgb, var(--ak-color-muted) 6%, var(--ak-color-background));
  border: 1px solid color-mix(in srgb, var(--ak-color-muted) 28%, var(--ak-color-background));
}
.ak-diagram-editor-group.is-box { border-style: dashed; border-radius: var(--ak-radius-md, 8px); background: var(--ak-color-background); }
.ak-diagram-editor-group.is-selected { border-color: var(--ak-color-primary-deep); }
.ak-diagram-editor-group-label {
  position: absolute; left: 8px; top: 4px; pointer-events: all;
  border: none !important; background: transparent !important; padding: 2px 4px !important;
  color: var(--ak-color-accent) !important; font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
}
.ak-diagram-editor-group-label.is-rotated { left: 4px; top: 8px; writing-mode: vertical-rl; transform: rotate(180deg); }
`;

/** Styles of `DiagramEditor` (includes `diagramCss` and the React Flow structure it needs). */
export const diagramEditorCss = `${diagramCss}\n${flowCss}\n${editorCss}`;
