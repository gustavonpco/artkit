import { z } from 'zod';

/** Pattern for every internal item id (blocks, sheets, slides, elements, nodes, edges, groups). Spec §6.2. */
export const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const itemIdSchema = z
  .string()
  .regex(
    ITEM_ID_PATTERN,
    'Id must start with a letter or digit and use only letters, digits, "_" or "-" (max 64).',
  )
  .describe('Short semantic id, unique inside the artifact (e.g. "scope", "m01", "api").');

export const ARTIFACT_ID_PATTERN = /^art_[0-9A-HJKMNP-TV-Z]{26}$/;

export const artifactIdSchema = z
  .string()
  .regex(ARTIFACT_ID_PATTERN)
  .describe('Artifact id ("art_" + ULID).');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generates an artifact id: `art_` followed by a ULID (48-bit time + 80 bits of randomness).
 * Only stores call this; `apply` never does, so it stays deterministic.
 */
export function createArtifactId(
  timeMs: number = Date.now(),
  random: (length: number) => Uint8Array = randomBytes,
): string {
  let time = Math.floor(timeMs);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const bytes = random(16);
  let randomPart = '';
  for (let i = 0; i < 16; i++) randomPart += CROCKFORD[(bytes[i] ?? 0) % 32];
  return `art_${timePart}${randomPart}`;
}

/**
 * Deterministic id allocator. Given the ids already present in the content, `next('p')` returns
 * `p<n>` where n is one more than the largest numeric suffix used with that prefix.
 */
export class IdAllocator {
  readonly #used: Set<string>;

  constructor(existing: Iterable<string>) {
    this.#used = new Set(existing);
  }

  has(id: string): boolean {
    return this.#used.has(id);
  }

  reserve(id: string): void {
    this.#used.add(id);
  }

  next(prefix: string): string {
    const pattern = new RegExp(`^${prefix.replace(/[^A-Za-z0-9_-]/g, '')}(\\d+)$`);
    let max = 0;
    for (const id of this.#used) {
      const match = pattern.exec(id);
      if (match) max = Math.max(max, Number(match[1]));
    }
    let candidate = `${prefix}${max + 1}`;
    let n = max + 1;
    while (this.#used.has(candidate)) candidate = `${prefix}${++n}`;
    this.#used.add(candidate);
    return candidate;
  }

  snapshot(): Set<string> {
    return new Set(this.#used);
  }
}

/** Returns the ids that appear more than once. */
export function findDuplicateIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}
