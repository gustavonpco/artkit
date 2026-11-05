import type { AnyFormatAdapter, FormatAdapter } from '../adapter.js';
import { deepEqual } from '../diff.js';
import { applyOperations, prepareContent } from '../engine.js';
import { ArtifactError } from '../errors.js';
import { createRegistry } from '../registry.js';
import type { ArtifactStore, Commit, NewArtifact, Scope } from '../store.js';
import { defaultTheme } from '../theme.js';

/** Minimal test API so the suites work with vitest, jest or node:test. */
export interface TestApi {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => unknown | Promise<unknown>): void;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof ArtifactError, `expected ArtifactError(${code}), got ${String(error)}`);
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

const scopeA: Scope = { workspaceId: 'ws_a', actor: { type: 'user', id: 'usr_1' } };
const scopeB: Scope = { workspaceId: 'ws_b', actor: { type: 'user', id: 'usr_2' } };

const sample: NewArtifact = {
  format: 'contract-text',
  formatVersion: 'contract@1',
  title: 'Contract test',
  locale: 'en',
  themeId: 'default',
  content: 'hello',
  tags: ['contract'],
};

function commitFrom(baseVersion: number, text = 'v2'): Commit {
  return {
    baseVersion,
    formatVersion: 'contract@1',
    content: text,
    title: 'Contract test',
    locale: 'en',
    themeId: 'default',
  };
}

/**
 * Shared contract suite every `ArtifactStore` adapter must pass (spec §17.1).
 * `factory` must return a fresh, empty store for each test.
 */
export function defineStoreContractTests(
  name: string,
  factory: () => ArtifactStore | Promise<ArtifactStore>,
  test: TestApi,
): void {
  test.describe(`ArtifactStore contract: ${name}`, () => {
    test.it('creates version 1 with an art_ ULID id', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      assert(/^art_[0-9A-HJKMNP-TV-Z]{26}$/.test(created.id), `bad id ${created.id}`);
      assert(created.version === 1, 'version must start at 1');
      assert(created.meta.createdBy.id === 'usr_1', 'createdBy must come from scope');
      const loaded = await store.get(scopeA, created.id);
      assert(deepEqual(loaded?.content, sample.content), 'content must round-trip');
    });

    test.it('isolates workspaces', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      assert((await store.get(scopeB, created.id)) === null, 'other workspace must not read');
      await expectCode(store.commit(scopeB, created.id, commitFrom(1)), 'NOT_FOUND');
      const list = await store.list(scopeB, {}, {});
      assert(list.items.length === 0, 'other workspace must not list');
    });

    test.it('commits with optimistic versioning', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      const v2 = await store.commit(scopeA, created.id, commitFrom(1, 'v2'));
      assert(v2.version === 2, 'second version');
      assert(v2.content === 'v2', 'the current content is replaced');
      await expectCode(store.commit(scopeA, created.id, commitFrom(1, 'stale')), 'VERSION_CONFLICT');
      const current = await store.get(scopeA, created.id);
      assert(current?.content === 'v2', 'a rejected commit leaves the current content untouched');
    });

    test.it('filters the list by format and tag', async () => {
      const store = await factory();
      await store.create(scopeA, sample);
      await store.create(scopeA, { ...sample, format: 'contract-other', title: 'Other', tags: [] });
      const onlyText = await store.list(scopeA, { format: 'contract-text' }, {});
      assert(onlyText.items.length === 1, 'format filter must narrow the list');
      const tagged = await store.list(scopeA, { tag: 'contract' }, {});
      assert(tagged.items.length === 1, 'tag filter must narrow the list');
    });

    test.it('locks are exclusive to other actors', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      const lock = await store.lock(scopeA, created.id, scopeA.actor, 60_000);
      const other = { type: 'agent' as const, id: 'agt_1' };
      await expectCode(store.lock(scopeA, created.id, other, 60_000), 'LOCKED');
      await store.unlock(scopeA, lock);
      assert((await store.getLock(scopeA, created.id)) === null, 'unlock must release');
    });
  });
}

export interface FormatFixture {
  title: string;
  content: unknown;
  /** Batches that must apply deterministically on this fixture. */
  batches?: unknown[][];
  /** Batches that must be rejected, with the expected error code. */
  rejects?: { operations: unknown[]; code: string }[];
}

