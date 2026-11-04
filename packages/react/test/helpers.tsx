import {
  type ArtifactServiceOptions,
  createArtifactService,
  createMemoryStore,
  createRegistry,
  type EditorBindings,
  type RenderContext,
  type Scope,
} from '@artkit/core';
import { act, type RenderResult, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  type ArtifactLoaders,
  ArtifactProvider,
  type ArtifactProviderProps,
  createServiceClient,
} from '../src/index.js';
import { noteKind } from './note-kind.js';

export const user: Scope = { workspaceId: 'ws', actor: { type: 'user', id: 'u1' } };
export const agent: Scope = { workspaceId: 'ws', actor: { type: 'agent', id: 'a1' } };

export interface NoteContent {
  items: { id: string; text: string }[];
}

type NoteOperation =
  | { op: 'add'; after?: string; id?: string; text: string }
  | { op: 'edit'; id: string; text: string }
  | { op: 'remove'; id: string };

export function setup(options: Partial<ArtifactServiceOptions> = {}) {
  const registry = createRegistry({ kinds: [noteKind] });
  registry.registerExporter({
    kind: 'note',
    format: 'md',
    mimeType: 'text/markdown',
    extension: 'md',
    runtime: 'any',
    async export(content: NoteContent, ctx) {
      ctx.warn('note export is lossy');
      return new TextEncoder().encode(content.items.map((item) => `- ${item.text}`).join('\n'));
    },
  });
  const service = createArtifactService({ registry, store: createMemoryStore(), locale: 'en', ...options });
  return {
    registry,
    service,
    client: createServiceClient(service, user),
    agentClient: createServiceClient(service, agent),
  };
}

export function NoteRenderer({ content, ctx }: { content: NoteContent; ctx: RenderContext }) {
  return (
    <ul data-testid="note" data-provisional={ctx.provisional ? 'true' : 'false'} data-locale={ctx.locale}>
      {content.items.map((item) => (
        <li key={item.id}>{item.text}</li>
      ))}
    </ul>
  );
}

let added = 0;

export function NoteEditor({ content, emit, readOnly }: EditorBindings<NoteContent, NoteOperation>) {
  return (
    <div data-testid="note-editor" data-readonly={readOnly ? 'true' : 'false'}>
      {content.items.map((item) => (
        <input
          key={item.id}
          aria-label={`Item ${item.id}`}
          value={item.text}
          readOnly={readOnly}
          onChange={(event) =>
            emit([{ op: 'edit', id: item.id, text: event.target.value }], { kind: 'typing' })
          }
        />
      ))}
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          added += 1;
          const last = content.items[content.items.length - 1];
          emit([{ op: 'add', id: `x${added}`, text: 'New', ...(last ? { after: last.id } : {}) }]);
        }}
      >
        Add item
      </button>
    </div>
  );
}

export function noteLoaders(extra: Partial<ArtifactLoaders> = {}): ArtifactLoaders {
  return {
    renderers: { note: async () => ({ Renderer: NoteRenderer, css: '.ak-note{color:red}' }) },
    editors: { note: async () => ({ Editor: NoteEditor }) },
    ...extra,
  };
}

export interface ProviderRender extends RenderResult {
  /** Rerenders inside the same provider and waits for suspended renderers/editors to settle. */
  update(ui: ReactNode): Promise<void>;
}

// Lazy renderers suspend on `use(promise)`: rendering inside an awaited act lets React retry them.
export async function renderWithProvider(
  ui: ReactNode,
  props: Omit<ArtifactProviderProps, 'children'>,
): Promise<ProviderRender> {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ArtifactProvider {...props}>{children}</ArtifactProvider>
  );
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(ui, { wrapper });
  });
  const rendered = result!;
  return {
    ...rendered,
    update: async (next) => {
      await act(async () => {
        rendered.rerender(next);
      });
    },
  };
}
