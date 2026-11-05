import type {
  AnyArtifactExporter,
  ArtifactRegistry,
  AssetResolver,
  EditorBindings,
  RenderContext,
  Theme,
} from '@artkit-ai/core';
import { type ComponentType, createContext, useContext } from 'react';
import type { ArtifactCache } from './cache.js';
import type { ArtifactClient } from './client.js';
import type { Translate } from './i18n.js';

export interface RendererProps<Content = unknown> {
  content: Content;
  ctx: RenderContext;
  className?: string;
}

/** What a kind's `/react` entry provides. */
export interface RendererModule {
  // biome-ignore lint/suspicious/noExplicitAny: renderers are typed by their own format.
  Renderer: ComponentType<RendererProps<any>>;
  css?: string;
}

/** What a kind's `/edit` entry provides. */
export interface EditorModule {
  // biome-ignore lint/suspicious/noExplicitAny: editors are typed by their own format.
  Editor: ComponentType<EditorBindings<any, any>>;
  css?: string;
  /**
   * Who draws the undo, redo and save controls. `host` (default): the editor host shows them above the format editor.
   * `format`: the format editor receives `actions` and draws them inside its own toolbar.
   */
  toolbar?: 'host' | 'format';
}

/**
 * Lazy loaders per format, so the bundle only pulls what is shown (spec §13.6). Typical use:
 * `renderers: { document: () => import('@artkit-ai/kind-document/react').then((m) => ({ Renderer: m.DocumentRenderer, css: m.documentCss })) }`.
 */
export interface ArtifactLoaders {
  renderers?: Record<string, () => Promise<RendererModule>>;
  editors?: Record<string, () => Promise<EditorModule>>;
  exporters?: Record<string, () => Promise<AnyArtifactExporter[]>>;
}

export type ColorScheme = 'light' | 'dark' | 'system';

export interface ArtkitContextValue {
  registry: ArtifactRegistry;
  client: ArtifactClient;
  cache: ArtifactCache;
  locale: string;
  t: Translate;
  appTheme: Theme;
  colorScheme: ColorScheme;
  /** Theme of an artifact: provider themes, then registry themes, then the application theme. */
  themeFor(themeId: string | undefined): Theme;
  resolveAssetUrl?: (ref: string) => string | undefined;
  assets?: AssetResolver;
  /** Formats the server can export, per format. */
  exportFormats: Record<string, readonly string[]>;
  hasRenderer(format: string): boolean;
  hasEditor(format: string): boolean;
  hasExporters(format: string): boolean;
  loadRenderer(format: string): Promise<RendererModule>;
  loadEditor(format: string): Promise<EditorModule>;
  loadExporters(format: string): Promise<AnyArtifactExporter[]>;
  /** Forgets a failed load so it can be retried. */
  resetLoad(type: 'renderer' | 'editor' | 'exporters', format: string): void;
  nonce?: string;
}

export const ArtkitContext = createContext<ArtkitContextValue | null>(null);

/** The artkit context, or null outside `<ArtifactProvider>` (for components that also work standalone). */
export function useOptionalArtkit(): ArtkitContextValue | null {
  return useContext(ArtkitContext);
}

export function useArtkit(): ArtkitContextValue {
  const value = useContext(ArtkitContext);
  if (!value) throw new Error('artkit components and hooks must be rendered inside <ArtifactProvider>.');
  return value;
}
