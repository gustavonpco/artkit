import type { ChangeSummary } from './adapter.js';

export interface CollectionDiffOptions<T> {
  /** Target prefix, e.g. `block`, `slide`, `node`. */
  prefix: string;
  id(item: T): string;
  /** Human label used in summaries. */
  label?(item: T): string;
  /** Structural equality. Defaults to JSON comparison. */
  equals?(a: T, b: T): boolean;
  /** Summary for a changed item. */
  describeChange?(before: T, after: T): string;
  /** Whether position changes are reported (ordered collections). */
  ordered?: boolean;
  locale?: string;
}

/** Stable JSON stringify with sorted keys, used for structural comparisons. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

const pt = (locale?: string) => locale?.toLowerCase().startsWith('pt') ?? false;

/** Diffs two collections keyed by id: added, removed, changed and (for ordered collections) moved. */
export function diffCollection<T>(
  before: readonly T[],
  after: readonly T[],
  options: CollectionDiffOptions<T>,
): ChangeSummary[] {
  const changes: ChangeSummary[] = [];
  const equals = options.equals ?? deepEqual;
  const label = options.label ?? options.id;
  const beforeIndex = new Map(before.map((item, index) => [options.id(item), index]));
  const afterIndex = new Map(after.map((item, index) => [options.id(item), index]));
  const isPt = pt(options.locale);

  for (const item of before) {
    const id = options.id(item);
    if (!afterIndex.has(id)) {
      changes.push({
        type: 'removed',
        target: `${options.prefix}:${id}`,
        summary: isPt ? `Removido: ${label(item)}.` : `Removed: ${label(item)}.`,
      });
    }
  }

  // Positions relative to the items that exist in both versions, so inserts/removals don't count as moves.
  const common = after.map(options.id).filter((id) => beforeIndex.has(id));
  const commonBefore = before.map(options.id).filter((id) => afterIndex.has(id));

  after.forEach((item, index) => {
    const id = options.id(item);
    const prevIndex = beforeIndex.get(id);
    if (prevIndex === undefined) {
      const prev = index > 0 ? options.id(after[index - 1]!) : undefined;
      changes.push({
        type: 'added',
        target: `${options.prefix}:${id}`,
        summary: isPt
          ? `Inserido: ${label(item)}${prev ? ` após '${prev}'` : ' no início'}.`
          : `Added: ${label(item)}${prev ? ` after '${prev}'` : ' at the start'}.`,
      });
      return;
    }
    const prevItem = before[prevIndex]!;
    if (!equals(prevItem, item)) {
      changes.push({
        type: 'changed',
        target: `${options.prefix}:${id}`,
        summary:
          options.describeChange?.(prevItem, item) ??
          (isPt ? `Alterado: ${label(item)}.` : `Changed: ${label(item)}.`),
      });
    }
    if (options.ordered !== false) {
      const from = commonBefore.indexOf(id);
      const to = common.indexOf(id);
      if (from !== to && isRealMove(commonBefore, common, id)) {
        changes.push({
          type: 'moved',
          target: `${options.prefix}:${id}`,
          summary: isPt
            ? `Da posição ${prevIndex + 1} para a posição ${index + 1}.`
            : `From position ${prevIndex + 1} to position ${index + 1}.`,
        });
      }
    }
  });
  return changes;
}

/**
 * An item counts as moved when it is not part of the longest increasing subsequence of positions,
 * so moving one block reports one move instead of shifting every neighbor.
 */
function isRealMove(before: string[], after: string[], id: string): boolean {
  const positions = after.map((item) => before.indexOf(item));
  const keep = longestIncreasingSubsequence(positions);
  const index = after.indexOf(id);
  return !keep.has(index);
}

function longestIncreasingSubsequence(values: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(values.length).fill(-1);
  const tailIdx: number[] = [];
  values.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = value;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1;
  });
  const result = new Set<number>();
  let k = tailIdx[tails.length - 1] ?? -1;
  while (k >= 0) {
    result.add(k);
    k = prev[k]!;
  }
  return result;
}

/** Diffs scalar fields (`envelope:title`, `deck:footer`…). */
export function diffFields(
  prefix: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
  locale?: string,
): ChangeSummary[] {
  const changes: ChangeSummary[] = [];
  for (const field of fields) {
    const a = before[field];
    const b = after[field];
    if (deepEqual(a, b)) continue;
    const type = a === undefined ? 'added' : b === undefined ? 'removed' : 'changed';
    const show = (v: unknown) =>
      typeof v === 'string' || typeof v === 'number' ? `'${v}'` : pt(locale) ? 'novo valor' : 'new value';
    changes.push({
      type,
      target: `${prefix}:${field}`,
      summary:
        type === 'changed'
          ? pt(locale)
            ? `${field}: ${show(a)} para ${show(b)}.`
            : `${field}: ${show(a)} to ${show(b)}.`
          : pt(locale)
            ? `${field} ${type === 'added' ? 'definido' : 'removido'}.`
            : `${field} ${type}.`,
    });
  }
  return changes;
}
