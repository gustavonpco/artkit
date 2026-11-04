#!/usr/bin/env node
// Creates one artifact of each kind with the alternative inputs models know best (Markdown, CSV, Mermaid),
// edits them with small operations, and exports every format available in Node.
// Run after `pnpm build`: node examples/node-script/generate.mjs [outDir]
import { resolve } from 'node:path';
import { createArtifactService, createRegistry } from '@artkit/core';
import { diagramKind } from '@artkit/kind-diagram';
import { diagramExporters } from '@artkit/kind-diagram/export';
import { documentKind } from '@artkit/kind-document';
import { documentExporters } from '@artkit/kind-document/export';
import { sheetKind } from '@artkit/kind-sheet';
import { sheetExporters } from '@artkit/kind-sheet/export';
import { slidesKind } from '@artkit/kind-slides';
import { slidesExporters } from '@artkit/kind-slides/export';
import { createFsAssetStore, createFsStore, exportArtifact, writeExportFile } from '@artkit/node';

const outDir = resolve(process.argv[2] ?? 'artkit-output');
const registry = createRegistry({
  kinds: [documentKind, sheetKind, slidesKind, diagramKind],
  exporters: [...documentExporters, ...sheetExporters, ...slidesExporters, ...diagramExporters],
});
const service = createArtifactService({
  registry,
  store: createFsStore({ dir: resolve(outDir, '.store') }),
  assets: createFsAssetStore({ dir: resolve(outDir, '.assets') }),
  // Scripts run with full access; real apps check the workspace and the actor here.
  authorize: () => true,
  locale: 'pt-BR',
  defaultArtifactLocale: 'pt-BR',
});
const scope = { workspaceId: 'demo', actor: { type: 'agent', id: 'script' } };

async function exportAll(artifact) {
  for (const exporter of registry.exporters(artifact.kind)) {
    const result = await exportArtifact(service, scope, { artifactId: artifact.id, format: exporter.format });
    const path = await writeExportFile(result, { dir: outDir, overwrite: true });
    const notes = result.warnings.length > 0 ? ` (${result.warnings.length} fidelity warnings)` : '';
    console.log(`  → ${path}${notes}`);
  }
}

// Document from Markdown, then a precise edit by block id.
const doc = await service.create(scope, {
  kind: 'document',
  title: 'Proposta técnica',
  input: {
    format: 'markdown',
    source: {
      cover: {
        eyebrow: 'Proposta',
        title: 'Portal de Fornecedores',
        fields: [{ label: 'Cliente', value: 'Acme' }],
      },
      markdown: [
        '## Escopo <!-- #escopo -->',
        '',
        'O portal centraliza o cadastro e a homologação de fornecedores. <!-- #escopo-p1 -->',
        '',
        '## Investimento <!-- #investimento -->',
        '',
        '| Módulo | Horas |',
        '| --- | ---: |',
        '| Cadastro | 120 |',
        '| Homologação | 80 |',
      ].join('\n'),
    },
  },
});
await service.apply(scope, {
  artifactId: doc.artifact.id,
  baseVersion: doc.version,
  operations: [
    {
      op: 'insert_block',
      after: 'escopo-p1',
      block: {
        type: 'callout',
        tone: 'warning',
        title: 'Premissa',
        runs: [{ text: 'O ERP expõe APIs REST.' }],
      },
    },
  ],
});
console.log(`document ${doc.artifact.id}`);
await exportAll(doc.artifact);

// Sheet from CSV, then formulas the engine recalculates.
const sheet = await service.create(scope, {
  kind: 'sheet',
  title: 'Estimativa',
  input: { format: 'csv', source: 'Perfil;Horas;Valor hora\nTech Lead;120;165\nDesenvolvedor;320;120' },
});
const sheetId = sheet.artifact.content.sheets[0].id;
const total = await service.apply(scope, {
  artifactId: sheet.artifact.id,
  baseVersion: sheet.version,
  operations: [
    { op: 'set_cells', sheet: sheetId, cells: { D1: { v: 'Total' }, D2: { f: 'B2*C2', fmt: 'currency' } } },
    { op: 'fill_range', sheet: sheetId, source: 'D2', target: 'D2:D3' },
    {
      op: 'set_cells',
      sheet: sheetId,
      cells: { A4: { v: 'Total' }, D4: { f: 'SUM(D2:D3)', fmt: 'currency' } },
    },
  ],
});
console.log(`sheet ${sheet.artifact.id} (total = ${total.artifact.content.sheets[0].cells.D4.v})`);
await exportAll(sheet.artifact);

// Slides with semantic layouts.
const deck = await service.create(scope, {
  kind: 'slides',
  title: 'Apresentação',
  content: {
    slides: [
      { id: 'capa', layout: 'title', slots: { title: 'Portal de Fornecedores', subtitle: 'Proposta 2026' } },
      {
        id: 'impacto',
        layout: 'big-number',
        slots: {
          title: 'O piloto acelerou o cadastro',
          stat: { type: 'stats', items: [{ value: '40%', label: 'mais rápido' }] },
        },
      },
    ],
  },
});
console.log(`slides ${deck.artifact.id}`);
await exportAll(deck.artifact);

// Diagram from Mermaid.
const diagram = await service.create(scope, {
  kind: 'diagram',
  title: 'Arquitetura',
  input: {
    format: 'mermaid',
    source: 'flowchart TB\n  web[Portal] --> api[API]\n  api --> db[(PostgreSQL)]',
  },
});
console.log(`diagram ${diagram.artifact.id}`);
await exportAll(diagram.artifact);

const outline = await service.read(scope, doc.artifact.id, { mode: 'outline' });
console.log(`\nWhat a model reads (outline of the document):\n${outline.text}`);
