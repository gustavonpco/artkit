import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsAssetStore, exportArtifact, writeExportFile } from '../src/index.js';
import { agent, noteService, PNG, rejection, tempDir } from './helpers.js';

async function setup(options: Parameters<typeof noteService>[0] = {}) {
  const service = noteService(options);
  const { artifact } = await service.create(agent, {
    format: 'note',
    title: 'Relatório Final',
    content: { items: [{ text: 'a' }] },
  });
  return { service, id: artifact.id };
}

describe('exportArtifact', () => {
  it('exports with warnings', async () => {
    const { service, id } = await setup();
    const result = await exportArtifact(service, agent, { artifactId: id, format: 'md' });
    expect(result).toMatchObject({
      filename: 'relatorio-final.md',
      mimeType: 'text/markdown',
      warnings: ['note export is lossy'],
    });
    expect(new TextDecoder().decode(result.bytes)).toBe('a');
    expect(result.asset).toBeUndefined();
  });

  it('saves to the service asset store', async () => {
    const { service, id } = await setup();
    const result = await exportArtifact(service, agent, {
      artifactId: id,
      format: 'png',
      saveToAssets: true,
    });
    expect(result.asset).toMatchObject({ ref: expect.stringMatching(/^asset:\/\//), size: PNG.byteLength });
    expect((await service.assetResolver(agent).resolve(result.asset!.ref)).mimeType).toBe('image/png');
  });

  it('saves to an explicit asset store, still applying its policy', async () => {
    const { service, id } = await setup({ assets: undefined });
    const assets = createFsAssetStore({ dir: await tempDir() });
    const result = await exportArtifact(service, agent, {
      artifactId: id,
      format: 'png',
      saveToAssets: true,
      assets,
    });
    expect((await assets.get(agent, result.asset!.ref)).bytes).toEqual(PNG);
    // Markdown cannot be sniffed and is not in the default allowlist.
    expect(
      (
        await rejection(
          exportArtifact(service, agent, { artifactId: id, format: 'md', saveToAssets: true, assets }),
        )
      ).code,
    ).toBe('ASSET_REJECTED');
  });

  it('fails clearly when saveToAssets has no asset store', async () => {
    const { service, id } = await setup({ assets: undefined });
    const error = await rejection(
      exportArtifact(service, agent, { artifactId: id, format: 'md', saveToAssets: true }),
    );
    expect(error.code).toBe('EXPORT_FAILED');
    expect(String((error.cause as Error).message)).toMatch(/AssetStore/);
  });

  it('applies the timeout and the caller signal', async () => {
    const { service, id } = await setup();
    const started = Date.now();
    expect(
      (await rejection(exportArtifact(service, agent, { artifactId: id, format: 'html', timeoutMs: 30 })))
        .code,
    ).toBe('EXPORT_FAILED');
    expect(Date.now() - started).toBeLessThan(2000);
    const controller = new AbortController();
    const pending = exportArtifact(service, agent, {
      artifactId: id,
      format: 'html',
      signal: controller.signal,
    });
    controller.abort();
    expect((await rejection(pending)).code).toBe('EXPORT_FAILED');
    expect(
      (
        await rejection(
          exportArtifact(service, agent, { artifactId: id, format: 'md', signal: AbortSignal.abort() }),
        )
      ).code,
    ).toBe('EXPORT_FAILED');
    await expect(
      exportArtifact(service, agent, { artifactId: id, format: 'md', timeoutMs: 0 }),
    ).rejects.toThrow(TypeError);
  });

  it('reports unknown formats and artifacts', async () => {
    const { service, id } = await setup();
    expect((await rejection(exportArtifact(service, agent, { artifactId: id, format: 'docx' }))).code).toBe(
      'NOT_FOUND',
    );
    expect(
      (
        await rejection(
          exportArtifact(service, agent, { artifactId: 'art_00000000000000000000000000', format: 'md' }),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });
});

describe('writeExportFile', () => {
  it('writes atomically without overwriting by default', async () => {
    const dir = await tempDir();
    const result = { bytes: new TextEncoder().encode('one'), filename: 'report.md' };
    const path = await writeExportFile(result, { dir: join(dir, 'out') });
    expect(path).toBe(join(dir, 'out', 'report.md'));
    expect(await readFile(path, 'utf8')).toBe('one');
    await expect(
      writeExportFile({ ...result, bytes: new TextEncoder().encode('two') }, { dir: join(dir, 'out') }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await writeExportFile(
      { ...result, bytes: new TextEncoder().encode('two') },
      { dir: join(dir, 'out'), overwrite: true },
    );
    expect(await readFile(path, 'utf8')).toBe('two');
  });

  it('strips directory parts from file names', async () => {
    const dir = await tempDir();
    const path = await writeExportFile(
      { bytes: new Uint8Array([1]), filename: 'x.md' },
      { dir, filename: '../../evil.md' },
    );
    expect(path).toBe(join(dir, 'evil.md'));
    await expect(
      writeExportFile({ bytes: new Uint8Array([1]), filename: 'x' }, { dir, filename: '..' }),
    ).rejects.toThrow(TypeError);
  });
});
