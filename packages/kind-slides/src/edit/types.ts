import type { EmitOptions, LintIssue, RenderContext } from '@artkit/core';
import type { SlidesOperation } from '../operations.js';

export type Selection =
  | { kind: 'none' }
  | { kind: 'elements'; ids: string[] }
  | { kind: 'slot'; slot: string };

export type TextTarget = { kind: 'element'; id: string } | { kind: 'slot'; slot: string };

/** Stores a file in the host's AssetStore and returns its `asset://` reference. */
export type UploadImage = (file: File) => Promise<{ asset: string; alt?: string }>;

export interface EditorEnv {
  ctx: RenderContext;
  emit(operations: SlidesOperation[], options?: EmitOptions): void;
  readOnly: boolean;
  allowHexColors: boolean;
  uploadImage?: UploadImage;
  lint: LintIssue[];
  t(en: string, pt: string): string;
}
