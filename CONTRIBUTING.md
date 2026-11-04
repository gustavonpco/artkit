# Contributing to artkit

Thanks for helping. Before you start, read [docs/spec.md](docs/spec.md) (the specification, in Portuguese) and [docs/CONVENTIONS.md](docs/CONVENTIONS.md) (how the code is organized).

## Setup

Requirements: Node 22+ and pnpm 10.

```bash
pnpm install
pnpm build
pnpm test
```

## Everyday commands

```bash
pnpm vitest run packages/kind-sheet              # tests of one package
pnpm vitest run packages/core/test/engine.test.ts -t "rebase"   # a single test
pnpm exec tsc -b packages/kind-sheet             # typecheck one package
pnpm lint                                        # Biome
pnpm check:deps                                  # dependency rules (spec §5.3)
pnpm check:licenses                              # dependency licenses (spec §5.4)
```

## Pull requests

- Keep changes focused; add tests for every new operation, rule or bug fix (including rejection cases with the expected error code and path).
- Add a changeset for anything that affects a published package: `pnpm changeset`.
- `pnpm verify` must pass locally (build, lint, tests, dependency, license and publish checks).
- New dependencies need a technical reason and an Apache-2.0-compatible license. HyperFormula, BlockNote XL, PPTist, tldraw and TipTap Pro extensions are not allowed.

## Changes to the data standard

The artifact data standard (envelope, kind schemas, operations, projection, errors) changes through an RFC: open an issue labelled `rfc` describing the change, its migration and its impact on models, and leave it open for public comments before implementation. Removing, renaming or changing the meaning of a field requires a new `schemaVersion` with a migration (spec §6.3).

## Contributor terms

Contributions are accepted under the Apache-2.0 license. Sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/). The project may adopt a CLA before the first public release (spec §27); if so, it will be announced here.
