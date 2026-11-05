import { createSheetFormat } from '../index.js';
import { createUniverEngine } from '../univer-engine.js';
import { createUniverPool, type UniverPool, type UniverPoolOptions } from './pool.js';

export { createUniverEngine, type UniverEngine } from '../univer-engine.js';
export { createUniverPool, type UniverPool, type UniverPoolOptions } from './pool.js';

/** Sheet format backed by one in-process Univer engine (Node only). Servers should prefer the pooled variant. */
export const sheetFormat = createSheetFormat(createUniverEngine());

/** Sheet format backed by a pool of isolated Univer workers (spec §11.1), for servers. Close the pool on shutdown. */
export function createPooledSheetFormat(options?: UniverPoolOptions) {
  const pool: UniverPool = createUniverPool(options);
  return { format: createSheetFormat(pool), pool };
}
