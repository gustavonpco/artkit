import {
  type ArtifactSummary,
  createArtifactService,
  createMemoryAssetStore,
  createMemoryStore,
  createRegistry,
  type ProjectionMode,
  type Scope,
  toModelError,
} from '@artkit/core';
import { diagramKind } from '@artkit/kind-diagram';
import { documentKind } from '@artkit/kind-document';
import { sheetKind } from '@artkit/kind-sheet';
import { slidesKind } from '@artkit/kind-slides';
import { ArtifactCard, ArtifactPanel, ArtifactProvider, createServiceClient } from '@artkit/react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SCENARIOS, seed } from './seed.js';

const registry = createRegistry({ kinds: [documentKind, sheetKind, slidesKind, diagramKind] });
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
// StrictMode runs effects twice in development; seed exactly once.
const seeded = seed(service, userScope);

const loaders = {
  renderers: {
    document: () =>
      import('@artkit/kind-document/react').then((m) => ({
        Renderer: m.DocumentRenderer,
        css: m.documentCss,
      })),
    sheet: () =>
      import('@artkit/kind-sheet/react').then((m) => ({ Renderer: m.SheetRenderer, css: m.sheetCss })),
    slides: () =>
      import('@artkit/kind-slides/react').then((m) => ({ Renderer: m.SlidesRenderer, css: m.slidesCss })),
    diagram: () =>
      import('@artkit/kind-diagram/react').then((m) => ({ Renderer: m.DiagramRenderer, css: m.diagramCss })),
  },
  editors: {
    document: () =>
      import('@artkit/kind-document/edit').then((m) => ({
        Editor: m.DocumentEditor,
        css: m.documentEditorCss,
      })),
    sheet: () =>
      import('@artkit/kind-sheet/edit').then((m) => ({ Editor: m.SheetEditor, css: m.sheetEditorCss })),
    slides: () =>
      import('@artkit/kind-slides/edit').then((m) => ({ Editor: m.SlidesEditor, css: m.slidesEditorCss })),
    diagram: () =>
      import('@artkit/kind-diagram/edit').then((m) => ({ Editor: m.DiagramEditor, css: m.diagramEditorCss })),
  },
  exporters: {
    document: () => import('@artkit/kind-document/export').then((m) => m.documentExporters),
    sheet: () => import('@artkit/kind-sheet/export').then((m) => m.sheetExporters),
    slides: () => import('@artkit/kind-slides/export').then((m) => m.slidesExporters),
    diagram: () => import('@artkit/kind-diagram/export').then((m) => m.diagramExporters),
  },
};

function AgentView({ id, version, onApplied }: { id: string; version: number; onApplied(): void }) {
  const [mode, setMode] = useState<ProjectionMode>('outline');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [ops, setOps] = useState('');
  const [result, setResult] = useState('');

  // `version` is a dependency on purpose: the projection is reread after every commit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh trigger
  useEffect(() => {
    service.read(agentScope, id, { mode, maxTokens: 4000 }).then((read) => {
      setText(read.text);
      setKind(read.artifact.kind);
    });
  }, [id, mode, version]);

  useEffect(() => {
    if (kind) setOps(JSON.stringify(SCENARIOS[kind] ?? [], null, 2));
  }, [kind]);

  const apply = async () => {
    try {
      const operations = JSON.parse(ops) as unknown[];
      const out = await service.apply(agentScope, { artifactId: id, baseVersion: version, operations });
      setResult(
        `✓ versão ${out.version}${out.rebased ? ' (rebase automático)' : ''}\n${out.diff.map((d) => `• ${d.summary}`).join('\n')}${out.lint.length ? `\nlint: ${out.lint.map((l) => l.message).join('; ')}` : ''}`,
      );
      onApplied();
    } catch (error) {
      setResult(
        JSON.stringify(
          error instanceof SyntaxError ? { error: error.message } : toModelError(error, 'pt-BR'),
          null,
          2,
        ),
      );
    }
  };

  return (
    <aside className="pg-agent" aria-label="Visão do agente">
      <h2>Visão do agente</h2>
      <label>
        Projeção{' '}
        <select value={mode} onChange={(e) => setMode(e.target.value as ProjectionMode)}>
          <option value="outline">outline</option>
          <option value="full">full</option>
        </select>
      </label>
      <pre className="pg-pre">{text}</pre>
      <h2>Cenário de operações</h2>
      <textarea
        value={ops}
        onChange={(e) => setOps(e.target.value)}
        rows={10}
        spellCheck={false}
        aria-label="Operações em JSON"
      />
      <button type="button" onClick={apply}>
        Aplicar como agente (base v{version})
      </button>
      {result && <pre className="pg-pre">{result}</pre>}
    </aside>
  );
}

