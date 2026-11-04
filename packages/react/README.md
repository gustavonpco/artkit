# @artkit-ai/react

React layer for [artkit](../../docs/spec.md) artifacts (spec §13): provider, read-only views, kind editor host, assistant-style panel, chat card, approval screen, version diff, hooks and streaming preview.

The React layer never touches a store. It talks to an `ArtifactClient`: HTTP against the `@artkit-ai/node` routes, or an in-process `ArtifactService` for playgrounds, tests and local apps.

## Install

```bash
pnpm add @artkit-ai/react @artkit-ai/core react react-dom
# plus the kinds you show, e.g.
pnpm add @artkit-ai/kind-document
```

Requires React 19.

## Provider

```tsx
import { createRegistry } from '@artkit-ai/core';
import { documentKind } from '@artkit-ai/kind-document';
import { ArtifactProvider, createHttpClient } from '@artkit-ai/react';

const registry = createRegistry({ kinds: [documentKind] });
const client = createHttpClient({
  baseUrl: '/api/artifacts',
  headers: () => ({ Authorization: `Bearer ${token()}` }),
});

const loaders = {
  // Renderers load the first time a kind is shown.
  renderers: {
    document: () =>
      import('@artkit-ai/kind-document/react').then((m) => ({
        Renderer: m.DocumentRenderer,
        css: m.documentCss,
      })),
  },
  // Editors load only when the user enters edit mode (spec §13.6).
  editors: {
    document: () => import('@artkit-ai/kind-document/edit').then((m) => ({ Editor: m.DocumentEditor })),
  },
  // Exporters with runtime 'any' | 'browser' run in the browser; other formats go through the server.
  exporters: {
    document: () => import('@artkit-ai/kind-document/export').then((m) => m.documentExporters),
  },
};

export function App() {
  return (
    <ArtifactProvider
      registry={registry}
      client={client}
      loaders={loaders}
      locale="pt-BR"
      exportFormats={{ document: ['pdf'] }}
    >
      {/* … */}
    </ArtifactProvider>
  );
}
```

| Prop                            | Purpose                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `registry`                      | Core registry; kinds provide `parsePartial`, `apply`, `project`, `diff`, `lint`.    |
| `client`                        | `createHttpClient(...)` or `createServiceClient(service, scope)`.                   |
| `loaders`                       | Lazy `renderers`, `editors`, `exporters` per kind. Read once per kind.              |
| `locale`                        | UI locale (`pt-BR` and `en` built in). Artifacts keep their own locale for content. |
| `messages`                      | Extra or overriding UI strings per locale (`{ es: { tabHistory: 'Historial' } }`).  |
| `theme`, `themes`, `darkThemes` | Application theme, extra artifact themes, explicit dark variants.                   |
| `colorScheme`                   | `system` (default, follows `prefers-color-scheme`), `light` or `dark`.              |
| `resolveAssetUrl`, `assets`     | Asset lookup for renderers and for browser exports.                                 |
| `exportFormats`                 | Formats the server can export, per kind (shown in the export menu).                 |
| `injectStyles`, `nonce`         | Disable CSS injection, or pass a CSP nonce.                                         |

Without a renderer loader a kind is shown as formatted JSON; without an editor loader `ArtifactEditor` falls back to `ArtifactView`.

## Components

```tsx
<ArtifactCard artifact={summary} onOpen={(a) => setOpen(a.id)} streaming={isStreaming} />
<ArtifactPanel id={openId} permission="edit" onClose={() => setOpen(undefined)} />
<ArtifactView artifact={artifact} />
<ArtifactView kind="document" partial={streamedJsonOrObject} />
<ArtifactEditor id={id} groupingWindowMs={600} onCommitted={(r) => console.log(r.version)} />
<ArtifactApproval id={id} onApproved={…} onRejected={(a, reason) => …} />
<ArtifactVersionDiff id={id} from={3} to={5} defaultLayout="split" />
```

- **`ArtifactView`**: read-only by kind. Takes `artifact`, or `id` (+ `version`). `partial` accepts a partial object or the raw JSON text streamed so far (parsed with `parsePartialJson`, then `kind.parsePartial`); it renders with a "provisional" badge and is replaced as soon as a newer committed version arrives (spec §13.4).
- **`ArtifactEditor`**: hosts the kind editor (see below). `permission="read"`, a missing editor loader or `lockedBy` (another actor holds the lock; `partial` then shows the streaming preview) render the view instead.
- **`ArtifactPanel`**: View / Code (formatted JSON, read-only) / History tabs, version selector, export menu, status badge and lifecycle actions (submit, approve, reject with reason, publish, archive). Tabs and menus follow the WAI-ARIA keyboard patterns.
- **`ArtifactCard`**: compact card for chat messages: title, kind, version, status, open action (button or `href`).
- **`ArtifactApproval`**: diff of the pending version against `meta.publishedVersion` (or the previous version) with approve and reject (reason required by default).
- **`ArtifactVersionDiff`**: structural `ChangeSummary` list from `kind.diff` plus a highlighted or side-by-side line diff of the full projections.

