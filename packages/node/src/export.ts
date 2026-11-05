import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  ArtifactError,
  type ArtifactService,
  type AssetStore,
  type ExportRequest,
  type ExportResult,
  type Scope,
  t,
} from '@artkit-ai/core';
import { createFileAtomic, writeFileAtomic } from './fs-utils.js';

export interface ExportArtifactRequest extends ExportRequest {
  /**
   * Asset store that receives the file when `saveToAssets` is true. Defaults to the store the service
   * was created with; when neither exists, `saveToAssets` fails instead of being silently ignored.
   */
  assets?: AssetStore;
  /** Locale of error messages. */
  locale?: string;
}

/**
 * Export orchestration (spec §12.1) on top of `service.export`: resolves the exporter registered for
 * the format and format, migrates the content, resolves theme, locale and assets, runs with a timeout and
 * the caller's `AbortSignal`, and optionally stores the file in the asset store.
 *
 * The service performs authorization and event emission; failures surface as
 * `ArtifactError` (`NOT_FOUND`, `PERMISSION_DENIED`, `EXPORT_FAILED`…).
 */
export async function exportArtifact(
  service: ArtifactService,
  scope: Scope,
  request: ExportArtifactRequest,
): Promise<ExportResult> {
  const { assets, locale, ...rest } = request;
  if (rest.timeoutMs !== undefined && (!Number.isFinite(rest.timeoutMs) || rest.timeoutMs <= 0)) {
    throw new TypeError('exportArtifact: `timeoutMs` must be a positive number.');
  }
  if (rest.signal?.aborted) {
    throw new ArtifactError('EXPORT_FAILED', t(locale, 'EXPORT_FAILED', { format: rest.format }), {
      cause: rest.signal.reason,
    });
  }
  // With an explicit store, the service must not also save the file to its own store.
  const result = await service.export(scope, assets ? { ...rest, saveToAssets: false } : rest);
  if (!rest.saveToAssets || result.asset) return result;
  if (!assets) {
    throw new ArtifactError('EXPORT_FAILED', t(locale, 'EXPORT_FAILED', { format: rest.format }), {
      cause: new Error(
        'saveToAssets requires an AssetStore: pass `assets` or configure one in createArtifactService.',
      ),
    });
  }
  const stored = await assets.put(scope, result.bytes, {
    mimeType: result.mimeType,
    filename: result.filename,
  });
  return { ...result, asset: { ref: stored.ref, size: stored.size, hash: stored.hash } };
}

export interface WriteExportOptions {
  /** Target directory, created when missing. */
  dir: string;
  /** File name; defaults to `result.filename`. Directory parts are stripped. */
  filename?: string;
  /** Replace an existing file (default false: fails with EEXIST). */
  overwrite?: boolean;
}

/** Writes an export result to disk atomically and returns the absolute path of the file. */
export async function writeExportFile(
  result: Pick<ExportResult, 'bytes' | 'filename'>,
  options: WriteExportOptions,
): Promise<string> {
  const name = basename(options.filename ?? result.filename);
  if (name === '' || name === '.' || name === '..')
    throw new TypeError('writeExportFile: invalid file name.');
  const dir = resolve(options.dir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  if (options.overwrite) {
    await writeFileAtomic(path, result.bytes);
  } else if (!(await createFileAtomic(path, result.bytes))) {
    throw Object.assign(new Error(`writeExportFile: ${name} already exists in the target directory.`), {
      code: 'EEXIST',
    });
  }
  return path;
}
