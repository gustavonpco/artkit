import type { LintIssue } from '@artkit-ai/core';
import { createContext, useContext } from 'react';
import type { DiagramScene } from '../scene.js';

export interface EditingTarget {
  kind: 'node' | 'edge' | 'group';
  id: string;
}

export interface DiagramEditorContextValue {
  readOnly: boolean;
  locale: string;
  scene: DiagramScene;
  lint: Map<string, LintIssue[]>;
  editing: EditingTarget | null;
  startEditing(target: EditingTarget): void;
  /** Commits an inline label edit; `value` undefined cancels. */
  finishEditing(target: EditingTarget, value: string | undefined): void;
}

export const DiagramEditorContext = createContext<DiagramEditorContextValue | null>(null);

export function useDiagramEditor(): DiagramEditorContextValue {
  const value = useContext(DiagramEditorContext);
  if (!value) throw new Error('Diagram editor views must be rendered inside DiagramEditor.');
  return value;
}