/**
 * Shared conformance suite every format adapter must pass (spec §8 and §22): examples in the instructions are valid,
 * fixtures validate and read with ids, `apply` is deterministic, pure and atomic, and migrations form a chain.
 */
export function defineFormatConformanceTests(
  adapter: AnyFormatAdapter,
  fixtures: FormatFixture[],
  test: TestApi,
): void {
  const registry = createRegistry({ formats: [adapter] });
  const ctx = { locale: 'en', theme: defaultTheme };

  test.describe(`Format conformance: ${adapter.format}`, () => {
    test.it('empty() is valid and readable', () => {
      const prepared = prepareContent(registry, adapter.format, adapter.empty());
      const read = adapter.read(prepared.content as never, { mode: 'full', locale: 'en' });
      assert(typeof read.text === 'string', 'read must return text');
    });

    for (const example of adapter.instructions.examples) {
      test.it(`instruction example "${example.title}" is valid`, async () => {
        const base =
          example.content === undefined
            ? adapter.empty()
            : prepareContent(registry, adapter.format, example.content).content;
        if (example.operations) {
          await applyOperations(
            registry,
            { format: adapter.format, content: base, title: 'Example', themeId: 'default', locale: 'en' },
            example.operations,
          );
        }
      });
    }

    for (const fixture of fixtures) {
      test.it(`fixture "${fixture.title}": validates, reads with ids and diffs`, () => {
        const { content } = prepareContent(registry, adapter.format, fixture.content);
        const full = adapter.read(content as never, { mode: 'full', locale: 'en' });
        const outline = adapter.read(content as never, { mode: 'outline', locale: 'en' });
        assert(full.text.length > 0 && outline.text.length > 0, 'reading must not be empty');
        assert(
          adapter.diff(content as never, structuredClone(content) as never).length === 0,
          'diff of identical content must be empty',
        );
        const partial = adapter.parsePartial(JSON.stringify(content));
        assert(partial !== undefined, 'parsePartial must accept complete content');
        adapter.lint(content as never, ctx);
      });

      if (fixture.batches?.length) {
        test.it(`fixture "${fixture.title}": apply is deterministic and does not mutate input`, async () => {
          let { content } = prepareContent(registry, adapter.format, fixture.content);
          for (const batch of fixture.batches ?? []) {
            const frozen = structuredClone(content);
            const artifact = {
              format: adapter.format,
              content,
              title: 'Fixture',
              themeId: 'default',
              locale: 'en',
            };
            const a = await applyOperations(registry, artifact, batch);
            const b = await applyOperations(registry, artifact, batch);
            assert(deepEqual(a.content, b.content), 'same batch must produce the same content');
            assert(deepEqual(a.createdRefs, b.createdRefs), 'created refs must be deterministic');
            assert(deepEqual(content, frozen), 'apply must not mutate the input');
            assert(a.diff.length > 0, 'a successful batch should report changes');
            content = a.content;
          }
        });
      }

      for (const [index, rejected] of (fixture.rejects ?? []).entries()) {
        test.it(`fixture "${fixture.title}": rejects batch ${index} with ${rejected.code}`, async () => {
          const { content } = prepareContent(registry, adapter.format, fixture.content);
          const frozen = structuredClone(content);
          try {
            await applyOperations(
              registry,
              { format: adapter.format, content, title: 'Fixture', themeId: 'default', locale: 'en' },
              rejected.operations,
            );
          } catch (error) {
            assert(error instanceof ArtifactError, `expected ArtifactError, got ${String(error)}`);
            assert(
              error.code === rejected.code,
              `expected ${rejected.code}, got ${error.code}: ${JSON.stringify(error.issues)}`,
            );
            assert(
              error.issues.every((issue) => issue.path.length > 0),
              'every issue needs a path',
            );
            assert(deepEqual(content, frozen), 'failed batch must not mutate content');
            return;
          }
          throw new Error(`expected ${rejected.code}, but the batch succeeded`);
        });
      }
    }

    test.it('migrations chain to the current format version', () => {
      const chain = adapter.migrations;
      for (const migration of chain) {
        assert(migration.to !== migration.from, 'a migration must change the version');
      }
      assert(adapter.readableVersions.includes(adapter.formatVersion), 'current version must be readable');
    });
  });
}

/** Re-export for adapters that want the generic type in their own tests. */
export type { FormatAdapter };
