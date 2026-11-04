import type {
  AnyArtifactExporter,
  ArtifactRegistry,
  AssetResolver,
  EditorBindings,
  RenderContext,
  Theme,
} from '@artkit/core';
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
  // biome-ignore lint/suspicious/noExplicitAny: renderers are typed by their own kind.
  Renderer: ComponentType<RendererProps<any>>;
  css?: string;
}

/** What a kind's `/edit` entry provides. */
export interface EditorModule {
  // biome-ignore lint/suspicious/noExplicitAny: editors are typed by their own kind.
  Editor: ComponentType<EditorBindings<any, any>>;
  css?: string;
}

/**
 * Lazy loaders per kind, so the bundle only pulls what is shown (spec §13.6). Typical use:
 * `renderers: { document: () => import('@artkit/kind-document/react').then((m) => ({ Renderer: m.DocumentRenderer, css: m.documentCss })) }`.
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
  /** Formats the server can export, per kind. */
  exportFormats: Record<string, readonly string[]>;
  hasRenderer(kind: string): boolean;
  hasEditor(kind: string): boolean;
  hasExporters(kind: string): boolean;
  loadRenderer(kind: string): Promise<RendererModule>;
  loadEditor(kind: string): Promise<EditorModule>;
  loadExporters(kind: string): Promise<AnyArtifactExporter[]>;
  /** Forgets a failed load so it can be retried. */
  resetLoad(type: 'renderer' | 'editor' | 'exporters', kind: string): void;
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
