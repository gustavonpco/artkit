// @vitest-environment jsdom
import type { Artifact } from '@artkit-ai/core';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactApproval,
  ArtifactCard,
  ArtifactEditor,
  ArtifactPanel,
  ArtifactVersionDiff,
  ArtifactView,
  useLatestVersion,
} from '../src/index.js';
import { noteLoaders, renderWithProvider, setup } from './helpers.js';

function LatestVersion({ id }: { id: string }) {
  return <output data-testid="latest">{useLatestVersion(id)}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function seeded(items = [{ id: 'a', text: 'alpha' }]) {
  const env = setup();
  const created = await env.agentClient.create({ kind: 'note', title: 'Plan', content: { items } });
  return { ...env, artifact: created.artifact, id: created.artifact.id };
}

describe('ArtifactProvider and ArtifactView', () => {
  it('renders a committed artifact through the lazy renderer and injects CSS once', async () => {
    const { registry, client, artifact } = await seeded();
    const renderers = { note: vi.fn(noteLoaders().renderers!.note!) };
    await renderWithProvider(
      <>
        <ArtifactView artifact={artifact} className="mine" />
        <ArtifactView artifact={artifact} />
      </>,
      { registry, client, loaders: { renderers }, colorScheme: 'dark' },
    );
    const notes = await screen.findAllByTestId('note');
    expect(notes).toHaveLength(2);
    expect(notes[0]?.textContent).toBe('alpha');
    expect(notes[0]?.getAttribute('data-provisional')).toBe('false');
    expect(renderers.note).toHaveBeenCalledTimes(1);
    const root = notes[0]!.closest('.ak-root')!;
    expect(root.classList.contains('mine')).toBe(true);
    expect(root.getAttribute('data-ak-theme')).toBe('default');
    expect(root.getAttribute('data-theme')).toBe('dark');
    const styles = [...document.head.querySelectorAll('style')].map((style) => style.textContent ?? '');
    expect(styles.filter((css) => css.includes('.ak-button{'))).toHaveLength(1);
    expect(styles.some((css) => css.includes('--ak-color-accent'))).toBe(true);
    expect(styles.filter((css) => css.includes('.ak-note{'))).toHaveLength(1);
  });

  it('loads by id and version, and falls back to JSON without a renderer', async () => {
    const { registry, client, id } = await seeded();
    await client.apply(id, { baseVersion: 1, operations: [{ op: 'edit', id: 'a', text: 'second' }] });
    await renderWithProvider(
      <>
        <ArtifactView id={id} version={1} />
        <ArtifactView id={id} slots={{ body: { className: 'latest-body' } }} />
      </>,
      { registry, client, loaders: noteLoaders() },
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('note').map((node) => node.textContent)).toEqual(['alpha', 'second']),
    );
    expect(screen.getAllByTestId('note')[1]!.closest('.latest-body')).not.toBeNull();
    cleanup();

    await renderWithProvider(<ArtifactView id={id} />, { registry, client });
    expect(await screen.findByText(/No renderer is registered for kind "note"/)).toBeTruthy();
    expect(screen.getByText(/"second"/)).toBeTruthy();
  });

  it('shows load errors with a retry action', async () => {
    const { registry, client } = setup();
    await renderWithProvider(<ArtifactView id="missing" />, { registry, client, loaders: noteLoaders() });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not found');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('renders streamed partial content as a provisional preview until the commit arrives', async () => {
    const { registry, client, agentClient } = setup();
    const props = { registry, client, loaders: noteLoaders() };
    const view = await renderWithProvider(<ArtifactView kind="note" partial='{"items":[' />, props);
    expect(screen.getByText('Preview — not saved yet')).toBeTruthy();

    await view.update(<ArtifactView kind="note" partial='{"items":[{"id":"a","text":"str' />);
    const note = await screen.findByTestId('note');
    expect(note.textContent).toBe('str');
    expect(note.getAttribute('data-provisional')).toBe('true');

    await view.update(<ArtifactView kind="note" partial={{ items: [{ id: 'a', text: 'streamed' }] }} />);
    await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('streamed'));

    // The commit replaces the preview even if the caller still passes the last partial.
    const committed = await agentClient.create({
      kind: 'note',
      title: 'Done',
      content: { items: [{ id: 'a', text: 'final' }] },
    });
    await view.update(
      <ArtifactView artifact={committed.artifact} partial={{ items: [{ id: 'a', text: 'streamed' }] }} />,
    );
    await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('final'));
    expect(screen.queryByText('Preview — not saved yet')).toBeNull();
    expect(screen.getByTestId('note').getAttribute('data-provisional')).toBe('false');
  });

  it('streams an update of an existing artifact and swaps in the new version', async () => {
    const { registry, client, agentClient, artifact, id } = await seeded();
    const view = await renderWithProvider(
      <ArtifactView artifact={artifact} partial={{ items: [{ id: 'a', text: 'rewriting' }] }} />,
      {
        registry,
        client,
        loaders: noteLoaders(),
      },
    );
    expect((await screen.findByTestId('note')).textContent).toBe('rewriting');
    const next = await agentClient.apply(id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'rewritten' }],
    });
    await view.update(
      <ArtifactView artifact={next.artifact} partial={{ items: [{ id: 'a', text: 'rewriting' }] }} />,
    );
    await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('rewritten'));
  });
});

