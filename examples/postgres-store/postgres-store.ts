import { randomUUID } from 'node:crypto';
import {
  type Actor,
  type Artifact,
  ArtifactError,
  type ArtifactStatus,
  type ArtifactStore,
  type ArtifactSummary,
  type ChangeSummary,
  createArtifactId,
  type Lock,
  type Scope,
  t,
  type VersionEntry,
} from '@artkit-ai/core';

/**
 * Runs one parameterized statement. Matches `pg`'s `pool.query(sql, params)`; wrap other drivers
 * (postgres.js, Kysely, Drizzle) in a function with this shape.
 */
export type QueryFn = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface PostgresStoreOptions {
  query: QueryFn;
  /** History snapshot every N versions (the first version always has one). Default 10. */
  snapshotEvery?: number;
  now?: () => Date;
  locale?: string;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 500;
const UNIQUE_VIOLATION = '23505';

interface ArtifactRow {
  id: string;
  kind: string;
  schema_version: number;
  version: number;
  title: string;
  status: ArtifactStatus;
  locale: string;
  theme_id: string;
  content: unknown;
  tags: string[];
  published_version: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  created_by: Actor;
  updated_by: Actor;
}

interface VersionRow {
  version: number;
  schema_version: number;
  status: ArtifactStatus;
  operations: unknown[];
  diff: ChangeSummary[];
  created_ids: string[];
  snapshot: { schemaVersion: number; content: unknown } | null;
  actor: Actor;
  message: string | null;
  idempotency_key: string | null;
  restored_from: number | null;
  created_at: Date | string;
}

interface LockRow {
  artifact_id: string;
  holder_type: Actor['type'];
  holder_id: string;
  token: string;
  expires_at: Date | string;
}

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const jsonParam = (value: unknown): string => JSON.stringify(value ?? null);

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    kind: row.kind,
    schemaVersion: row.schema_version,
    version: row.version,
    title: row.title,
    status: row.status,
    locale: row.locale,
    themeId: row.theme_id,
    content: row.content,
    meta: {
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      tags: row.tags ?? [],
      ...(row.published_version ? { publishedVersion: row.published_version } : {}),
    },
  };
}

function toEntry(row: VersionRow): VersionEntry {
  return {
    version: row.version,
    actor: row.actor,
    createdAt: iso(row.created_at),
    operations: row.operations,
    diff: row.diff,
    createdIds: row.created_ids,
    status: row.status,
    ...(row.message ? { message: row.message } : {}),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    ...(row.restored_from ? { restoredFrom: row.restored_from } : {}),
    ...(row.snapshot ? { snapshot: row.snapshot } : {}),
  };
}

function toLock(row: LockRow): Lock {
  return {
    artifactId: row.artifact_id,
    holder: { type: row.holder_type, id: row.holder_id },
    token: row.token,
    expiresAt: iso(row.expires_at),
  };
}

const ARTIFACT_COLUMNS = `id, kind, schema_version, version, title, status, locale, theme_id, content, tags,
  published_version, created_at, updated_at, created_by, updated_by`;

const ENTRY_COLUMNS = `version, schema_version, status, operations, diff, created_ids, snapshot, actor, message,
  idempotency_key, restored_from, created_at`;

/**
 * Reference `ArtifactStore` over PostgreSQL (spec §15.2). Every mutation is a single statement, so it is
 * atomic without explicit transactions; commits use optimistic concurrency (`UPDATE … WHERE version =
 * $base`) backed by the (workspace_id, artifact_id, version) primary key.
 */
