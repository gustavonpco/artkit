import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import {
  createArtifactService,
  createMemoryAssetStore,
  createMemoryStore,
  type Scope,
} from '@artkit-ai/core';
import { documentExporters } from '@artkit-ai/kind-document/export';
import { serialFromIso } from '@artkit-ai/kind-sheet';
import { sheetExporters } from '@artkit-ai/kind-sheet/export';
import { createSlidesExporters } from '@artkit-ai/kind-slides/export';
import { describe, expect, it } from 'vitest';
import {
  createWorkiaRegistry,
  importWorkiaArtifact,
  scheduleCronograma,
  type WorkiaArtifact,
  workiaKindOf,
  workiaSlidesKind,
} from '../src/index.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as WorkiaArtifact;

/** Minimal zip reader (central directory + inflateRaw) to inspect Office files. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const buffer = Buffer.from(bytes);
  const files = new Map<string, string>();
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let offset = buffer.readUInt32LE(eocd + 16);
  const count = buffer.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function setup() {
  const registry = createWorkiaRegistry();
  for (const exporter of [
    ...documentExporters,
    ...sheetExporters,
    ...createSlidesExporters({ layouts: workiaSlidesKind.layouts }),
  ]) {
    registry.registerExporter(exporter, { replace: true });
  }
  const service = createArtifactService({
    registry,
    store: createMemoryStore(),
    assets: createMemoryAssetStore(),
    locale: 'pt-BR',
  });
  const scope: Scope = { workspaceId: 'workia', actor: { type: 'system', id: 'workia-migration' } };
  return { registry, service, scope };
}

describe('Workia → artkit migration', () => {
  it('detects the Workia kind of each fixture', () => {
    expect(
      ['documento', 'planilha', 'deck', 'cronograma'].map((name) => workiaKindOf(fixture(name))),
    ).toEqual(['documento', 'planilha', 'deck', 'cronograma']);
  });

  it('imports the documento with cover, blocks and literal placeholders, and exports docx and md', async () => {
    const { service, scope } = setup();
    const result = await importWorkiaArtifact(service, scope, fixture('documento'));
    expect(result.artifact).toMatchObject({
      kind: 'document',
      title: 'Proposta Técnica',
      version: 1,
      locale: 'pt-BR',
    });
    expect(result.lint.filter((issue) => issue.severity === 'warning')).toEqual([]);
    const content = result.artifact.content as { cover: { subtitle: string }; blocks: { type: string }[] };
    expect(content.cover.subtitle).toBe('Portal do Cliente Acme');
    expect(content.blocks.map((b) => b.type)).toContain('table');
    const md = new TextDecoder().decode(
      (await service.export(scope, { artifactId: result.artifact.id, format: 'md' })).bytes,
    );
    expect(md).toContain('{{campo:cliente}}');
    expect(md).toContain('| Módulo | Horas | Responsável |');
    const docx = readZip(
      (await service.export(scope, { artifactId: result.artifact.id, format: 'docx' })).bytes,
    );
    expect(docx.get('word/document.xml')).toContain('Portal do Cliente Acme');
  });

  it('imports the planilha with named parameters and recalculated totals, and exports xlsx', async () => {
    const { service, scope } = setup();
    const result = await importWorkiaArtifact(service, scope, fixture('planilha'));
    expect(result.version).toBe(2);
    expect(result.lint.filter((issue) => issue.severity === 'warning')).toEqual([]);
    const sheet = (
      result.artifact.content as {
        sheets: { id: string; cells: Record<string, { v?: unknown; f?: string }> }[];
      }
    ).sheets.find((s) => s.id === 'estimativa')!;
    const values = Object.values(sheet.cells)
      .filter((cell) => cell.f)
      .map((cell) => cell.v);
    expect(values).toEqual(expect.arrayContaining([1500, 3075, 1200, 38.5, 5775, 4575, 6930]));
    const xlsx = await service.export(scope, { artifactId: result.artifact.id, format: 'xlsx' });
    const files = readZip(xlsx.bytes);
    expect(files.get('xl/workbook.xml')).toContain('valor_hora');
    expect([...files.keys()].some((name) => name.startsWith('xl/worksheets/'))).toBe(true);
  });

  it('schedules the cronograma on working days with holidays, dependencies and milestones', () => {
    const schedule = Object.fromEntries(
      scheduleCronograma(fixture('cronograma') as never).map((t) => [t.id, [t.start, t.end]]),
    );
    expect(schedule).toEqual({
      t1: ['2026-11-02', '2026-11-06'],
      t2: ['2026-11-09', '2026-11-11'],
      t3: ['2026-11-04', '2026-11-05'],
      // Ten working days skipping the 2026-11-20 holiday.
      t4: ['2026-11-12', '2026-11-26'],
      m1: ['2026-11-26', '2026-11-26'],
    });
  });

  it('imports the cronograma as a sheet whose NETWORKDAYS column matches the durations', async () => {
    const { service, scope } = setup();
    const result = await importWorkiaArtifact(service, scope, fixture('cronograma'));
    const sheet = (
      result.artifact.content as {
        sheets: { id: string; cells: Record<string, { v?: unknown; f?: string }> }[];
      }
    ).sheets.find((s) => s.id === 'cronograma')!;
    for (const row of [2, 3, 4, 5])
      expect(sheet.cells[`H${row}`]?.v, `row ${row}`).toBe(sheet.cells[`D${row}`]?.v);
    expect(sheet.cells.E5?.v).toBe(serialFromIso('2026-11-12'));
    expect(sheet.cells.A6?.v).toBe('◆ Entrega');
    const csv = new TextDecoder().decode(
      (await service.export(scope, { artifactId: result.artifact.id, format: 'csv' })).bytes,
    );
    expect(csv).toContain('Construção');
  });

  it('imports the deck with registered layouts and exports pptx', async () => {
    const { service, scope } = setup();
    const result = await importWorkiaArtifact(service, scope, fixture('deck'));
    const slides = (result.artifact.content as { slides: { layout: string }[] }).slides;
    expect(slides.map((s) => s.layout)).toEqual([
      'capa',
      'titulo-texto',
      'indicadores',
      'etapas',
      'lista-cartoes',
      'duas-colunas',
      'secao',
      'encerramento',
    ]);
    const pptx = await service.export(scope, { artifactId: result.artifact.id, format: 'pptx' });
    const files = readZip(pptx.bytes);
    expect(files.get('ppt/slides/slide1.xml')).toContain('Portal do Cliente');
    expect(files.get('ppt/slides/slide3.xml')).toContain('menos retrabalho');
    // The image block points at a Workia conversation input that was not uploaded: export warns.
    expect(pptx.warnings.some((w) => w.includes('in_arquitetura'))).toBe(true);
  });

  it('keeps the import in the version history', async () => {
    const { service, scope } = setup();
    const result = await importWorkiaArtifact(service, scope, fixture('planilha'));
    const history = await service.history(scope, result.artifact.id);
    expect(history.items.map((entry) => entry.message)).toEqual([
      'Workia import: formulas and notes',
      'Imported from Workia (planilha)',
    ]);
  });
});
