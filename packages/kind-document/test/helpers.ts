import { inflateRawSync } from 'node:zlib';
import { type ArtifactError, applyOperations, createRegistry, prepareContent } from '@artkit-ai/core';
import { type DocumentContent, documentKind } from '../src/index.js';

export const registry = createRegistry({ kinds: [documentKind] });

export function prepare(raw: unknown): DocumentContent {
  return prepareContent(registry, 'document', raw).content as DocumentContent;
}

export function apply(content: DocumentContent, operations: unknown[], locale = 'en') {
  return applyOperations(
    registry,
    { kind: 'document', content, title: 'Doc', themeId: 'default', locale },
    operations,
  );
}

export function applyContent(content: DocumentContent, operations: unknown[]): DocumentContent {
  return apply(content, operations).content as DocumentContent;
}

/** Runs `fn` and returns the ArtifactError it throws. */
export function catchError(fn: () => unknown): ArtifactError {
  try {
    fn();
  } catch (error) {
    return error as ArtifactError;
  }
  throw new Error('expected an error');
}

/** Minimal ZIP reader (stored and deflated entries) for asserting on generated Office files. */
export function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compressed);
    files.set(name, decoder.decode(method === 8 ? inflateRawSync(data) : data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
