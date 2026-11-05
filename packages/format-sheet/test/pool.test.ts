// @vitest-environment node
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { emptyWorkbook, type WorkbookContent } from '../src/index.js';
import { createUniverPool } from '../src/server/index.js';

// Workers run the compiled module: `pnpm build` must have run (the verify script does it first).
const workerUrl = new URL('../dist/server/worker.js', import.meta.url);
const built = existsSync(workerUrl);

const start: WorkbookContent = {
  ...emptyWorkbook('wb', 'Pool', 'pt-BR'),
  sheetOrder: ['s'],
  sheets: { s: { id: 's', name: 'Resumo', rowCount: 20, columnCount: 6, cellData: {} } },
};

const writeA1 = [
  { kind: 'set_values' as const, sheetId: 's', row: 0, column: 0, values: [[2, 3, '=A1*B1']] },
];

describe.skipIf(!built)('Univer pool', () => {
  const pool = createUniverPool({ size: 2, workerUrl, timeoutMs: 15_000 });
  afterAll(async () => {
    await pool.close();
  });

  it('runs a batch in a worker and returns the same result as the in-process engine', async () => {
    const result = await pool.execute(start, writeA1, { locale: 'pt-BR' });
    expect(result.sheets.s!.cellData['0']!['2']).toMatchObject({ f: '=A1*B1', v: 6 });
  });

  it('queues more batches than workers and answers all of them', async () => {
    const batches = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        pool.execute(start, [{ kind: 'set_values', sheetId: 's', row: 0, column: 0, values: [[n]] }], {
          locale: 'pt-BR',
        }),
      ),
    );
    expect(batches.map((b) => b.sheets.s!.cellData['0']!['0']?.v)).toEqual([1, 2, 3, 4]);
    expect(pool.stats().busy).toBe(0);
  });

  it('turns a model error inside the worker into the same ArtifactError and keeps the worker', async () => {
    const error = (await pool
      .execute(start, [{ kind: 'delete_rows', sheetId: 'missing', from: 0, count: 1 } as never], {
        locale: 'pt-BR',
      })
      .catch((e: unknown) => e)) as { code: string; issues: unknown[] };
    expect(error.code).toBe('OPERATION_FAILED');
    expect(error.issues.length).toBeGreaterThan(0);
    const after = await pool.execute(start, writeA1, { locale: 'pt-BR' });
    expect(after.sheets.s!.cellData['0']!['2']?.v).toBe(6);
  });
});

describe.skipIf(!built)('Univer pool limits', () => {
  it('fails a batch over the pool time limit and replaces its worker', async () => {
    // A worker that never answers: the pool's own timer must fail the batch and start a fresh worker.
    const pool = createUniverPool({
      size: 1,
      workerUrl: new URL('./fixtures/hanging-worker.mjs', import.meta.url),
      timeoutMs: 1,
    });
    try {
      const slow = (await pool.execute(start, writeA1, { locale: 'pt-BR' }).catch((e: unknown) => e)) as {
        code: string;
      };
      expect(slow.code).toBe('ENGINE_UNAVAILABLE');
      expect(pool.stats().recycled).toBeGreaterThanOrEqual(1);
      expect(pool.stats().busy).toBe(0);
    } finally {
      await pool.close();
    }
  });

  it('recycles a worker after its batch budget and refuses work after close', async () => {
    const pool = createUniverPool({ size: 1, workerUrl, recycleAfter: 1, timeoutMs: 15_000 });
    await pool.execute(start, writeA1, { locale: 'pt-BR' });
    await pool.execute(start, writeA1, { locale: 'pt-BR' });
    expect(pool.stats().recycled).toBeGreaterThanOrEqual(2);
    await pool.close();
    await expect(pool.execute(start, writeA1, { locale: 'pt-BR' })).rejects.toMatchObject({
      code: 'ENGINE_UNAVAILABLE',
    });
  });
});
