import { type AnyFormatAdapter, assertFormatContract, type FormatLimits } from './adapter.js';
import type { AssetResolver } from './assets.js';
import { ArtifactError } from './errors.js';
import { t } from './i18n.js';
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
  /** Records a fidelity degradation (spec §13), returned to the caller as `warnings`. */
  warn(message: string): void;
  /** Exporter-specific options (e.g. `sheet` for per-sheet CSV). */
  options?: Record<string, unknown>;
}

/** Exporters live beside the adapter (spec §8): `format` is the native source, `target` the file format. */
export interface ArtifactExporter<Content = unknown> {
  format: string;
  target: ExportFormat;
  mimeType: string;
  extension: string;
  runtime: 'any' | 'node' | 'browser';
  export(content: Content, ctx: ExportContext): Promise<Uint8Array>;
}

// biome-ignore lint/suspicious/noExplicitAny: the registry stores heterogeneous exporters.
export type AnyArtifactExporter = ArtifactExporter<any>;

export interface BatchLimits {
  /** Operations per batch (spec §7.5: 200). */
  maxOperations: number;
  /** Serialized envelope size in bytes (spec §7.5: 5 MB). */
  maxEnvelopeBytes: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = { maxOperations: 200, maxEnvelopeBytes: 5 * 1024 * 1024 };

export interface RegistryOptions {
  formats?: AnyFormatAdapter[];
  themes?: Theme[];
  exporters?: AnyArtifactExporter[];
  /** Per-format overrides of the default limits. */
  limits?: Record<string, Partial<FormatLimits>>;
  batch?: Partial<BatchLimits>;
}

export interface ArtifactRegistry {
  register(adapter: AnyFormatAdapter): void;
  get(format: string, locale?: string): AnyFormatAdapter;
  has(format: string): boolean;
  formats(): AnyFormatAdapter[];
  limits(format: string): FormatLimits;
  readonly batch: BatchLimits;

  registerTheme(theme: Theme): void;
  theme(id: string, locale?: string): Theme;
  hasTheme(id: string): boolean;
  themes(): Theme[];

  registerExporter(exporter: AnyArtifactExporter, options?: { replace?: boolean }): void;
  exporter(format: string, target: string, locale?: string): AnyArtifactExporter;
  exporters(format?: string): AnyArtifactExporter[];
}

export function createRegistry(options: RegistryOptions = {}): ArtifactRegistry {
  const formats = new Map<string, AnyFormatAdapter>();
  const themes = new Map<string, Theme>([[defaultTheme.id, defaultTheme]]);
  const exporters = new Map<string, AnyArtifactExporter>();
  const limitOverrides = options.limits ?? {};
  const batch: BatchLimits = { ...DEFAULT_BATCH_LIMITS, ...options.batch };

  const registry: ArtifactRegistry = {
    batch,
    register(adapter) {
      if (formats.has(adapter.format)) {
        throw new ArtifactError(
          'DUPLICATE_FORMAT',
          t(undefined, 'DUPLICATE_FORMAT', { format: adapter.format }),
        );
      }
      assertFormatContract(adapter);
      formats.set(adapter.format, adapter);
    },
    get(format, locale) {
      const found = formats.get(format);
      if (!found) {
        throw new ArtifactError('UNKNOWN_FORMAT', t(locale, 'UNKNOWN_FORMAT', { format }), {
          issues: [
            {
              path: 'format',
              message: t(locale, 'UNKNOWN_FORMAT', { format }),
              hint: t(locale, 'UNKNOWN_FORMAT_HINT', { available: [...formats.keys()].join(', ') }),
            },
          ],
        });
      }
      return found;
    },
    has: (format) => formats.has(format),
    formats: () => [...formats.values()],
    limits(format) {
      const base = registry.get(format).limits;
      const overrides = Object.fromEntries(
        Object.entries(limitOverrides[format] ?? {}).filter(([, v]) => v !== undefined),
      ) as FormatLimits;
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
      const key = `${exporter.format}:${exporter.target}`;
      if (exporters.has(key) && !opts?.replace) {
        throw new Error(`Exporter ${key} is already registered; pass { replace: true } to override it.`);
      }
      exporters.set(key, exporter);
    },
    exporter(format, target, locale) {
      const found = exporters.get(`${format}:${target}`);
      if (!found) throw new ArtifactError('NOT_FOUND', t(locale, 'EXPORTER_NOT_FOUND', { format, target }));
      return found;
    },
    exporters: (format) => [...exporters.values()].filter((e) => format === undefined || e.format === format),
  };

  for (const adapter of options.formats ?? []) registry.register(adapter);
  for (const theme of options.themes ?? []) registry.registerTheme(theme);
  for (const exporter of options.exporters ?? []) registry.registerExporter(exporter, { replace: true });
  return registry;
}