describe('ArtifactCard', () => {
  it('shows title, kind, version and status with an open action', async () => {
    const { registry, client, artifact } = await seeded();
    const onOpen = vi.fn();
    await renderWithProvider(<ArtifactCard artifact={artifact} onOpen={onOpen} streaming />, {
      registry,
      client,
      locale: 'pt-BR',
    });
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('Versão 1')).toBeTruthy();
    expect(screen.getByText('Rascunho')).toBeTruthy();
    expect(screen.getByText('Gerando…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Plan' }));
    expect(onOpen).toHaveBeenCalledWith(artifact);
  });
});

describe('ArtifactPanel', () => {
  it('switches tabs with the keyboard and shows formatted JSON', async () => {
    const { registry, client, id } = await seeded();
    await renderWithProvider(<ArtifactPanel id={id} />, { registry, client, loaders: noteLoaders() });
    await screen.findByTestId('note');
    const viewTab = screen.getByRole('tab', { name: 'View' });
    expect(viewTab.getAttribute('aria-selected')).toBe('true');
    expect(viewTab.tabIndex).toBe(0);
    fireEvent.keyDown(viewTab, { key: 'ArrowRight' });
    const codeTab = screen.getByRole('tab', { name: 'Code' });
    expect(codeTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(codeTab);
    expect(screen.getByRole('tabpanel').textContent).toContain('"text": "alpha"');
    fireEvent.keyDown(codeTab, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
    expect(viewTab.getAttribute('aria-selected')).toBe('true');
  });

  it('lists history, views an old version and restores it as a new version', async () => {
    const { registry, client, id } = await seeded();
    await client.apply(id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'second' }],
      message: 'Edited by hand',
    });
    await renderWithProvider(<ArtifactPanel id={id} defaultTab="history" />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    expect(await screen.findByText('Edited by hand')).toBeTruthy();
    expect(screen.getByText('item:a')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore version 2' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View version 1' }));
    await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('alpha'));
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('1');

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore version 1' }));
    await waitFor(() => expect(screen.getByText(/restored from v1/)).toBeTruthy());
    expect((await client.get(id)).version).toBe(3);
    await waitFor(() =>
      expect(screen.getByRole('status', { hidden: true, name: '' }).textContent).toContain(
        'restored as version 3',
      ),
    );
  });

  it('selects versions and runs lifecycle actions, including reject with a reason', async () => {
    const { registry, client, agentClient, id } = await seeded();
    await client.apply(id, { baseVersion: 1, operations: [{ op: 'edit', id: 'a', text: 'second' }] });
    await renderWithProvider(<ArtifactPanel id={id} />, { registry, client, loaders: noteLoaders() });
    await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('second'));
    const select = screen.getByLabelText('Version') as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(2));
    fireEvent.change(select, { target: { value: '1' } });
    await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('alpha'));
    fireEvent.change(select, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(screen.getByText('Pending approval')).toBeTruthy());
    expect((await agentClient.get(id)).status).toBe('pending_approval');

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Missing totals' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByText('Draft')).toBeTruthy());
    expect((await client.get(id)).status).toBe('draft');
  });

  it('exports through a browser exporter from the menu and downloads the file', async () => {
    const { registry, client, id } = await seeded();
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const serverExport = vi.spyOn(client, 'export');
    await renderWithProvider(<ArtifactPanel id={id} />, {
      registry,
      client,
      loaders: noteLoaders(),
      exportFormats: { note: ['pdf'] },
    });
    await screen.findByTestId('note');
    const button = screen.getByRole('button', { name: 'Export' });
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['PDF', 'MD']);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export as MD' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(serverExport).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('note export is lossy')).toBeTruthy();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('ArtifactApproval', () => {
  async function pending() {
    const env = await seeded();
    await env.agentClient.setStatus(env.id, 'submit');
    await env.client.setStatus(env.id, 'approve');
    const edited = await env.agentClient.apply(env.id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'a', text: 'changed' }],
    });
    await env.agentClient.setStatus(env.id, 'submit');
    return { ...env, edited: edited.artifact };
  }

  it('diffs the pending version against the published one and approves it', async () => {
    const { registry, client, id } = await pending();
    const onApproved = vi.fn();
    await renderWithProvider(<ArtifactApproval id={id} onApproved={onApproved} />, { registry, client });
    expect(await screen.findByText('Compared with version 1', { exact: false })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('item:a')).toBeTruthy());
    expect(screen.getByText('changed', { exact: false, selector: 'td' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1));
    expect((onApproved.mock.calls[0]![0] as Artifact).status).toBe('published');
    expect(await screen.findByText('This artifact is not waiting for approval.')).toBeTruthy();
  });

  it('requires a reason to reject', async () => {
    const { registry, client, id } = await pending();
    const onRejected = vi.fn();
    await renderWithProvider(<ArtifactApproval id={id} onRejected={onRejected} />, {
      registry,
      client,
      locale: 'pt-BR',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Rejeitar' }));
    const field = screen.getByLabelText('Motivo da rejeição');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: 'Confirmar rejeição' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(field, { target: { value: 'Faltam totais' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rejeição' }));
    await waitFor(() =>
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }), 'Faltam totais'),
    );
  });

  it('shows permission errors from the client', async () => {
    const { registry, agentClient, id } = await pending();
    await renderWithProvider(<ArtifactApproval id={id} />, { registry, client: agentClient });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toContain('denied');
  });
});

