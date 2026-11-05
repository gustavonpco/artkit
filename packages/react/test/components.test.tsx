// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactCard, ArtifactEditor, ArtifactPanel, ArtifactView, type SaveEvent } from '../src/index.js';
import { noteLoaders, renderWithProvider, setup, user } from './helpers.js';

afterEach(() => cleanup());

async function createNote(service: ReturnType<typeof setup>['service'], text = 'one') {
  const created = await service.create(user, {
    format: 'note',
    title: 'Plan',
    content: { items: [{ id: 'a', text }] },
  });
  return created.artifact;
}

describe('ArtifactCard', () => {
  it('shows title, format, version and an open action, without any status', async () => {
    const onOpen = vi.fn();
    const { container } = await renderWithProvider(
      <ArtifactCard artifact={{ id: 'art_1', format: 'note', title: 'Plan', version: 3 }} onOpen={onOpen} />,
      setup(),
    );
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(container.textContent).toContain('v3');
    expect(container.querySelector('[data-status]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /open|abrir/i }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'art_1' }));
  });
});

describe('ArtifactView', () => {
  it('loads by id and falls back to JSON without a renderer', async () => {
    const { service, client } = setup();
    const artifact = await createNote(service);
    await renderWithProvider(<ArtifactView id={artifact.id} />, { ...setup(), client, loaders: {} });
    await waitFor(() => expect(screen.getByText(/"text": "one"/)).toBeTruthy());
  });

  it('renders the format renderer when one is registered', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service, 'hello');
    await renderWithProvider(<ArtifactView artifact={artifact} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    await waitFor(() => expect(screen.getByTestId('note').textContent).toContain('hello'));
  });
});

describe('ArtifactEditor', () => {
  it('edits a local draft without calling the server, and Save emits the draft to the application', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service);
    const applySpy = vi.spyOn(service, 'apply');
    const onSave = vi.fn<(event: SaveEvent) => void>();
    await renderWithProvider(<ArtifactEditor artifact={artifact} onSave={onSave} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    const save = await screen.findByRole('button', { name: /^save$|^salvar$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText('Item a'), { target: { value: 'two' } });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    expect(applySpy).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      artifactId: artifact.id,
      baseVersion: 1,
      content: { items: [{ id: 'a', text: 'two' }] },
      operations: [{ op: 'edit', id: 'a', text: 'two' }],
    });
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('saves with Ctrl+S and undoes with the toolbar', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service);
    const onSave = vi.fn();
    await renderWithProvider(<ArtifactEditor artifact={artifact} onSave={onSave} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    fireEvent.change(await screen.findByLabelText('Item a'), { target: { value: 'two' } });
    await waitFor(() => expect(screen.getByLabelText('Undo').hasAttribute('disabled')).toBe(false));
    fireEvent.keyDown(screen.getByTestId('note-editor'), { key: 's', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Undo'));
    await waitFor(() => expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('one'));
  });

  it('follows the artifact the application saves, and shows the view when read-only', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service);
    const { update } = await renderWithProvider(<ArtifactEditor artifact={artifact} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    const saved = await service.apply(user, {
      artifactId: artifact.id,
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'saved' }],
    });
    await update(<ArtifactEditor artifact={saved.artifact} />);
    await waitFor(() => expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('saved'));
    expect(screen.getByRole('status').textContent).toMatch(/saved|salvo/i);
  });

  it('falls back to the view without an editor loader', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service, 'read me');
    await renderWithProvider(<ArtifactEditor artifact={artifact} />, {
      registry,
      client,
      loaders: { renderers: noteLoaders().renderers },
    });
    await waitFor(() => expect(screen.getByTestId('note').textContent).toContain('read me'));
    expect(screen.queryByRole('button', { name: /^save$|^salvar$/i })).toBeNull();
  });
});

describe('ArtifactPanel', () => {
  it('switches between view, edit and code tabs with the keyboard', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service);
    await renderWithProvider(<ArtifactPanel artifact={artifact} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      ['View', 'Edit', 'Code'].map((name) => expect.stringMatching(new RegExp(name, 'i'))),
    );
    await act(async () => fireEvent.click(tabs[2]!));
    await waitFor(() => expect(screen.getByText(/"text": "one"/)).toBeTruthy());
    await act(async () => fireEvent.keyDown(tabs[2]!, { key: 'ArrowLeft' }));
    await waitFor(() => expect(screen.getByLabelText('Item a')).toBeTruthy());
  });

  it('has no history, approval or archive controls', async () => {
    const { service, client, registry } = setup();
    const artifact = await createNote(service);
    const { container } = await renderWithProvider(<ArtifactPanel artifact={artifact} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    const text = container.textContent ?? '';
    expect(text).not.toMatch(
      /history|histórico|approve|aprovar|archive|arquivar|publish|publicar|restore|restaurar/i,
    );
    const panel = within(container);
    expect(panel.getByRole('heading', { name: 'Plan' })).toBeTruthy();
  });
});

describe('ArtifactEditor toolbar ownership', () => {
  it('hides the host toolbar when the format editor draws its own', async () => {
    const { NoteEditor } = await import('./helpers.js');
    const { service, client, registry } = setup();
    const artifact = await createNote(service);
    await renderWithProvider(<ArtifactEditor artifact={artifact} onSave={() => {}} />, {
      registry,
      client,
      loaders: {
        ...noteLoaders(),
        editors: { note: async () => ({ Editor: NoteEditor, toolbar: 'format' as const }) },
      },
    });
    await screen.findByLabelText('Item a');
    expect(screen.queryByLabelText('Undo')).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$|^salvar$/i })).toBeNull();
  });
});
