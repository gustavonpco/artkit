#!/usr/bin/env node
// Creates one artifact of each native format and exports every file type they support.
// Usage: node generate.mjs [outputDir]
import { resolve } from 'node:path';
import { createArtifactService, createRegistry } from '@artkit-ai/core';
import { markdownDocxExporter } from '@artkit-ai/export-docx';
import { deckPptxExporter } from '@artkit-ai/export-pptx';
import { sheetXlsxExporter } from '@artkit-ai/export-xlsx';
import { markdownFormat } from '@artkit-ai/format-markdown';
import { markdownExporters } from '@artkit-ai/format-markdown/export';
import { openuiFormat } from '@artkit-ai/format-openui';
import { sheetFormat } from '@artkit-ai/format-sheet/server';
import { createFsAssetStore, createFsStore, exportArtifact, writeExportFile } from '@artkit-ai/node';

const outDir = resolve(process.argv[2] ?? 'artkit-output');
const registry = createRegistry({
  formats: [markdownFormat, sheetFormat, openuiFormat],
  exporters: [...markdownExporters, markdownDocxExporter, sheetXlsxExporter, deckPptxExporter],
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

async function exportAll(artifact, targets) {
  for (const target of targets) {
    const result = await exportArtifact(service, scope, { artifactId: artifact.id, format: target });
    const path = await writeExportFile(result, { dir: outDir, overwrite: true });
    const notes = result.warnings.length > 0 ? ` (${result.warnings.length} fidelity warnings)` : '';
    console.log(`  → ${path}${notes}`);
  }
}

const memo = await service.create(scope, {
  format: 'markdown',
  title: 'Proposta técnica',
  content: `---\ncliente: Grupo Meridiano\n---\n# Escopo {#escopo}\n\nPortal de fornecedores com cadastro e homologação.\n\n## Premissas\n\n- Ambiente em nuvem.\n`,
});
console.log(`markdown: ${memo.artifact.id}`);
await exportAll(memo.artifact, ['md', 'html', 'docx']);

const sheet = await service.create(scope, {
  format: 'univer-sheet',
  title: 'Estimativa',
  operations: [
    { op: 'add_sheet', name: 'Estimativa' },
    { op: 'set_values', sheet: 'Estimativa', at: 'A1', values: [['Perfil', 'Horas', 'Valor hora', 'Total']] },
    { op: 'set_values', sheet: 'Estimativa', at: 'A2', values: [['Tech Lead', 120, 165, '=B2*C2']] },
    { op: 'set_format', sheet: 'Estimativa', range: 'D2', format: 'currency' },
  ],
});
console.log(`sheet: ${sheet.artifact.id}`);
await exportAll(sheet.artifact, ['xlsx']);

const deck = await service.create(scope, {
  format: 'openui',
  title: 'Portal de fornecedores',
  content: `root = Deck([capa, escopo])\ncapa = Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])\nescopo = Slide("title-content", [Title("Escopo"), Bullets(["Cadastro e homologação", "Integração Protheus"])])\n`,
});
console.log(`openui: ${deck.artifact.id}`);
await exportAll(deck.artifact, ['pptx']);
