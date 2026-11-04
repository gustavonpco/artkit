import { type ArtifactRegistry, type AssetResolver, defaultTheme, type Theme } from '@artkit/core';
import { soraFontFaceCss } from '@artkit/core/fonts';
import { type ReactNode, useMemo, useRef } from 'react';
import { cacheFor } from './cache.js';
import type { ArtifactClient } from './client.js';
import {
  type ArtifactLoaders,
  ArtkitContext,
  type ArtkitContextValue,
  type ColorScheme,
  type EditorModule,
  type RendererModule,
} from './context.js';
import { createTranslator, type UiMessageOverrides } from './i18n.js';
import { artkitCss, hashString, themeStyles } from './styles.js';

export interface ArtifactProviderProps {
  /** Core registry with the kinds the app shows (parsePartial, apply, project, diff, lint). */
  registry: ArtifactRegistry;
  client: ArtifactClient;
  /** Lazy renderers, editors and exporters per kind. Read once per kind: later changes are ignored. */
  loaders?: ArtifactLoaders;
  /** UI locale (pt-BR or en built in). Artifacts keep their own locale for content formatting. */
  locale?: string;
  /** Extra or overriding UI strings, keyed by locale. */
  messages?: UiMessageOverrides;
  /** Application theme (object or registered id), used by the host chrome and as fallback. */
  theme?: Theme | string;
  /** Extra artifact themes, looked up by `artifact.themeId` before the registry. */
  themes?: Theme[];
  /** Dark variants keyed by theme id; others are derived automatically. */
  darkThemes?: Record<string, Theme>;
  /** `system` follows `prefers-color-scheme`; `data-theme` on an ancestor also works. */
  colorScheme?: ColorScheme;
  /** Synchronous `asset://` lookup for renderers. */
  resolveAssetUrl?: (ref: string) => string | undefined;
  /** Asset access for exports that run in the browser. */
  assets?: AssetResolver;
  /** Formats the server can export, per kind (merged with exporters available in the browser). */
  exportFormats?: Record<string, readonly string[]>;
  /** Set false when the app ships `artkitCss` itself. */
  injectStyles?: boolean;
  /** CSP nonce for the injected `<style>` elements. */
  nonce?: string;
  /**
   * Inject the embedded Sora font (Mouts design system) when a theme uses it. Default true; set false
   * when the app already serves Sora (e.g. through @fontsource).
   */
  injectFont?: boolean;
  children?: ReactNode;
}

type LoadKey = `${'renderer' | 'editor' | 'exporters'}:${string}`;

export function ArtifactProvider(props: ArtifactProviderProps) {
  const {
    registry,
    client,
    loaders,
    locale = 'en',
    messages,
    colorScheme = 'system',
    injectStyles = true,
    injectFont = true,
    nonce,
  } = props;
  const loads = useRef(new Map<LoadKey, Promise<unknown>>());
  const loadersRef = useRef(loaders);
  loadersRef.current = loaders;

  const appTheme = useMemo<Theme>(() => {
    if (typeof props.theme === 'object') return props.theme;
    if (typeof props.theme === 'string') {
      const found = props.themes?.find((theme) => theme.id === props.theme);
      if (found) return found;
      if (registry.hasTheme(props.theme)) return registry.theme(props.theme);
    }
    return registry.hasTheme('default') ? registry.theme('default') : defaultTheme;
  }, [props.theme, props.themes, registry]);

  const themeList = useMemo(() => {
    const byId = new Map<string, Theme>();
    for (const theme of registry.themes()) byId.set(theme.id, theme);
    for (const theme of props.themes ?? []) byId.set(theme.id, theme);
    return [...byId.values()];
  }, [registry, props.themes]);

  const css = useMemo(
    () => themeStyles(appTheme, themeList, new Map(Object.entries(props.darkThemes ?? {}))),
    [appTheme, themeList, props.darkThemes],
  );

  const value = useMemo<ArtkitContextValue>(() => {
    const byId = new Map(themeList.map((theme) => [theme.id, theme]));
    function load<T>(type: 'renderer' | 'editor' | 'exporters', kind: string): Promise<T> {
      const key: LoadKey = `${type}:${kind}`;
      let promise = loads.current.get(key) as Promise<T> | undefined;
      if (!promise) {
        const group =
          type === 'renderer'
            ? loadersRef.current?.renderers
            : type === 'editor'
              ? loadersRef.current?.editors
              : loadersRef.current?.exporters;
        const loader = group?.[kind];
        promise = loader
          ? (loader() as Promise<T>)
          : Promise.reject(new Error(`No ${type} loader registered for kind "${kind}".`));
        loads.current.set(key, promise);
      }
      return promise;
    }
    return {
      registry,
      client,
      cache: cacheFor(client),
      locale,
      t: createTranslator(locale, messages),
      appTheme,
      colorScheme,
      themeFor: (themeId) => (themeId ? byId.get(themeId) : undefined) ?? appTheme,
      ...(props.resolveAssetUrl ? { resolveAssetUrl: props.resolveAssetUrl } : {}),
      ...(props.assets ? { assets: props.assets } : {}),
      exportFormats: props.exportFormats ?? {},
      hasRenderer: (kind) => Boolean(loadersRef.current?.renderers?.[kind]),
      hasEditor: (kind) => Boolean(loadersRef.current?.editors?.[kind]),
      hasExporters: (kind) => Boolean(loadersRef.current?.exporters?.[kind]),
      loadRenderer: (kind) => load<RendererModule>('renderer', kind),
      loadEditor: (kind) => load<EditorModule>('editor', kind),
      loadExporters: (kind) => load('exporters', kind),
      resetLoad: (type, kind) => {
        loads.current.delete(`${type}:${kind}`);
      },
      ...(nonce ? { nonce } : {}),
    };
  }, [
    registry,
    client,
    locale,
    messages,
    appTheme,
    colorScheme,
    themeList,
    props.resolveAssetUrl,
    props.assets,
    props.exportFormats,
    nonce,
  ]);

  return (
    <ArtkitContext.Provider value={value}>
      {injectStyles ? (
        <>
          {injectFont && usesSora(appTheme, themeList) ? (
            <style href="artkit-font-sora" precedence="artkit" nonce={nonce}>
              {soraFontFaceCss()}
            </style>
          ) : null}
          <style href="artkit-base" precedence="artkit" nonce={nonce}>
            {artkitCss}
          </style>
          <style href={`artkit-theme-${hashString(css)}`} precedence="artkit" nonce={nonce}>
            {css}
          </style>
        </>
      ) : null}
      {props.children}
    </ArtkitContext.Provider>
  );
}

function usesSora(appTheme: Theme, themes: Theme[]): boolean {
  return [appTheme, ...themes].some((theme) =>
    [theme.fonts.heading, theme.fonts.body].some((font) => font.trim().toLowerCase() === 'sora'),
  );
}
