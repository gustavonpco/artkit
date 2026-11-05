import type { AnyFormatAdapter } from './adapter.js';
import { ArtifactError } from './errors.js';
import { t } from './i18n.js';

export interface MigrationResult {
  content: unknown;
  formatVersion: string;
  migrated: boolean;
}

/**
 * Migrates content in memory along the adapter's migration chain (spec §7.2). Reading a version the adapter does not
 * declare is refused with `UNSUPPORTED_FORMAT_VERSION`. Persisting the migrated content only happens on the next
 * commit.
 */
export function migrateContent(
  adapter: AnyFormatAdapter,
  content: unknown,
  formatVersion: string,
  locale?: string,
): MigrationResult {
  if (formatVersion === adapter.formatVersion) return { content, formatVersion, migrated: false };
  if (!adapter.readableVersions.includes(formatVersion)) {
    throw new ArtifactError(
      'UNSUPPORTED_FORMAT_VERSION',
      t(locale, 'UNSUPPORTED_FORMAT_VERSION', {
        found: formatVersion,
        supported: adapter.readableVersions.join(', '),
        format: adapter.format,
      }),
      { details: { found: formatVersion, supported: adapter.readableVersions } },
    );
  }
  let current = content;
  let version = formatVersion;
  while (version !== adapter.formatVersion) {
    const step = adapter.migrations.find((migration) => migration.from === version);
    if (!step) {
      throw new ArtifactError(
        'MIGRATION_FAILED',
        t(locale, 'MIGRATION_FAILED', { from: version, to: adapter.formatVersion }),
      );
    }
    try {
      current = step.migrate(structuredClone(current));
    } catch (cause) {
      throw new ArtifactError(
        'MIGRATION_FAILED',
        t(locale, 'MIGRATION_FAILED', { from: step.from, to: step.to }),
        {
          cause,
        },
      );
    }
    version = step.to;
  }
  return { content: current, formatVersion: version, migrated: true };
}