export function createPostgresStore(options: PostgresStoreOptions): ArtifactStore {
  const { query } = options;
  const now = options.now ?? (() => new Date());
  const snapshotEvery = Math.max(1, options.snapshotEvery ?? 10);
  const locale = options.locale;

  const notFound = (id: string): never => {
    throw new ArtifactError('NOT_FOUND', t(locale, 'NOT_FOUND', { what: 'Artifact', id }));
  };

  const conflict = (baseVersion: number, currentVersion: number) =>
    new ArtifactError('VERSION_CONFLICT', t(locale, 'VERSION_CONFLICT', { baseVersion, currentVersion }), {
      details: { currentVersion },
    });

  async function headVersion(scope: Scope, id: string): Promise<number> {
    const { rows } = await query('SELECT version FROM artkit_artifacts WHERE workspace_id = $1 AND id = $2', [
      scope.workspaceId,
      id,
    ]);
    const row = rows[0] as { version: number } | undefined;
    return row ? row.version : notFound(id);
  }

  function paging(page: { limit?: number; cursor?: string }) {
    const offset = page.cursor ? Math.max(0, Math.floor(Number(page.cursor)) || 0) : 0;
    const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_PAGE), MAX_PAGE);
    return { offset, limit };
  }

  const isUniqueViolation = (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;

  const store: ArtifactStore = {
    async get(scope, id, opts) {
      if (opts?.version === undefined) {
        const { rows } = await query(
          `SELECT ${ARTIFACT_COLUMNS} FROM artkit_artifacts WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, id],
        );
        return rows[0] ? toArtifact(rows[0] as unknown as ArtifactRow) : null;
      }
      // Older versions: per-version fields from artkit_versions, identity fields from the artifact.
      const { rows } = await query(
        `SELECT a.id, a.kind, v.schema_version, v.version, v.title, v.status, v.locale, v.theme_id, v.content, a.tags,
                v.published_version, a.created_at, v.updated_at, a.created_by, v.updated_by
           FROM artkit_versions v
           JOIN artkit_artifacts a ON a.workspace_id = v.workspace_id AND a.id = v.artifact_id
          WHERE v.workspace_id = $1 AND v.artifact_id = $2 AND v.version = $3`,
        [scope.workspaceId, id, opts.version],
      );
      return rows[0] ? toArtifact(rows[0] as unknown as ArtifactRow) : null;
    },

    async create(scope, input) {
      const at = now();
      const id = createArtifactId(at.getTime());
      const { rows } = await query(
        `WITH a AS (
           INSERT INTO artkit_artifacts (workspace_id, id, kind, schema_version, version, title, status, locale, theme_id,
                                         content, tags, created_at, updated_at, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9::jsonb, $10::text[], $11, $11, $12::jsonb, $12::jsonb)
           RETURNING *
         ), v AS (
           INSERT INTO artkit_versions (workspace_id, artifact_id, version, schema_version, title, locale, theme_id, status,
                                        content, snapshot, created_ids, actor, message, idempotency_key, created_at,
                                        updated_at, updated_by)
           SELECT workspace_id, id, 1, schema_version, title, locale, theme_id, status, content,
                  jsonb_build_object('schemaVersion', schema_version, 'content', content), $13::jsonb, $12::jsonb,
                  $14, $15, $11, $11, $12::jsonb
             FROM a
         )
         SELECT ${ARTIFACT_COLUMNS} FROM a`,
        [
          scope.workspaceId,
          id,
          input.kind,
          input.schemaVersion,
          input.title,
          input.status,
          input.locale,
          input.themeId,
          jsonParam(input.content),
          input.tags ?? [],
          at.toISOString(),
          jsonParam(scope.actor),
          jsonParam(input.createdIds ?? []),
          input.message ?? null,
          input.idempotencyKey ?? null,
        ],
      );
      return toArtifact(rows[0] as unknown as ArtifactRow);
    },

    async commit(scope, id, change) {
      const at = now().toISOString();
      let rows: Record<string, unknown>[];
      try {
        ({ rows } = await query(
          `WITH head AS (
             UPDATE artkit_artifacts
                SET schema_version = $4, version = version + 1, title = $5, locale = $6, theme_id = $7,
                    status = COALESCE($8, status), content = $9::jsonb, updated_at = $10, updated_by = $11::jsonb
              WHERE workspace_id = $1 AND id = $2 AND version = $3
             RETURNING *
           ), v AS (
             INSERT INTO artkit_versions (workspace_id, artifact_id, version, schema_version, title, locale, theme_id,
                                          status, published_version, content, snapshot, operations, diff, created_ids,
                                          actor, message, idempotency_key, restored_from, created_at, updated_at,
                                          updated_by)
             SELECT workspace_id, id, version, schema_version, title, locale, theme_id, status, published_version,
                    content,
                    CASE WHEN version % $12 = 0
                         THEN jsonb_build_object('schemaVersion', schema_version, 'content', content) END,
                    $13::jsonb, $14::jsonb, $15::jsonb, $11::jsonb, $16, $17, $18, $10, $10, $11::jsonb
               FROM head
           )
           SELECT ${ARTIFACT_COLUMNS} FROM head`,
          [
            scope.workspaceId,
            id,
            change.baseVersion,
            change.schemaVersion,
            change.title,
            change.locale,
            change.themeId,
            change.status ?? null,
            jsonParam(change.content),
            at,
            jsonParam(scope.actor),
            snapshotEvery,
            jsonParam(change.operations),
            jsonParam(change.diff),
            jsonParam(change.createdIds ?? []),
            change.message ?? null,
            change.idempotencyKey ?? null,
            change.restoredFrom ?? null,
          ],
        ));
      } catch (error) {
        // A concurrent writer created the same version (or reused the idempotency key) first.
        if (isUniqueViolation(error)) throw conflict(change.baseVersion, await headVersion(scope, id));
        throw error;
      }
      if (rows[0]) return toArtifact(rows[0] as unknown as ArtifactRow);
      // Nothing updated: either the artifact is not in this workspace or baseVersion is stale.
      throw conflict(change.baseVersion, await headVersion(scope, id));
    },

    async history(scope, id, page) {
      const total = await headVersion(scope, id);
      const { offset, limit } = paging(page);
      const { rows } = await query(
        `SELECT ${ENTRY_COLUMNS} FROM artkit_versions
          WHERE workspace_id = $1 AND artifact_id = $2
          ORDER BY version DESC LIMIT $3 OFFSET $4`,
        [scope.workspaceId, id, limit, offset],
      );
      const items = rows.map((row) => toEntry(row as unknown as VersionRow));
      return offset + limit < total ? { items, nextCursor: String(offset + limit) } : { items };
    },

    async list(scope, filter, page) {
      const { offset, limit } = paging(page);
      // One extra row tells whether there is a next page without a count(*).
      const { rows } = await query(
        `SELECT id, kind, title, version, status, locale, updated_at FROM artkit_artifacts
          WHERE workspace_id = $1
            AND ($2::text IS NULL OR kind = $2)
            AND ($3::text IS NULL OR status = $3)
            AND ($4::text IS NULL OR strpos(lower(title), lower($4)) > 0)
            AND ($5::text IS NULL OR $5 = ANY (tags))
          ORDER BY updated_at DESC, id DESC
          LIMIT $6 OFFSET $7`,
        [
          scope.workspaceId,
          filter.kind ?? null,
          filter.status ?? null,
          filter.title || null,
          filter.tag ?? null,
          limit + 1,
          offset,
        ],
      );
      const items: ArtifactSummary[] = rows.slice(0, limit).map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        title: row.title as string,
        version: row.version as number,
        status: row.status as ArtifactStatus,
        locale: row.locale as string,
        updatedAt: iso(row.updated_at as Date | string),
      }));
      return rows.length > limit ? { items, nextCursor: String(offset + limit) } : { items };
    },

    async setStatus(scope, id, status, actor) {
      const { rows } = await query(
        `WITH a AS (
           UPDATE artkit_artifacts
              SET status = $3, updated_at = $4, updated_by = $5::jsonb,
                  published_version = CASE WHEN $3 = 'published' THEN version ELSE published_version END
            WHERE workspace_id = $1 AND id = $2
           RETURNING *
         ), v AS (
           UPDATE artkit_versions v
              SET status = a.status, published_version = a.published_version, updated_at = a.updated_at,
                  updated_by = a.updated_by
             FROM a
            WHERE v.workspace_id = a.workspace_id AND v.artifact_id = a.id AND v.version = a.version
         )
         SELECT ${ARTIFACT_COLUMNS} FROM a`,
        [scope.workspaceId, id, status, now().toISOString(), jsonParam(actor)],
      );
      return rows[0] ? toArtifact(rows[0] as unknown as ArtifactRow) : notFound(id);
    },

    async lock(scope, id, actor, ttlMs) {
      const at = now();
      const { rows } = await query(
        `INSERT INTO artkit_locks AS l (workspace_id, artifact_id, holder_type, holder_id, token, expires_at)
         SELECT $1, $2, $3, $4, $5, $6
          WHERE EXISTS (SELECT 1 FROM artkit_artifacts WHERE workspace_id = $1 AND id = $2)
         ON CONFLICT (workspace_id, artifact_id) DO UPDATE
            SET holder_type = EXCLUDED.holder_type, holder_id = EXCLUDED.holder_id, token = EXCLUDED.token,
                expires_at = EXCLUDED.expires_at
          WHERE l.expires_at <= $7 OR (l.holder_type = EXCLUDED.holder_type AND l.holder_id = EXCLUDED.holder_id)
         RETURNING artifact_id, holder_type, holder_id, token, expires_at`,
        [
          scope.workspaceId,
          id,
          actor.type,
          actor.id,
          randomUUID(),
          new Date(at.getTime() + ttlMs).toISOString(),
          at.toISOString(),
        ],
      );
      if (rows[0]) return toLock(rows[0] as unknown as LockRow);
      await headVersion(scope, id);
      const existing = await store.getLock(scope, id);
      const holder = existing ? `${existing.holder.type}:${existing.holder.id}` : 'unknown';
      const expiresAt = existing?.expiresAt ?? at.toISOString();
      throw new ArtifactError('LOCKED', t(locale, 'LOCKED', { holder, expiresAt }), {
        details: { expiresAt },
      });
    },

    async unlock(scope, lock) {
      await headVersion(scope, lock.artifactId);
      await query('DELETE FROM artkit_locks WHERE workspace_id = $1 AND artifact_id = $2 AND token = $3', [
        scope.workspaceId,
        lock.artifactId,
        lock.token,
      ]);
    },

    async getLock(scope, id) {
      await headVersion(scope, id);
      const { rows } = await query(
        `SELECT artifact_id, holder_type, holder_id, token, expires_at FROM artkit_locks
          WHERE workspace_id = $1 AND artifact_id = $2 AND expires_at > $3`,
        [scope.workspaceId, id, now().toISOString()],
      );
      return rows[0] ? toLock(rows[0] as unknown as LockRow) : null;
    },

    async findByIdempotencyKey(scope, id, key) {
      await headVersion(scope, id);
      const { rows } = await query(
        `SELECT ${ENTRY_COLUMNS} FROM artkit_versions
          WHERE workspace_id = $1 AND artifact_id = $2 AND idempotency_key = $3`,
        [scope.workspaceId, id, key],
      );
      return rows[0] ? toEntry(rows[0] as unknown as VersionRow) : null;
    },
  };
  return store;
}