function App() {
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [selected, setSelected] = useState<string>();
  const [tick, setTick] = useState(0);
  const [permission, setPermission] = useState<'edit' | 'read'>('edit');

  const refresh = useCallback(async () => {
    const page = await service.list(userScope, {}, { limit: 50 });
    setItems(page.items.sort((a, b) => a.title.localeCompare(b.title)));
  }, []);

  useEffect(() => {
    seeded.then(async (ids) => {
      await refresh();
      setSelected(ids[0]);
    });
  }, [refresh]);

  const current = items.find((item) => item.id === selected);
  return (
    <ArtifactProvider registry={registry} client={client} loaders={loaders} locale="pt-BR">
      <div className="pg-layout">
        <nav className="pg-list" aria-label="Artefatos">
          <h1>artkit playground</h1>
          {items.map((item) => (
            <ArtifactCard
              key={`${item.id}-${item.version}`}
              artifact={item}
              onOpen={() => setSelected(item.id)}
            />
          ))}
        </nav>
        <main className="pg-main">
          <fieldset className="ak-root pg-mode">
            <legend className="ak-sr-only">Modo</legend>
            {(['edit', 'read'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="ak-button"
                data-variant={permission === mode ? 'primary' : 'quiet'}
                aria-pressed={permission === mode}
                onClick={() => setPermission(mode)}
              >
                {mode === 'edit' ? 'Editar' : 'Visualizar'}
              </button>
            ))}
          </fieldset>
          {selected && (
            <ArtifactPanel key={`${selected}-${tick}-${permission}`} id={selected} permission={permission} />
          )}
        </main>
        {current && (
          <AgentView
            key={current.id}
            id={current.id}
            version={current.version}
            onApplied={async () => {
              await refresh();
              setTick((t) => t + 1);
            }}
          />
        )}
      </div>
    </ArtifactProvider>
  );
}

const css = `
  body { margin: 0; font-family: "Sora", "Segoe UI", system-ui, sans-serif; background: #f4f7f7; color: #1d2f3c; }
  @media (prefers-color-scheme: dark) { body { background: #1d2f3c; color: #ffffff; } .pg-agent { background: #263744 !important; } .pg-pre { background: #1d2f3c !important; } }
  .pg-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr) 380px; height: 100vh; }
  .pg-list { padding: 16px; overflow: auto; border-right: 1px solid #dde3e8; display: flex; flex-direction: column; gap: 8px; }
  .pg-list h1 { font-size: 16px; margin: 0 0 8px; }
  .pg-main { overflow: auto; padding: 16px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .pg-mode { display: flex; gap: 8px; border: 0; margin: 0; padding: 0; min-inline-size: 0; }
  .pg-agent { padding: 16px; overflow: auto; border-left: 1px solid #dde3e8; display: flex; flex-direction: column; gap: 8px; background: #fff; }
  .pg-agent h2 { font-size: 14px; margin: 8px 0 0; }
  .pg-pre { white-space: pre-wrap; font-size: 11px; background: #f3f6f8; padding: 8px; border-radius: 6px; max-height: 320px; overflow: auto; margin: 0; }
  .pg-agent textarea { font-family: ui-monospace, monospace; font-size: 11px; }
  .pg-agent button { padding: 8px; cursor: pointer; }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
