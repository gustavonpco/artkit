import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** sha256 hex of a string. Used to turn arbitrary ids (workspaces, idempotency keys) into safe file names. */
export function hashName(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tempPath(file: string): string {
  return join(dirname(file), `.${randomBytes(8).toString('hex')}.tmp`);
}

async function writeTemp(file: string, data: Uint8Array | string): Promise<string> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = tempPath(file);
  const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(data);
    // fsync before rename so a crash never leaves a renamed but empty file behind.
    await handle.sync();
  } finally {
    await handle.close();
  }
  return tmp;
}

/** Atomic replace: readers see either the old or the new file, never a partial one. */
export async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  const tmp = await writeTemp(file, data);
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * Atomic create-if-absent: returns false (and leaves the existing file untouched) when `file` exists.
 * `link` fails with EEXIST instead of overwriting, unlike `rename`.
 */
export async function createFileAtomic(file: string, data: Uint8Array | string): Promise<boolean> {
  const tmp = await writeTemp(file, data);
  try {
    await link(tmp, file);
    return true;
  } catch (error) {
    if (isErrno(error, 'EEXIST')) return false;
    throw error;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value));
}

/** Reads and parses a JSON file; returns undefined when it does not exist. */
export async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return undefined;
    throw error;
  }
  return JSON.parse(text) as T;
}

export async function removeFile(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * In-process keyed mutex. Calls with the same key run one at a time, in arrival order; different keys
 * run concurrently. Entries are dropped when their queue drains, so the map does not grow.
 */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

/** Runs `fn` over `items` with at most `limit` promises in flight, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
