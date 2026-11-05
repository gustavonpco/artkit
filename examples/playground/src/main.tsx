import '@univerjs/preset-sheets-core/lib/index.css';
import './styles.css';
import {
  type ArtifactSummary,
  createArtifactService,
  createMemoryAssetStore,
  createMemoryStore,
  createRegistry,
  defaultTheme,
  type Scope,
} from '@artkit-ai/core';
import { markdownDocxExporter } from '@artkit-ai/export-docx';
import { deckPptxExporter } from '@artkit-ai/export-pptx';
import { sheetXlsxExporter } from '@artkit-ai/export-xlsx';
import { markdownFormat } from '@artkit-ai/format-markdown';
import { markdownExporters } from '@artkit-ai/format-markdown/export';
import { openuiFormat } from '@artkit-ai/format-openui';
import { createSheetFormat } from '@artkit-ai/format-sheet';
import { createUniverEngine } from '@artkit-ai/format-sheet/engine';
import { openuiHtmlExporter } from '@artkit-ai/openui-components/export';
import {
  ArtifactCard,
  ArtifactPanel,
  ArtifactProvider,
  createServiceClient,
  type PanelTab,
  type SaveEvent,
} from '@artkit-ai/react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SCENARIOS, seed } from './seed.js';

// The whole playground runs in the browser: an in-memory store and the Univer engine that the server also uses.
const registry = createRegistry({
  formats: [markdownFormat, createSheetFormat(createUniverEngine()), openuiFormat],
  exporters: [
    ...markdownExporters,
    markdownDocxExporter,
    sheetXlsxExporter,
    deckPptxExporter,
    openuiHtmlExporter,
  ],
});
const service = createArtifactService({
  registry,
  store: createMemoryStore(),
  assets: createMemoryAssetStore(),
  authorize: () => true,
  locale: 'pt-BR',
  defaultArtifactLocale: 'pt-BR',
});
const userScope: Scope = { workspaceId: 'playground', actor: { type: 'user', id: 'voce' } };
const agentScope: Scope = { workspaceId: 'playground', actor: { type: 'agent', id: 'assistente' } };
const client = createServiceClient(service, userScope);
// StrictMode runs effects twice in development: seed exactly once.
const seeded = seed(service, userScope);

const loaders = {
  renderers: {
    markdown: () =>
      import('@artkit-ai/format-markdown/react').then((m) => ({
        Renderer: m.MarkdownRenderer,
        css: m.markdownCss,
      })),
    'univer-sheet': () =>
      import('@artkit-ai/format-sheet/react').then((m) => ({ Renderer: m.SheetRenderer, css: m.sheetCss })),
    openui: () =>
      import('@artkit-ai/openui-components/react').then((m) => ({
        Renderer: m.OpenUIRenderer,
        css: m.componentsCss,
      })),
  },
  editors: {
    markdown: () =>
      import('@artkit-ai/format-markdown/react').then((m) => ({
        Editor: m.MarkdownEditor,
        css: m.markdownCss,
        toolbar: 'format' as const,
      })),
    'univer-sheet': () =>
      import('@artkit-ai/format-sheet/react/univer').then((m) => ({
        Editor: m.UniverSheetEditor,
        css: m.univerCss,
      })),
  },
  exporters: {
    markdown: () => import('@artkit-ai/format-markdown/export').then(() => markdownExporters),
    'univer-sheet': () => Promise.resolve([sheetXlsxExporter]),
    openui: () => Promise.resolve([deckPptxExporter, openuiHtmlExporter]),
  },
};

function Scenario({ artifact, onApplied }: { artifact: ArtifactSummary; onApplied(): void }) {
  const [message, setMessage] = useState('');
  const apply = async () => {
    const ops = SCENARIOS[artifact.format] ?? [];
    try {
      const result = await service.apply(agentScope, {
        artifactId: artifact.id,
        baseVersion: artifact.version,
        operations: ops,
      });
      setMessage(`Versão ${result.version}: ${result.diff.length} mudança(s).`);
      onApplied();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <aside className="pg-scenario" aria-label="Cenário do agente">
      <h2>Agente</h2>
      <p>Um cenário de operações enviado pelo agente com a versão atual como base.</p>
      <button type="button" onClick={apply} disabled={!SCENARIOS[artifact.format]}>
        Aplicar cenário
      </button>
      <p role="status">{message}</p>
    </aside>
  );
}

function App() {
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [selected, setSelected] = useState<string>();
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<PanelTab>('view');
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const page = await service.list(userScope, {}, { limit: 50 });
    setItems(page.items.sort((a, b) => a.title.localeCompare(b.title)));
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    seeded.then(async (ids) => {
      await refresh();
      setSelected(ids[0]);
    });
  }, [refresh]);

  // The harness decides what saving means. The playground persists every save as a new version of the artifact.
  const onSave = useCallback(
    async (event: SaveEvent) => {
      const result = await service.apply(userScope, {
        artifactId: event.artifactId,
        baseVersion: event.baseVersion,
        operations: event.operations,
      });
      setNotice(`Versão ${result.version} salva com ${event.operations.length} operação(ões).`);
      await refresh();
    },
    [refresh],
  );

  const current = items.find((item) => item.id === selected);
  return (
    <ArtifactProvider
      registry={registry}
      client={client}
      loaders={loaders}
      locale="pt-BR"
      theme={defaultTheme}
      colorScheme={scheme}
    >
      <div className="pg-layout">
        <nav className="pg-list" aria-label="Artefatos">
          <h1>artkit</h1>
          {items.map((item) => (
            <ArtifactCard
              key={`${item.id}-${item.version}`}
              artifact={item}
              onOpen={() => setSelected(item.id)}
            />
          ))}
        </nav>
        <main className="pg-main">
          <div className="pg-toolbar">
            <fieldset className="pg-mode">
              <legend>Modo</legend>
              {(['view', 'edit'] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={tab === mode} onClick={() => setTab(mode)}>
                  {mode === 'edit' ? 'Editar' : 'Visualizar'}
                </button>
              ))}
            </fieldset>
            <fieldset className="pg-mode">
              <legend>Tema</legend>
              {(['light', 'dark'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scheme === value}
                  onClick={() => setScheme(value)}
                >
                  {value === 'light' ? 'Claro' : 'Escuro'}
                </button>
              ))}
            </fieldset>
            {notice && (
              <p role="status" className="pg-notice">
                {notice}
              </p>
            )}
          </div>
          {selected && (
            <ArtifactPanel
              key={`${selected}-${tick}`}
              id={selected}
              tab={tab}
              onTabChange={setTab}
              onSave={onSave}
            />
          )}
        </main>
        {current && (
          <Scenario key={`${current.id}-${current.version}`} artifact={current} onApplied={refresh} />
        )}
      </div>
    </ArtifactProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
