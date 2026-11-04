import { deepEqual } from '../diff.js';
import { applyOperations, prepareContent } from '../engine.js';
import { ArtifactError } from '../errors.js';
import type { AnyArtifactKind } from '../kind.js';
import { createRegistry } from '../registry.js';
import type { ArtifactStore, NewArtifact, Scope } from '../store.js';
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
const agent: Scope = { workspaceId: 'ws_a', actor: { type: 'agent', id: 'agt_1' } };

const sample: NewArtifact = {
  kind: 'note',
  schemaVersion: 1,
  title: 'Contract test',
  status: 'draft',
  locale: 'en',
  themeId: 'default',
  content: { text: 'hello' },
  tags: ['contract'],
};

/**
 * Shared contract suite every `ArtifactStore` adapter must pass (spec §15.1).
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
      await expectCode(store.commit(scopeA, created.id, commitFrom(1, 'stale')), 'VERSION_CONFLICT');
      const v1 = await store.get(scopeA, created.id, { version: 1 });
      assert(deepEqual(v1?.content, sample.content), 'old versions are immutable');
      const latest = await store.get(scopeA, created.id);
      assert(deepEqual(latest?.content, { text: 'v2' }), 'latest is v2');
    });

    test.it('records history newest first with idempotency lookup', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      await store.commit(scopeA, created.id, {
        ...commitFrom(1, 'x'),
        idempotencyKey: 'call_1',
        message: 'edit',
      });
      const history = await store.history(scopeA, created.id, {});
      assert(history.items[0]?.version === 2 && history.items[1]?.version === 1, 'history order');
      assert(history.items[0]?.message === 'edit', 'message kept');
      const found = await store.findByIdempotencyKey(scopeA, created.id, 'call_1');
      assert(found?.version === 2, 'idempotency key lookup');
      assert((await store.findByIdempotencyKey(scopeA, created.id, 'missing')) === null, 'unknown key');
    });

    test.it('filters and paginates lists', async () => {
      const store = await factory();
      for (let i = 0; i < 5; i++)
        await store.create(scopeA, { ...sample, title: `Doc ${i}`, kind: i % 2 ? 'sheet' : 'note' });
      const sheets = await store.list(scopeA, { kind: 'sheet' }, {});
      assert(sheets.items.length === 2, 'kind filter');
      const titled = await store.list(scopeA, { title: 'doc 3' }, {});
      assert(titled.items.length === 1, 'title filter is case-insensitive');
      const page1 = await store.list(scopeA, {}, { limit: 2 });
      assert(page1.items.length === 2 && page1.nextCursor !== undefined, 'first page');
      const page2 = await store.list(scopeA, {}, { limit: 2, cursor: page1.nextCursor });
      assert(
        page2.items.length === 2 && !page2.items.some((item) => page1.items.some((p) => p.id === item.id)),
        'second page',
      );
    });

    test.it('changes status and records the published version', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      const published = await store.setStatus(scopeA, created.id, 'published', scopeA.actor);
      assert(published.status === 'published', 'status');
      assert(published.meta.publishedVersion === 1, 'publishedVersion');
      assert(published.version === 1, 'status change does not create a version');
      await store.setStatus(scopeA, created.id, 'draft', scopeA.actor, 'needs a cost table');
      const entry = (await store.history(scopeA, created.id, {})).items[0];
      const log = entry?.statusLog ?? [];
      assert(log.length === 2, 'status changes are logged on the current version');
      assert(log[1]?.status === 'draft' && log[1]?.message === 'needs a cost table', 'reason is kept');
    });

    test.it('locks against other actors', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      const lock = await store.lock(scopeA, created.id, agent.actor, 60_000);
      assert((await store.getLock(scopeA, created.id))?.token === lock.token, 'lock visible');
      await expectCode(store.lock(scopeA, created.id, scopeA.actor, 60_000), 'LOCKED');
      await store.lock(scopeA, created.id, agent.actor, 60_000);
      await store.unlock(scopeA, (await store.getLock(scopeA, created.id))!);
      assert((await store.getLock(scopeA, created.id)) === null, 'unlocked');
    });

    test.it('expires locks', async () => {
      const store = await factory();
      const created = await store.create(scopeA, sample);
      await store.lock(scopeA, created.id, agent.actor, 1);
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 15));
      assert((await store.getLock(scopeA, created.id)) === null, 'lock expired');
    });

    test.it('finds artifacts by creation idempotency key when supported', async () => {
      const store = await factory();
      if (!store.findCreatedByIdempotencyKey) return;
      const created = await store.create(scopeA, { ...sample, idempotencyKey: 'create_1' });
      await store.commit(scopeA, created.id, { ...commitFrom(1, 'later'), idempotencyKey: 'apply_1' });
      assert(
        (await store.findCreatedByIdempotencyKey(scopeA, 'create_1'))?.id === created.id,
        'found by create key',
      );
      assert(
        (await store.findCreatedByIdempotencyKey(scopeA, 'apply_1')) === null,
        'apply keys are not create keys',
      );
      assert((await store.findCreatedByIdempotencyKey(scopeB, 'create_1')) === null, 'workspace isolation');
      assert((await store.findCreatedByIdempotencyKey(agent, 'create_1')) === null, 'keys are per actor');
    });
  });
}

function commitFrom(baseVersion: number, text = 'changed') {
  return {
    baseVersion,
    schemaVersion: 1,
    content: { text },
    title: 'Contract test',
    locale: 'en',
    themeId: 'default',
    operations: [{ op: 'replace_content', content: { text } }],
    diff: [],
  };
}

export interface KindFixture {
  title: string;
  content: unknown;
  /** Batches applied in sequence on the content; each must succeed. */
  batches?: unknown[][];
  /** Batches that must be rejected with the given code. */
  rejects?: { operations: unknown[]; code: string }[];
}

