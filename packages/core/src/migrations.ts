import { ArtifactError } from './errors.js';
import { t } from './i18n.js';
import type { AnyArtifactKind } from './kind.js';

export interface MigrationResult {
  content: unknown;
  schemaVersion: number;
  migrated: boolean;
}

/**
 * Migrates content in memory along the kind's migration chain (spec §6.3).
 * Persisting the migrated version only happens on the next commit.
 */
export function migrateContent(
  kind: AnyArtifactKind,
  content: unknown,
  schemaVersion: number,
  locale?: string,
): MigrationResult {
  if (schemaVersion > kind.version) {
    throw new ArtifactError(
      'UNSUPPORTED_VERSION',
      t(locale, 'UNSUPPORTED_VERSION', { found: schemaVersion, supported: kind.version, kind: kind.kind }),
      { details: { found: schemaVersion, supported: kind.version } },
    );
  }
  if (schemaVersion === kind.version) return { content, schemaVersion, migrated: false };
  let current = content;
  let version = schemaVersion;
  const chain = [...kind.migrations].sort((a, b) => a.from - b.from);
  while (version < kind.version) {
    const step = chain.find((migration) => migration.from === version);
    if (!step) {
      throw new ArtifactError(
        'MIGRATION_FAILED',
        t(locale, 'MIGRATION_FAILED', { from: version, to: version + 1 }),
      );
    }
    try {
      current = step.migrate(structuredClone(current));
    } catch (cause) {
      throw new ArtifactError(
        'MIGRATION_FAILED',
        t(locale, 'MIGRATION_FAILED', { from: step.from, to: step.to }),
        { cause },
      );
    }
    version = step.to;
  }
  return { content: current, schemaVersion: version, migrated: true };
}
