// @vitest-environment jsdom

import { defaultTheme } from '@artkit-ai/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editOperations } from '../src/edit.js';
import { MarkdownRenderer } from '../src/react/index.js';

afterEach(cleanup);

// jsdom has no layout: Tiptap measures ranges when it scrolls the selection into view.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const base = '# Escopo {#escopo}\n\nTexto original.\n\n# Cronograma\n\nEntrega em 16 semanas.\n';

describe('markdown edit operations', () => {
  it('turns a changed section into replace_section and leaves the others alone', () => {
    const edited = base.replace('Entrega em 16 semanas.', 'Entrega em 12 semanas.');
    expect(editOperations(base, edited)).toEqual([
      { op: 'replace_section', section: 'cronograma', body: 'Entrega em 12 semanas.' },
    ]);
  });

  it('ignores formatting the editor normalizes', () => {
    const confirmed = base.replace('Texto original.', '_Texto_ original.');
    const normalized = base.replace('Texto original.', '*Texto* original.');
    expect(editOperations(confirmed, normalized)).toEqual([]);
  });

  it('falls back to replace_content when sections are added', () => {
    const added = `${base}\n# Riscos\n\nAtraso.\n`;
    const ops = editOperations(base, added);
    expect(ops).toEqual([expect.objectContaining({ op: 'replace_content' })]);
  });
});

describe('MarkdownRenderer', () => {
  it('renders the document read-only with its headings and table', async () => {
    const { container } = render(
      <MarkdownRenderer
        content={'# Investimento\n\n| Módulo | Horas |\n| --- | --- |\n| Login | 40 |\n'}
        ctx={{ theme: defaultTheme, locale: 'pt-BR', mode: 'screen' }}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(screen.getByRole('heading', { name: 'Investimento' })).toBeTruthy();
  });
});

describe('MarkdownEditor draft actions', () => {
  it('draws undo, redo, the save status and save in its own ribbon, and calls the host actions', async () => {
    const { MarkdownEditor } = await import('../src/react/index.js');
    const actions = {
      canUndo: true,
      canRedo: false,
      undo: vi.fn(),
      redo: vi.fn(),
      dirty: true,
      saving: false,
      canSave: true,
      save: vi.fn(),
    };
    render(
      <MarkdownEditor
        content={base}
        ctx={{ theme: defaultTheme, locale: 'pt-BR', mode: 'screen' }}
        emit={() => {}}
        readOnly={false}
        actions={actions}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Alterações não salvas');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(actions.undo).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Refazer' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('MarkdownToolbar commands', () => {
  async function mount(emit = vi.fn(), content = base) {
    const { MarkdownEditor } = await import('../src/react/index.js');
    render(
      <MarkdownEditor
        content={content}
        ctx={{ theme: defaultTheme, locale: 'pt-BR', mode: 'screen' }}
        emit={emit}
        readOnly={false}
      />,
    );
    // The editor is created after the first render; wait until the toolbar has its commands.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Negrito' })).toBeTruthy());
    return emit;
  }

  it('offers every block and mark of the dialect, and hides the table group outside a table', async () => {
    await mount();
    for (const name of [
      'Negrito',
      'Itálico',
      'Tachado',
      'Código',
      'Link',
      'Limpar formatação',
      'Lista com marcadores',
      'Lista numerada',
      'Lista de tarefas',
      'Aumentar recuo',
      'Diminuir recuo',
      'Citação',
      'Bloco de código',
      'Linha horizontal',
      'Inserir tabela',
    ]) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
    expect(screen.getByRole('combobox', { name: 'Inserir alerta' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Tabela atual' })).toBeNull();
  });

  it('inserts a table from the toolbar and writes it as GFM', async () => {
    const emit = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Inserir tabela' }));
    await waitFor(() => expect(emit).toHaveBeenCalled());
    expect(JSON.stringify(emit.mock.calls)).toMatch(/\| --- \|/);
  });

  it('inserts an alert as the dialect writes it, without the escape', async () => {
    const emit = await mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Inserir alerta' }), {
      target: { value: 'WARNING' },
    });
    await waitFor(() => expect(emit).toHaveBeenCalled());
    const written = JSON.stringify(emit.mock.calls);
    expect(written).toContain('[!WARNING]');
    expect(written).not.toContain('\\\\[!WARNING');
  });

  it('turns the paragraph into a task list', async () => {
    const emit = await mount(vi.fn(), 'Pendência de texto.\n');
    fireEvent.click(screen.getByRole('button', { name: 'Lista de tarefas' }));
    await waitFor(() => expect(emit).toHaveBeenCalled());
    expect(JSON.stringify(emit.mock.calls)).toContain('- [ ]');
  });

  it('opens and closes the link form', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('textbox', { name: 'Endereço do link' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('textbox', { name: 'Endereço do link' })).toBeNull();
  });
});