/**
 * Conformance suite for kinds (spec §20): instruction examples validate against the schemas, apply is
 * deterministic and atomic, projection exposes ids, diff of identical content is empty, parsePartial
 * accepts complete content and migrations chain up to the current version.
 */
export function defineKindConformanceTests(
  kind: AnyArtifactKind,
  fixtures: KindFixture[],
  test: TestApi,
): void {
  const registry = createRegistry({ kinds: [kind] });
  const lint = { locale: 'en', theme: defaultTheme };

  test.describe(`Kind conformance: ${kind.kind}`, () => {
    test.it('empty() is valid and projectable', () => {
      const prepared = prepareContent(registry, kind.kind, kind.empty());
      kind.project(prepared.content, { mode: 'full', locale: 'en' });
    });

    for (const example of kind.instructions.examples) {
      test.it(`instruction example "${example.title}" is valid`, () => {
        if (example.input) {
          const input = kind.inputs?.[example.input.format];
          assert(input, `example uses unknown input format "${example.input.format}"`);
          const raw = input.toContent(input.schema.parse(example.input.source), { locale: 'en' });
          const fromInput = prepareContent(registry, kind.kind, raw).content;
          if (example.content !== undefined) {
            const expected = prepareContent(registry, kind.kind, example.content).content;
            assert(deepEqual(fromInput, expected), 'example input must produce the example content');
          }
        }
        const base =
          example.content === undefined
            ? kind.empty()
            : prepareContent(registry, kind.kind, example.content).content;
        if (example.operations) {
          applyOperations(
            registry,
            { kind: kind.kind, content: base, title: 'Example', themeId: 'default', locale: 'en' },
            example.operations,
          );
        }
      });
    }

    for (const fixture of fixtures) {
      test.it(`fixture "${fixture.title}": validates, projects ids and diffs`, () => {
        const { content } = prepareContent(registry, kind.kind, fixture.content);
        const full = kind.project(content, { mode: 'full', locale: 'en' });
        const outline = kind.project(content, { mode: 'outline', locale: 'en' });
        assert(full.text.length > 0 && outline.text.length > 0, 'projection must not be empty');
        const someId = [...kind.ids(content)][0];
        if (someId) assert(full.text.includes(someId), `full projection must expose ids (missing ${someId})`);
        assert(
          kind.diff(content, structuredClone(content)).length === 0,
          'diff of identical content must be empty',
        );
        const partial = kind.parsePartial(structuredClone(content));
        assert(
          partial !== undefined && kind.contentSchema.safeParse(partial).success,
          'parsePartial must accept complete content',
        );
        kind.lint(content, lint);
        assert(deepEqual(JSON.parse(JSON.stringify(content)), content), 'content must be JSON-serializable');
      });

      if (fixture.batches?.length) {
        test.it(`fixture "${fixture.title}": apply is deterministic and does not mutate input`, () => {
          let { content } = prepareContent(registry, kind.kind, fixture.content);
          for (const batch of fixture.batches ?? []) {
            const frozen = structuredClone(content);
            const artifact = { kind: kind.kind, content, title: 'Fixture', themeId: 'default', locale: 'en' };
            const a = applyOperations(registry, artifact, batch);
            const b = applyOperations(registry, artifact, batch);
            assert(deepEqual(a.content, b.content), 'same batch must produce the same content');
            assert(deepEqual(a.createdIds, b.createdIds), 'generated ids must be deterministic');
            assert(deepEqual(content, frozen), 'apply must not mutate the input');
            assert(a.diff.length > 0, 'a successful batch should report changes');
            content = a.content;
          }
        });
      }

      for (const [index, rejected] of (fixture.rejects ?? []).entries()) {
        test.it(`fixture "${fixture.title}": rejects batch ${index} with ${rejected.code}`, () => {
          const { content } = prepareContent(registry, kind.kind, fixture.content);
          const frozen = structuredClone(content);
          try {
            applyOperations(
              registry,
              { kind: kind.kind, content, title: 'Fixture', themeId: 'default', locale: 'en' },
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

    test.it('migrations chain to the current version', () => {
      const versions = kind.migrations.map((m) => m.to);
      assert(
        kind.migrations.length === 0 || Math.max(...versions) === kind.version,
        'migrations must end at version',
      );
    });
  });
}
