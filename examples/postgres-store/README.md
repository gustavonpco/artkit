# Postgres store (reference example)

A production-shaped `ArtifactStore` for PostgreSQL 14+ (spec §15.2). It is an example to copy into your
app, not a published package: it has no driver dependency and receives a `query(sql, params)` function.

- `schema.sql`: tables `artkit_artifacts` (head), `artkit_versions` (full content per version, operations,
  diff, periodic `snapshot` jsonb), `artkit_locks`, `artkit_assets` (metadata; bytes go to object storage),
  the idempotency unique index and the list indexes. Every key starts with `workspace_id`, and every query
  filters by it.
- `postgres-store.ts`: `createPostgresStore({ query, snapshotEvery?, now?, locale? })`.

## Design

- **Atomic without transactions.** Each mutation is one statement (data-modifying CTEs), so the head row and
  its version row change together.
- **Optimistic concurrency.** `commit` runs `UPDATE artkit_artifacts … WHERE version = $base`; under
  concurrent writers PostgreSQL re-checks the condition after the row lock, so exactly one wins and the
  others get `VERSION_CONFLICT`. The `(workspace_id, artifact_id, version)` primary key is a second guard.
- **Idempotency.** A partial unique index on `(workspace_id, artifact_id, idempotency_key)`.
- **Locks** are upserts that only replace an expired lock or one held by the same actor.
- **Storage cost.** Versions keep full content (jsonb is TOAST-compressed) so `get(id, { version })` is
  one row read. For very large, frequently edited artifacts you can null `content` on versions without a
  `snapshot` and rebuild them by replaying `operations` with `applyOperations` from `@artkit/core`.
- jsonb rejects the `\u0000` character; strip it from content before storing (kinds normally do).

## Usage

```ts
import pg from 'pg';
import { createArtifactService, createRegistry } from '@artkit/core';
import { createPostgresStore } from './postgres-store.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const store = createPostgresStore({ query: (sql, params) => pool.query(sql, params) });
const service = createArtifactService({ registry: createRegistry({ kinds: [documentKind] }), store });
```

## Running the contract suite against a real database

```bash
docker run --rm -d --name artkit-pg -e POSTGRES_PASSWORD=artkit -p 54329:5432 postgres:17
psql postgres://postgres:artkit@localhost:54329/postgres -f schema.sql
```

```ts
// postgres-store.test.ts (in your app, with vitest and pg installed)
import pg from 'pg';
import { afterAll, describe, it } from 'vitest';
import { defineStoreContractTests } from '@artkit/core/testing';
import { createPostgresStore } from './postgres-store.js';

const pool = new pg.Pool({ connectionString: 'postgres://postgres:artkit@localhost:54329/postgres' });
afterAll(() => pool.end());

// The suite uses fixed workspace ids, so every test starts from empty tables.
defineStoreContractTests(
  'postgres',
  async () => {
    await pool.query('TRUNCATE artkit_locks, artkit_versions, artkit_artifacts, artkit_assets');
    return createPostgresStore({ query: (sql, params) => pool.query(sql, params) });
  },
  { describe, it },
);
```

Run it with `vitest run postgres-store.test.ts` (tests in one file run sequentially, which the `TRUNCATE`
needs). This store passes the suite on PostgreSQL 17.
