-- artkit reference schema for PostgreSQL 14+ (spec §15.2).
-- Every table is keyed by workspace_id first: every query filters by it, so an id alone never grants access.

CREATE TABLE IF NOT EXISTS artkit_artifacts (
  workspace_id      text        NOT NULL,
  id                text        NOT NULL CHECK (id ~ '^art_[0-9A-HJKMNP-TV-Z]{26}$'),
  kind              text        NOT NULL,
  schema_version    integer     NOT NULL CHECK (schema_version >= 1),
  -- Current version; commits use it for optimistic concurrency (UPDATE … WHERE version = $base).
  version           integer     NOT NULL CHECK (version >= 1),
  title             text        NOT NULL,
  status            text        NOT NULL CHECK (status IN ('draft', 'pending_approval', 'published', 'archived')),
  locale            text        NOT NULL,
  theme_id          text        NOT NULL,
  content           jsonb       NOT NULL,
  tags              text[]      NOT NULL DEFAULT '{}',
  published_version integer     CHECK (published_version >= 1),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  created_by        jsonb       NOT NULL,
  updated_by        jsonb       NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

-- list(): newest first inside a workspace, optionally by kind or status.
CREATE INDEX IF NOT EXISTS artkit_artifacts_recent_idx ON artkit_artifacts (workspace_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS artkit_artifacts_kind_idx ON artkit_artifacts (workspace_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS artkit_artifacts_status_idx ON artkit_artifacts (workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS artkit_artifacts_tags_idx ON artkit_artifacts USING gin (tags);

CREATE TABLE IF NOT EXISTS artkit_versions (
  workspace_id      text        NOT NULL,
  artifact_id       text        NOT NULL,
  version           integer     NOT NULL CHECK (version >= 1),
  schema_version    integer     NOT NULL,
  title             text        NOT NULL,
  locale            text        NOT NULL,
  theme_id          text        NOT NULL,
  -- Status and published version of this version; the head row follows setStatus.
  status            text        NOT NULL,
  published_version integer,
  -- Full content of the version, so get(id, { version }) is a single row read.
  content           jsonb       NOT NULL,
  -- History snapshot { schemaVersion, content } on version 1 and every N versions (spec §8.5).
  snapshot          jsonb,
  operations        jsonb       NOT NULL DEFAULT '[]',
  diff              jsonb       NOT NULL DEFAULT '[]',
  created_ids       jsonb       NOT NULL DEFAULT '[]',
  actor             jsonb       NOT NULL,
  message           text,
  idempotency_key   text,
  restored_from     integer,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  updated_by        jsonb       NOT NULL,
  -- Second line of defense: two writers can never both create the same version.
  PRIMARY KEY (workspace_id, artifact_id, version),
  FOREIGN KEY (workspace_id, artifact_id) REFERENCES artkit_artifacts (workspace_id, id) ON DELETE CASCADE
);

-- findByIdempotencyKey(): one commit per key and artifact.
CREATE UNIQUE INDEX IF NOT EXISTS artkit_versions_idempotency_idx
  ON artkit_versions (workspace_id, artifact_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS artkit_locks (
  workspace_id text        NOT NULL,
  artifact_id  text        NOT NULL,
  holder_type  text        NOT NULL CHECK (holder_type IN ('agent', 'user', 'system')),
  holder_id    text        NOT NULL,
  token        text        NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, artifact_id),
  FOREIGN KEY (workspace_id, artifact_id) REFERENCES artkit_artifacts (workspace_id, id) ON DELETE CASCADE
);

-- Asset metadata. Bytes live in object storage (S3, MinIO, GCS) under storage_key; ids are sha256 prefixes.
CREATE TABLE IF NOT EXISTS artkit_assets (
  workspace_id text        NOT NULL,
  id           text        NOT NULL CHECK (id ~ '^[0-9a-f]{24}$'),
  hash         text        NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  mime_type    text        NOT NULL,
  size         bigint      NOT NULL CHECK (size > 0),
  filename     text,
  storage_key  text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   jsonb       NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS artkit_assets_hash_idx ON artkit_assets (workspace_id, hash);
