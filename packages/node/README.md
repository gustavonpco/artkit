# @artkit/node

Node adapters for artkit: filesystem stores, a content-addressed asset store, export orchestration,
fetch-standard HTTP routes and headless PNG/PDF rendering. Node 22+.

```bash
npm install @artkit/core @artkit/node
# headless PNG/PDF only:
npm install react react-dom playwright && npx playwright install chromium
```

## Stores

```ts
import { createArtifactService, createRegistry } from '@artkit/core';
import { createFsAssetStore, createFsStore } from '@artkit/node';

const service = createArtifactService({
  registry: createRegistry({ kinds: [documentKind] }),
  store: createFsStore({ dir: './data/artifacts', snapshotEvery: 10 }),
  assets: createFsAssetStore({ dir: './data/assets', policy: { maxBytes: 5 * 1024 * 1024 } }),
});
```

- `createMemoryStore` / `createMemoryAssetStore` are re-exported from `@artkit/core`. They live in the core so
  they also run in browsers, edge runtimes and workers (tests, playgrounds, prototypes).
- `createFsStore({ dir, snapshotEvery?, now?, locale? })` passes the core store contract suite. One directory
  per workspace (sha256 of the id) and artifact; ids are checked against the `art_<ULID>` pattern before any
  path is built. Superseded versions are immutable files, the history keeps a snapshot every N versions,
  idempotency keys are indexed, locks expire. Every write is atomic (temp file, fsync, rename) and commits to
  one artifact are serialized by an in-process mutex, so a stale `baseVersion` gets `VERSION_CONFLICT`.
  It assumes **one writing process** per directory; use a database store when several processes write
  (see [`examples/postgres-store`](../../examples/postgres-store)).
- `createFsAssetStore({ dir, policy?, publicUrl? })` validates with the core `checkAsset` (magic-byte MIME
  sniffing, size, allowlist, SVG sanitizing, allowed domains), stores bytes once per workspace under their
  sha256 and never overwrites them. `url()` returns `publicUrl(ref, { scope, ttlSeconds, mimeType })` when
  configured (e.g. a signed route of your app), otherwise a data URL.

## Export

```ts
import { exportArtifact, writeExportFile } from '@artkit/node';

const result = await exportArtifact(service, scope, { artifactId, format: 'pdf', timeoutMs: 30_000, signal });
const path = await writeExportFile(result, { dir: './out' }); // fails if the file exists unless overwrite: true
```

`exportArtifact` runs `service.export` (exporter lookup, migration, theme, locale, assets, timeout, abort) and,
with `saveToAssets: true`, stores the file in `request.assets` or the service's asset store, failing loudly
when there is none. The asset policy still applies: by default only images (and PDF when allowed) are
accepted.

## HTTP routes

```ts
import { createServer } from 'node:http';
import { createArtifactRoutes, toNodeHandler } from '@artkit/node';

const routes = createArtifactRoutes({
  service,
  resolveScope: async (request) => {
    const session = await auth(request); // your authentication
    if (!session) return new Response('Unauthorized', { status: 401 });
    return { workspaceId: session.workspaceId, actor: { type: 'user', id: session.userId } };
  },
  basePath: '/api/artifacts',
  maxBodyBytes: 6 * 1024 * 1024,
});

createServer(toNodeHandler(routes)).listen(3000);
// Next.js / Hono / Bun: export const POST = (req: Request) => routes(req).then((r) => r ?? new Response(null, { status: 404 }));
// Express: app.use(toNodeHandler(routes)) (mount before body parsers; parsed req.body is also accepted)
```

The handler implements the HTTP contract in `docs/CONVENTIONS.md` and resolves `undefined` for paths it does
not own (OPTIONS too, so CORS stays with your app). Known paths with another method get `405` and `Allow`.
Errors return the `ModelErrorPayload` with the contract status (`NOT_FOUND` 404, `PERMISSION_DENIED` and
`APPROVAL_REQUIRED` 403, `VERSION_CONFLICT` 409, `LOCKED` 423, `LIMIT_EXCEEDED` 413, validation codes 422,
`EXPORT_FAILED`/`INTERNAL_ERROR` 500). Request validation failures are `INVALID_OPERATION` (422) with one issue
per field (`baseVersion`, `query.limit`, `body`…). Bodies must be `application/json`, which also blocks
cross-site form posts; workspace and actor always come from `resolveScope`, never from the body. Lock TTLs are
capped by `maxLockTtlMs` (default 1 hour). Exports stream the bytes with `Content-Type`,
`Content-Disposition` and `X-Artkit-Warnings` (URI-encoded JSON array) and are aborted when the client
disconnects. Pass a `logger` to receive metadata-only error logs.

## Headless PNG/PDF (`@artkit/node/headless`)

```ts
import { createHeadlessExporters, createHeadlessRenderer } from '@artkit/node/headless';
import { DocumentRenderer, documentCss } from '@artkit/kind-document/react';

const renderer = createHeadlessRenderer({ concurrency: 2, pageTimeoutMs: 30_000 });
for (const exporter of createHeadlessExporters({
  renderer,
  kinds: [
    { kind: 'document', render: (content, ctx) => <DocumentRenderer content={content} ctx={ctx} />, css: documentCss, formats: ['pdf', 'png'], page: 'A4' },
    { kind: 'slides', render: renderSlides, css: slidesCss, formats: ['pdf', 'png'], page: { width: 1280, height: 720 } },
  ],
})) registry.registerExporter(exporter);
// on shutdown: await renderer.close();
```

- Each export resolves the `asset://` references found in the content through `ctx.assets`, inlines them as
  data URLs (`ctx.resolveAssetUrl`), renders the element with `react-dom/server` in `mode: 'print'`, and wraps
  it with the theme variables (`themeCssText`), the kind CSS and a CSP that only allows inline styles and data
  URLs. Assets that cannot be loaded render as placeholders and add a warning.
- The renderer keeps one Chromium (relaunched after a crash and every `recycleAfter` renders), runs at most
  `concurrency` pages (FIFO queue), applies `pageTimeoutMs` per render and the caller's `AbortSignal`, and
  isolates each render in a fresh context with JavaScript disabled, offline mode and every request aborted.
- **PDF** uses the CSS page size (`A4`, `Letter` or `{ width, height }` in CSS pixels), one PDF page per printed
  page. **PNG** is a single screenshot of the full page height at the page width: multi-page content becomes one
  tall image with the pages stacked. Use `scale` for higher pixel density.
- `playwright`, `react` and `react-dom` are optional peers loaded on first use, with a clear error when missing.
  Pass `launch` (any implementation of the small `HeadlessBrowser` interface) to use another driver, or
  `createPlaywrightLauncher({ launchOptions: { executablePath } })` for a custom Chromium.

## License

Apache-2.0
