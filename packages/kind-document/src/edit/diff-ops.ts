import { deepEqual } from '@artkit-ai/core';
import type { BlockFields, DocumentOperation } from '../operations.js';
import type { Block } from '../schema.js';

const UNSETTABLE = new Set([
  'align',
  'ordered',
  'start',
  'widths',
  'footer',
  'caption',
  'title',
  'attribution',
  'language',
  'width',
  'maxLevel',
]);

/** Positions of the longest increasing subsequence (blocks that keep their relative order). */
function stableIndexes(positions: number[]): Set<number> {
  const tails: number[] = [];
  const tailIndex: number[] = [];
  const previous = new Array<number>(positions.length).fill(-1);
  positions.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    tailIndex[lo] = i;
    previous[i] = lo > 0 ? tailIndex[lo - 1]! : -1;
  });
  const keep = new Set<number>();
  let k = tailIndex[tails.length - 1] ?? -1;
  while (k >= 0) {
    keep.add(k);
    k = previous[k]!;
  }
  return keep;
}

/** Field-level update between two versions of the same block (only what changed). */
export function updateOperation(before: Block, after: Block): DocumentOperation | undefined {
  if (deepEqual(before, after)) return undefined;
  const { id, ...rest } = after;
  if (before.type !== after.type) return { op: 'update_block', id, fields: rest as BlockFields };
  const fields: Record<string, unknown> = {};
  const unset: string[] = [];
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  for (const key of Object.keys(b)) if (key !== 'id' && !deepEqual(a[key], b[key])) fields[key] = b[key];
  for (const key of Object.keys(a)) if (!(key in b) && UNSETTABLE.has(key)) unset.push(key);
  if (Object.keys(fields).length === 0 && unset.length === 0) return undefined;
  return {
    op: 'update_block',
    id,
    fields: fields as BlockFields,
    ...(unset.length
      ? { unset: unset as NonNullable<Extract<DocumentOperation, { op: 'update_block' }>['unset']> }
      : {}),
  };
}

/**
 * Block-level operations that turn `before` into `after` (both keyed by block id): removals first, then,
 * in final order, inserts, moves (only blocks outside the longest stable subsequence) and field updates.
 * Applying them in sequence yields exactly `after`.
 */
export function diffBlocksToOperations(
  before: readonly Block[],
  after: readonly Block[],
): DocumentOperation[] {
  const ops: DocumentOperation[] = [];
  const afterIds = new Set(after.map((block) => block.id));
  const beforeById = new Map(before.map((block) => [block.id, block]));
  for (const block of before) if (!afterIds.has(block.id)) ops.push({ op: 'remove_block', id: block.id });

  const remaining = before.filter((block) => afterIds.has(block.id)).map((block) => block.id);
  const common = after.filter((block) => beforeById.has(block.id));
  const keep = stableIndexes(common.map((block) => remaining.indexOf(block.id)));
  const stable = new Set(common.filter((_, index) => keep.has(index)).map((block) => block.id));

  after.forEach((block, index) => {
    const previous = index > 0 ? after[index - 1]!.id : undefined;
    const position = previous === undefined ? {} : { after: previous };
    const old = beforeById.get(block.id);
    if (!old) {
      ops.push({ op: 'insert_block', ...position, block } as DocumentOperation);
      return;
    }
    if (!stable.has(block.id)) ops.push({ op: 'move_block', id: block.id, ...position });
    const update = updateOperation(old, block);
    if (update) ops.push(update);
  });
  return ops;
}
