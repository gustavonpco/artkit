export { ColorPicker, type ColorPickerProps } from './controls.js';
export { slidesEditorCss } from './css.js';
export { defaultSlotContent, type InsertKind, newElement, newImageElement } from './defaults.js';
export { EditCanvas, type EditCanvasProps } from './EditCanvas.js';
export {
  type AlignMode,
  alignRects,
  boundingRect,
  clampPosition,
  clampSize,
  type Direction,
  distributeRects,
  type Guide,
  MIN_SIZE,
  moveRect,
  nudgeRect,
  rectChanged,
  resizeRect,
  SNAP_THRESHOLD,
  type SnapOptions,
  type SnapResult,
  snapLines,
  snapMove,
  snapResize,
} from './geometry.js';
export { ChartGrid, type ChartGridProps, TableGrid, type TableGridProps } from './grids.js';
export { Inspector, type InspectorProps } from './Inspector.js';
export { RichTextEditor, type RichTextEditorProps } from './RichTextEditor.js';
export {
  hasMark,
  type Mark,
  readParagraphs,
  readSelection,
  setList,
  setRunColor,
  shiftLevel,
  type TextPoint,
  type TextRange,
  toggleMark,
  toTextFields,
  updateRuns,
  writeSelection,
} from './rich-text.js';
export { SlidePanel, type SlidePanelProps } from './SlidePanel.js';
export { SlidesEditor, type SlidesEditorProps } from './SlidesEditor.js';
export type { EditorEnv, Selection, TextTarget, UploadImage } from './types.js';
