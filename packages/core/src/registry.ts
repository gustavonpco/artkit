import type { AssetResolver } from './assets.js';
import { ArtifactError } from './errors.js';
import { t } from './i18n.js';
import { type AnyArtifactKind, assertKindContract, type KindLimits } from './kind.js';
import type { Logger } from './logger.js';
import { defaultTheme, type Theme, themeSchema } from './theme.js';

export const EXPORT_FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'svg',
  'png',
  'pdf',
  'md',
  'html',
  'csv',
  'zip',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportContext {
  title: string;
  theme: Theme;
  locale: string;
  assets: AssetResolver;
  logger: Logger;
  signal?: AbortSignal;
  /** Records a fidelity degradation (spec §12.4), returned to the caller as `warnings`. */
  warn(message: string): void;
  /** Exporter-specific options (e.g. `sheet` for per-sheet CSV). */
  options?: Record<string, unknown>;
}

export interface ArtifactExporter<Content = unknown> {
  kind: string;
  format: ExportFormat;
  mimeType: string;
  extension: string;
  runtime: 'any' | 'node' | 'browser';
  export(content: Content, ctx: ExportContext): Promise<Uint8Array>;
}

// biome-ignore lint/suspicious/noExplicitAny: registry stores heterogeneous exporters.
export type AnyArtifactExporter = ArtifactExporter<any>;

export interface BatchLimits {
  /** Operations per batch (spec §6.6: 200). */
  maxOperations: number;
  /** Serialized envelope size in bytes (spec §6.6: 5 MB). */
  maxEnvelopeBytes: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxOperations: 200, maxEnvelopeBytes: 5 * 1024 * 1024 };

export interface RegistryOptions {
  kinds?: AnyArtifactKind[];
  themes?: Theme[];
  exporters?: AnyArtifactExporter[];
  /** Per-kind overrides of the default limits. */
  limits?: Record<string, Partial<KindLimits>>;
  batch?: Partial<BatchLimits>;
}

export interface ArtifactRegistry {
  register(kind: AnyArtifactKind): void;
  get(kind: string, locale?: string): AnyArtifactKind;
  has(kind: string): boolean;
  kinds(): AnyArtifactKind[];
  limits(kind: string): KindLimits;
  readonly batch: BatchLimits;

  registerTheme(theme: Theme): void;
  theme(id: string, locale?: string): Theme;
  hasTheme(id: string): boolean;
  themes(): Theme[];

  registerExporter(exporter: AnyArtifactExporter, options?: { replace?: boolean }): void;
  exporter(kind: string, format: string, locale?: string): AnyArtifactExporter;
  exporters(kind?: string): AnyArtifactExporter[];
}

export function createRegistry(options: RegistryOptions = {}): ArtifactRegistry {
  const kinds = new Map<string, AnyArtifactKind>();
  const themes = new Map<string, Theme>([[defaultTheme.id, defaultTheme]]);
  const exporters = new Map<string, AnyArtifactExporter>();
  const limitOverrides = options.limits ?? {};
  const batch: BatchLimits = { ...DEFAULT_BATCH_LIMITS, ...options.batch };

  const registry: ArtifactRegistry = {
    batch,
    register(kind) {
      if (kinds.has(kind.kind)) {
        throw new ArtifactError('DUPLICATE_KIND', t(undefined, 'DUPLICATE_KIND', { kind: kind.kind }));
      }
      assertKindContract(kind);
      kinds.set(kind.kind, kind);
    },
    get(kind, locale) {
      const found = kinds.get(kind);
      if (!found) {
        throw new ArtifactError('UNKNOWN_KIND', t(locale, 'UNKNOWN_KIND', { kind }), {
          issues: [
            {
              path: 'kind',
              message: t(locale, 'UNKNOWN_KIND', { kind }),
              hint: t(locale, 'UNKNOWN_KIND_HINT', { available: [...kinds.keys()].join(', ') }),
            },
          ],
        });
      }
      return found;
    },
    has: (kind) => kinds.has(kind),
    kinds: () => [...kinds.values()],
    limits(kind) {
      const base = registry.get(kind).limits;
      const overrides = Object.fromEntries(
        Object.entries(limitOverrides[kind] ?? {}).filter(([, v]) => v !== undefined),
      ) as KindLimits;
      return { ...base, ...overrides };
    },
    registerTheme(theme) {
      themes.set(theme.id, themeSchema.parse(theme));
    },
    theme(id, locale) {
      const found = themes.get(id);
      if (!found) throw new ArtifactError('NOT_FOUND', t(locale, 'THEME_NOT_FOUND', { themeId: id }));
      return found;
    },
    hasTheme: (id) => themes.has(id),
    themes: () => [...themes.values()],
    registerExporter(exporter, opts) {
      const key = `${exporter.kind}:${exporter.format}`;
      if (exporters.has(key) && !opts?.replace) {
        throw new Error(`Exporter ${key} is already registered; pass { replace: true } to override it.`);
      }
      exporters.set(key, exporter);
    },
    exporter(kind, format, locale) {
      const found = exporters.get(`${kind}:${format}`);
      if (!found) throw new ArtifactError('NOT_FOUND', t(locale, 'EXPORTER_NOT_FOUND', { kind, format }));
      return found;
    },
    exporters: (kind) => [...exporters.values()].filter((e) => kind === undefined || e.kind === kind),
  };

  for (const kind of options.kinds ?? []) registry.register(kind);
  for (const theme of options.themes ?? []) registry.registerTheme(theme);
  for (const exporter of options.exporters ?? []) registry.registerExporter(exporter, { replace: true });
  return registry;
}