describe('ArtifactVersionDiff', () => {
  it('lists structural changes and a highlighted or side-by-side line diff', async () => {
    const { registry, client, id } = await seeded([
      { id: 'a', text: 'alpha' },
      { id: 'b', text: 'beta' },
    ]);
    await client.apply(id, {
      baseVersion: 1,
      operations: [
        { op: 'edit', id: 'b', text: 'BETA' },
        { op: 'add', after: 'b', id: 'c', text: 'gamma' },
        { op: 'set_title', title: 'Plan v2' },
      ],
    });
    await renderWithProvider(<ArtifactVersionDiff id={id} from={1} to={2} />, { registry, client });
    expect(await screen.findByText('item:b')).toBeTruthy();
    expect(screen.getByText('item:c')).toBeTruthy();
    expect(screen.getByText('envelope:title')).toBeTruthy();

    const table = screen.getByRole('table');
    expect(table.getAttribute('data-layout')).toBe('unified');
    const inserted = table.querySelectorAll('tr[data-type="insert"]');
    const deleted = table.querySelectorAll('tr[data-type="delete"]');
    expect([...inserted].map((row) => row.lastElementChild?.textContent)).toEqual([
      'BETA <!-- #b -->',
      'gamma <!-- #c -->',
    ]);
    expect([...deleted].map((row) => row.lastElementChild?.textContent)).toEqual(['beta <!-- #b -->']);
    expect(within(table).getAllByText('added')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    const split = screen.getByRole('table');
    expect(split.getAttribute('data-layout')).toBe('split');
    expect(within(split).getByText('Version 1')).toBeTruthy();
    expect(within(split).getByText('Version 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Side by side' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ArtifactEditor', () => {
  it('falls back to the view without an editor loader or with read permission', async () => {
    const { registry, client, artifact } = await seeded();
    const editors = { note: vi.fn(noteLoaders().editors!.note!) };
    await renderWithProvider(<ArtifactEditor artifact={artifact} permission="read" />, {
      registry,
      client,
      loaders: { ...noteLoaders(), editors },
    });
    expect(await screen.findByTestId('note')).toBeTruthy();
    expect(editors.note).not.toHaveBeenCalled();
    cleanup();
    await renderWithProvider(<ArtifactEditor artifact={artifact} />, {
      registry,
      client,
      loaders: { renderers: noteLoaders().renderers! },
    });
    expect(await screen.findByTestId('note')).toBeTruthy();
  });

  it('is read-only with a streaming preview while another actor holds the lock', async () => {
    const { registry, client, artifact } = await seeded();
    await renderWithProvider(
      <ArtifactEditor
        artifact={artifact}
        lockedBy={{ type: 'agent', id: 'a1' }}
        partial={{ items: [{ id: 'a', text: 'agent typing' }] }}
      />,
      { registry, client, loaders: noteLoaders() },
    );
    expect(await screen.findByText('Locked by the agent — editing is disabled.')).toBeTruthy();
    expect((await screen.findByTestId('note')).textContent).toBe('agent typing');
    expect(screen.queryByTestId('note-editor')).toBeNull();
  });

  it('batches typing, saves a version, undoes with the keyboard and announces it', async () => {
    const { registry, client, artifact, id } = await seeded();
    const onCommitted = vi.fn();
    await renderWithProvider(
      <>
        <ArtifactEditor artifact={artifact} groupingWindowMs={30} onCommitted={onCommitted} />
        <LatestVersion id={id} />
      </>,
      { registry, client, loaders: noteLoaders() },
    );
    const input = (await screen.findByLabelText('Item a')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'alpha!' } });
    fireEvent.change(input, { target: { value: 'alpha!!' } });
    expect(input.value).toBe('alpha!!');
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    expect((await client.history(id)).items[0]?.operations).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId('latest').textContent).toBe('2'));

    const editorRegion = screen.getByRole('region', { name: 'Editor for Plan' });
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    await waitFor(() => expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('alpha'));
    await waitFor(() =>
      expect(
        within(editorRegion)
          .getAllByRole('status')
          .some((node) => node.textContent === 'Change undone'),
      ).toBe(true),
    );
    expect((await client.get(id)).version).toBe(3);

    fireEvent.click(within(editorRegion).getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('alpha!!'));
    expect((await client.get(id)).version).toBe(4);
  });

  it('rolls back and shows the error when the server rejects the batch', async () => {
    const { registry, client, artifact } = await seeded();
    vi.spyOn(client, 'apply').mockRejectedValue(
      new (await import('@artkit-ai/core')).ArtifactError('PERMISSION_DENIED', 'Action "apply" denied.'),
    );
    const onError = vi.fn();
    await renderWithProvider(<ArtifactEditor artifact={artifact} onError={onError} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('denied');
    expect(screen.queryByLabelText('Item x1')).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers keep-agent-version or reapply on a version conflict', async () => {
    const { registry, client, agentClient, artifact, id } = await seeded();
    await renderWithProvider(<ArtifactEditor artifact={artifact} />, {
      registry,
      client,
      loaders: noteLoaders(),
    });
    const input = await screen.findByLabelText('Item a');
    await agentClient.apply(id, { baseVersion: 1, operations: [{ op: 'edit', id: 'a', text: 'agent' }] });
    fireEvent.change(input, { target: { value: 'mine' } });
    act(() => {
      fireEvent.blur(input);
    });
    expect(
      await screen.findByText('Your edit conflicts with a newer version', { selector: 'h3' }),
    ).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('agent'));
    expect(screen.getByTestId('note-editor').getAttribute('data-readonly')).toBe('true');
    const keep = screen.getByRole('button', { name: 'Keep agent version' });
    expect(document.activeElement).toBe(keep);
    fireEvent.click(screen.getByRole('button', { name: 'Reapply my edit' }));
    await waitFor(() => expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('mine'));
    await waitFor(async () => expect((await client.get(id)).version).toBe(3));
    expect(screen.queryByText('Your edit conflicts with a newer version', { selector: 'h3' })).toBeNull();
  });

  it('rebases pending typing onto agent versions that arrive while editing', async () => {
    const { registry, client, agentClient, artifact, id } = await seeded([
      { id: 'a', text: 'alpha' },
      { id: 'b', text: 'beta' },
    ]);
    const props = { registry, client, loaders: noteLoaders() };
    const view = await renderWithProvider(
      <ArtifactEditor artifact={artifact} groupingWindowMs={5000} />,
      props,
    );
    fireEvent.change(await screen.findByLabelText('Item a'), { target: { value: 'typing' } });
    const next = await agentClient.apply(id, {
      baseVersion: 1,
      operations: [{ op: 'edit', id: 'b', text: 'agent' }],
    });
    await view.update(<ArtifactEditor artifact={next.artifact} groupingWindowMs={5000} />);
    await waitFor(() => expect((screen.getByLabelText('Item b') as HTMLInputElement).value).toBe('agent'));
    expect((screen.getByLabelText('Item a') as HTMLInputElement).value).toBe('typing');
    expect(await screen.findByText('The artifact was updated to version 2')).toBeTruthy();
    fireEvent.blur(screen.getByLabelText('Item a'));
    await waitFor(async () =>
      expect((await client.get(id)).content).toEqual({
        items: [
          { id: 'a', text: 'typing' },
          { id: 'b', text: 'agent' },
        ],
      }),
    );
  });
});