## Editor host

Kind editors receive `EditorBindings` and only emit operations. `ArtifactEditor` (backed by the framework-free `EditorSession`) provides, for every kind:

1. **Grouping** — operations emitted with `{ kind: 'typing' }` are coalesced within `groupingWindowMs` (default 600 ms, capped at 5 s of continuous typing); discrete operations and the end of continuous gestures flush immediately. Typing is also flushed on blur and unmount.
2. **Optimistic apply** with the kind's own logic (`applyOperations`); invalid operations are rejected locally. Batches are sent one at a time with `baseVersion`. On rejection the editor rolls back to the last confirmed version and shows the error.
3. **Undo/redo** (buttons, `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`, `Ctrl+Y`) over the user's own batches. Kinds have no inverse operations, so **undo sends `replace_content` with the content before the batch** (plus `set_title`/`set_theme`/`set_locale` when those changed); each undo/redo is a new version (spec §8.5). When the artifact changed after the batch (e.g. the agent edited it), undo becomes a conflict instead of silently discarding the newer change.
4. **Concurrent edits** — newer versions arriving while editing rebase the pending local operations. On `VERSION_CONFLICT` (or a rebase that no longer applies) the editor shows what changed and offers **Keep agent version** or **Reapply my edit**.
5. **Locks** — a `LOCKED` rejection makes the editor read-only until the lock expires; the `lockedBy` prop does the same up front.
6. **Permissions** — `permission="read" | "edit"` (comment mode is phase 3).
7. **Accessibility** — keyboard operation, visible focus, live-region announcements (saved, undone, conflict, rejection).

Ids generated by the server for operations without explicit ids match the local ones only when nothing else changed in between; editors should pass explicit ids for new items.

## Hooks

```ts
const { artifact, loading, error, refresh } = useArtifact(id, { version, initial });
const { entries, hasMore, loadMore, restore } = useArtifactHistory(id);
const { apply, pending, error, conflict, retry } = useApplyOperations(id);
const { exportArtifact, formats, loadFormats, warnings } = useArtifactExport(id);
```

- `useArtifact` shares a cache per client. Specific versions are immutable and never refetched; the latest version is revalidated on mount and moves forward with every commit made through the hooks/components.
- `useApplyOperations` sends `baseVersion` (default: latest cached) and an idempotency key; on `VERSION_CONFLICT` it exposes `conflict.changes` and `retry()` on the latest version.
- `useArtifactExport` exports in the browser when a loaded exporter with runtime `any`/`browser` handles the format, otherwise calls `client.export`, then triggers a download (`download: false` to skip).

## Client

```ts
createHttpClient({ baseUrl = '/api/artifacts', fetch?, headers?, credentials? });
createServiceClient(service, scope /* or () => scope */);
```

Both implement `ArtifactClient`: `list`, `create`, `get`, `read`, `apply`, `preview`, `history`, `restore`, `setStatus(id, action, message?)`, `lock`, `unlock`, `export → { bytes, mimeType, filename, warnings }`. The HTTP client follows the contract in `docs/CONVENTIONS.md` and turns error responses back into `ArtifactError` (`code`, `issues`, `details`; status-based fallback when the body is not a payload). For cross-origin APIs expose `Content-Disposition` and `X-Artkit-Warnings` through `Access-Control-Expose-Headers`.

## Styling

All classes use the `ak-` prefix and colors come from CSS variables (`--ak-color-accent`, `--ak-font-body`…) derived from the artifact and application themes via `themeCssVariables`. The provider injects `<style>` elements (React 19 hoisted and deduplicated, so each is added once) with `artkitCss`, the theme variables (light, plus dark derived automatically or from `darkThemes`) and each loaded kind's CSS. Dark mode follows `prefers-color-scheme` unless `data-theme="light"|"dark"` is set on an ancestor or through `colorScheme`.

Every component accepts `className` and `slots` — per-part `{ className, style }` overrides (e.g. `slots={{ body: { className: 'my-body' } }}`) — so it can be customized without forking. Apps that ship their own CSS can pass `injectStyles={false}` and import `artkitCss`/`themeStyles`.

## i18n

UI strings ship in pt-BR and en (`uiMessages`); `locale` picks the catalog (`pt*` → pt-BR, anything else → en) and `messages` adds or overrides strings for any locale. Dates use `Intl` with the UI locale; artifact content keeps the artifact's own `locale`.

## License

Apache-2.0
