# artkit playground

Browser playground (spec §22) running the whole pipeline in the page with the in-memory store: one artifact of each kind, the visual editors, an "agent view" with the projection a model reads, operation scenarios applied as the agent (with diff, lint and automatic rebase against your edits), version history and export.

```bash
pnpm install
pnpm --filter @artkit/example-playground dev   # http://localhost:5287
```

It resolves the workspace packages to their TypeScript sources (`@artkit/source` condition), so no build is needed. Everything resets on reload.
