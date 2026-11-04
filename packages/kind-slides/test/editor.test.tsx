// @vitest-environment jsdom
import {
  applyOperations,
  createRegistry,
  defaultTheme,
  type EmitOptions,
  type LintIssue,
  type RenderContext,
} from '@artkit/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SlidesEditor } from '../src/edit/index.js';
import { type SlidesContent, type SlidesOperation, slidesKind } from '../src/index.js';
import { fullDeck } from './fixtures.js';

const registry = createRegistry({ kinds: [slidesKind] });
const ctx: RenderContext = { theme: defaultTheme, locale: 'en', mode: 'screen' };

interface Batch {
  ops: SlidesOperation[];
  options?: EmitOptions;
}

interface SetupOptions {
  slideId?: string;
  readOnly?: boolean;
  lint?: LintIssue[];
  uploadImage?: (file: File) => Promise<{ asset: string; alt?: string }>;
}

interface Recorder {
  batches: Batch[];
  latest: SlidesContent;
}

/** Host stand-in: records emitted batches and applies them optimistically through the kind. */
function Harness({ options, recorder }: { options: SetupOptions; recorder: Recorder }) {
  const [content, setContent] = useState(recorder.latest);
  const emit = (ops: SlidesOperation[], emitOptions?: EmitOptions) => {
    recorder.batches.push({ ops, ...(emitOptions ? { options: emitOptions } : {}) });
    const result = applyOperations(
      registry,
      { kind: 'slides', content, title: 'Deck', themeId: 'default', locale: 'en' },
      ops,
    );
    recorder.latest = result.content as SlidesContent;
    setContent(recorder.latest);
  };
  return (
    <SlidesEditor
      content={content}
      ctx={ctx}
      emit={emit}
      readOnly={options.readOnly ?? false}
      lint={options.lint ?? []}
      {...(options.slideId ? { initialSlideId: options.slideId } : {})}
      {...(options.uploadImage ? { uploadImage: options.uploadImage } : {})}
    />
  );
}

function setup(options: SetupOptions = {}) {
  const recorder: Recorder = { batches: [], latest: slidesKind.contentSchema.parse(fullDeck) };
  const view = render(<Harness options={options} recorder={recorder} />);
  return { ...view, batches: recorder.batches, content: () => recorder.latest };
}

const hit = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`.ak-slides-hit[data-element-id="${id}"]`)!;
const canvas = (container: HTMLElement) => container.querySelector<HTMLElement>('.ak-slides-canvas')!;

/** Pointer down selects (and starts a drag immediately); the pointer is released without moving. */
function select(
  container: HTMLElement,
  id: string,
  extra: { shiftKey?: boolean; clientX?: number; clientY?: number } = {},
) {
  act(() => {
    fireEvent.pointerDown(hit(container, id), { button: 0, ...extra });
  });
  act(() => {
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: extra.clientX ?? 0, clientY: extra.clientY ?? 0 }),
    );
  });
}

beforeAll(() => {
  // react-moveable asks the document which element is under the pointer when a gesture ends.
  (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => document.body;
});

afterEach(cleanup);

describe('SlidesEditor gestures', () => {
  it('a drag emits one update_element at the end, as a continuous gesture', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    const init = { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 };
    act(() => {
      // Pressing on an unselected element selects it and starts dragging right away.
      fireEvent.pointerDown(hit(container, 'photo'), init);
    });
    expect(container.querySelector('.moveable-control-box')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: 64, clientY: 100 }));
      window.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: 28, clientY: 100 }));
    });
    expect(batches).toHaveLength(0);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { ...init, clientX: 28, clientY: 100 }));
    });
    expect(batches).toEqual([
      { ops: [{ op: 'update_element', element: 'photo', set: { x: 6.8 } }], options: { kind: 'continuous' } },
    ]);
  });

  it('a resize handle emits one update_element with the new size', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'headline');
    const handle = container.querySelector<HTMLElement>('.moveable-control[data-direction="se"]')!;
    expect(handle).not.toBeNull();
    const init = { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 };
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', init));
      window.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: -36, clientY: 36 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { ...init, clientX: -36, clientY: 36 }));
    });
    expect(batches).toEqual([
      {
        ops: [{ op: 'update_element', element: 'headline', set: { w: 11.6, h: 1.5 } }],
        options: { kind: 'continuous' },
      },
    ]);
  });

  it('dragging next to another element snaps to its edge and shows a guide while moving', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'photo');
    const init = { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 };
    act(() => {
      hit(container, 'photo').dispatchEvent(new MouseEvent('mousedown', init));
      // 1.37 in left: x would be 6.43, within the threshold of the panel's right edge (6.4).
      window.dispatchEvent(new MouseEvent('mousemove', { ...init, clientX: -98.64 }));
    });
    expect(container.querySelector('.ak-slides-guide-x')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { ...init, clientX: -98.64 }));
    });
    expect(batches[0]!.ops[0]).toEqual({ op: 'update_element', element: 'photo', set: { x: 6.4 } });
    expect(container.querySelector('.ak-slides-guide')).toBeNull();
  });
});

describe('SlidesEditor keyboard', () => {
  it('nudges, resizes, duplicates and deletes the selection', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'photo');
    fireEvent.keyDown(canvas(container), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(container), { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(canvas(container), { key: 'ArrowLeft', altKey: true });
    expect(batches.map((batch) => batch.ops[0])).toEqual([
      { op: 'update_element', element: 'photo', set: { x: 7.85, y: 1.8 } },
      { op: 'update_element', element: 'photo', set: { x: 7.85, y: 2.3 } },
      { op: 'update_element', element: 'photo', set: { w: 4.85, h: 2.4 } },
    ]);
    expect(batches.every((batch) => batch.options?.kind === 'typing')).toBe(true);
    fireEvent.keyDown(canvas(container), { key: 'd', ctrlKey: true });
    expect(batches.at(-1)!.ops[0]).toMatchObject({
      op: 'add_element',
      slide: 'custom',
      element: { type: 'image', asset: 'asset://photo' },
    });
    // The duplicate is selected (like presentation apps), so Delete removes the copy.
    fireEvent.keyDown(canvas(container), { key: 'Delete' });
    expect(batches.at(-1)!.ops).toEqual([{ op: 'remove_element', element: 'img1' }]);
  });

  it('selects all and aligns a multi-selection', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'photo');
    select(container, 'chart1', { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
    // Both already share the left edge: nothing to emit.
    expect(batches).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Align bottom' }));
    expect(batches.at(-1)!.ops).toEqual([
      { op: 'update_element', element: 'photo', set: { x: 7.8, y: 4.4 } },
    ]);
    fireEvent.keyDown(canvas(container), { key: 'a', ctrlKey: true });
    expect(screen.getByRole('heading', { name: '5 elements' })).toBeTruthy();
  });

  it('read-only mode emits nothing', () => {
    const { container, batches } = setup({ slideId: 'custom', readOnly: true });
    select(container, 'photo');
    fireEvent.keyDown(canvas(container), { key: 'Delete' });
    expect(container.querySelector('.moveable-control-box')).toBeNull();
    expect(batches).toEqual([]);
  });
});

describe('SlidesEditor panels', () => {
  it('thumbnail actions reorder, duplicate, hide and delete slides', () => {
    const { batches } = setup();
    const actions = screen.getByRole('group', { name: /Actions for Slide 1/ });
    fireEvent.click(within(actions).getByRole('button', { name: 'Move down' }));
    expect(batches[0]!.ops).toEqual([{ op: 'move_slide', slide: 'cover', position: 2 }]);
    const second = screen.getByRole('group', { name: /Actions for Slide 2: Supplier portal/ });
    fireEvent.click(within(second).getByRole('button', { name: 'Duplicate slide' }));
    fireEvent.click(within(second).getByRole('button', { name: 'Hide slide' }));
    fireEvent.click(within(second).getByRole('button', { name: 'Delete slide' }));
    expect(batches.slice(1).map((batch) => batch.ops[0]!.op)).toEqual([
      'duplicate_slide',
      'set_hidden',
      'remove_slide',
    ]);
  });

  it('drag and drop on the thumbnails moves a slide', () => {
    const { container, batches } = setup();
    const items = container.querySelectorAll<HTMLLIElement>('.ak-slides-panel > ol > li');
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      effectAllowed: 'move',
    };
    fireEvent.dragStart(items[4]!, { dataTransfer });
    fireEvent.dragOver(items[1]!, { dataTransfer });
    fireEvent.drop(items[1]!, { dataTransfer });
    expect(batches[0]!.ops).toEqual([{ op: 'move_slide', slide: 'growth', position: 2 }]);
  });

  it('keyboard moves a slide with Alt+arrows', () => {
    const { batches } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Slide 2:/ }), { key: 'ArrowUp', altKey: true });
    expect(batches[0]!.ops).toEqual([{ op: 'move_slide', slide: 'problem', position: 1 }]);
  });

  it('inserts a slide with the chosen layout and selects it', () => {
    const { batches, container } = setup();
    fireEvent.change(screen.getByLabelText('New slide layout'), { target: { value: 'big-number' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }));
    expect(batches[0]!.ops).toEqual([
      { op: 'add_slide', after: 'cover', slide: { id: 's1', layout: 'big-number', slots: {}, elements: [] } },
    ]);
    expect(container.querySelector('.ak-slides-canvas .ak-slides-slide')?.getAttribute('data-slide-id')).toBe(
      's1',
    );
    expect(container.querySelectorAll('.ak-slides-slot-empty').length).toBe(3);
  });

  it('changes the layout and slide properties from the inspector', () => {
    const { batches } = setup();
    fireEvent.change(
      within(screen.getByRole('complementary', { name: 'Properties' })).getByLabelText('Layout'),
      {
        target: { value: 'section' },
      },
    );
    expect(batches[0]!.ops).toEqual([{ op: 'set_layout', slide: 'cover', layout: 'section' }]);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Background' })).getByRole('button', { name: 'surface' }),
    );
    expect(batches[1]!.ops).toEqual([
      { op: 'set_background', slide: 'cover', background: { color: 'surface' } },
    ]);
    const notes = screen.getByLabelText('Speaker notes');
    fireEvent.change(notes, { target: { value: 'New notes' } });
    fireEvent.blur(notes);
    expect(batches[2]).toEqual({
      ops: [{ op: 'set_notes', slide: 'cover', notes: 'New notes' }],
      options: { kind: 'typing' },
    });
  });

  it('edits the deck footer', () => {
    const { batches } = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'Slide numbers' }));
    expect(batches[0]!.ops).toEqual([{ op: 'set_footer', footer: { text: 'Acme · Confidential' } }]);
  });
});

describe('SlidesEditor content editing', () => {
  it('inserts a text element with a deterministic id and edits it in place', () => {
    const { container, batches, content } = setup({ slideId: 'custom' });
    fireEvent.click(screen.getByRole('button', { name: 'Text box' }));
    expect(batches[0]!.ops[0]).toMatchObject({
      op: 'add_element',
      slide: 'custom',
      element: { id: 'txt1', type: 'text', paragraphs: ['Text'] },
    });
    const editor = screen.getByRole('textbox', { name: 'Edit text' });
    editor.innerHTML =
      '<div>Hello <span style="font-weight: 700">bold</span></div><div data-list="bullet">Item</div>';
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(batches[1]).toEqual({
      ops: [
        {
          op: 'update_element',
          element: 'txt1',
          set: {
            paragraphs: [
              { runs: [{ text: 'Hello ' }, { text: 'bold', bold: true }] },
              { text: 'Item', list: 'bullet' },
            ],
          },
        },
      ],
      options: { kind: 'typing' },
    });
    expect(container.querySelector('[role="textbox"]')).toBeNull();
    expect(
      content()
        .slides.find((slide) => slide.id === 'custom')!
        .elements.at(-1)!.id,
    ).toBe('txt1');
  });

  it('formats a selection with the toolbar before committing', () => {
    const { batches } = setup({ slideId: 'custom' });
    select(document.body, 'headline');
    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }));
    const editor = screen.getByRole('textbox', { name: 'Edit text' });
    const textNode = editor.querySelector('span')!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: 'Text formatting' })).getByRole('button', {
        name: 'Italic',
      }),
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit text' }), { key: 'Enter', ctrlKey: true });
    expect(batches[0]!.ops[0]).toEqual({
      op: 'update_element',
      element: 'headline',
      set: { paragraphs: [{ runs: [{ text: 'Three', italic: true }, { text: ' markets' }] }] },
    });
  });

  it('edits a slot in place: double click, type, commit as a plain string', () => {
    const { container, batches } = setup();
    fireEvent.doubleClick(container.querySelector('.ak-slides-slot-box[data-slot="title"]')!);
    const editor = screen.getByRole('textbox', { name: 'Edit text' });
    editor.innerHTML = '<div>New deck title</div>';
    fireEvent.blur(editor);
    expect(batches[0]).toEqual({
      ops: [{ op: 'set_slot', slide: 'cover', slot: 'title', content: 'New deck title' }],
      options: { kind: 'typing' },
    });
  });

  it('escape cancels an in-place edit', () => {
    const { container, batches } = setup();
    fireEvent.doubleClick(container.querySelector('.ak-slides-slot-box[data-slot="subtitle"]')!);
    const editor = screen.getByRole('textbox', { name: 'Edit text' });
    editor.innerHTML = '<div>Changed</div>';
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(batches).toEqual([]);
  });

  it('edits a slot table as a grid', () => {
    const { container, batches } = setup({ slideId: 'plan' });
    fireEvent.pointerDown(container.querySelector('.ak-slides-slot-box[data-slot="right"]')!, { button: 0 });
    const cell = screen.getByLabelText('Row 2, column 2');
    fireEvent.change(cell, { target: { value: '14' } });
    fireEvent.blur(cell);
    expect(batches[0]!.ops[0]).toEqual({
      op: 'set_slot',
      slide: 'plan',
      slot: 'right',
      content: {
        type: 'table',
        header: ['Phase', 'Weeks'],
        rows: [
          ['Discovery', '4'],
          ['Build', '14'],
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Row' }));
    expect((batches[1]!.ops[0] as { content: { rows: string[][] } }).content.rows).toHaveLength(3);
  });

  it('edits chart data in the mini spreadsheet with a live preview', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'chart1');
    const input = screen.getByLabelText('Share, B');
    fireEvent.change(input, { target: { value: '55' } });
    expect(container.querySelector('.ak-slides-chart-preview svg')?.getAttribute('aria-label')).toContain(
      'B 55',
    );
    expect(batches).toEqual([]);
    fireEvent.blur(input);
    expect(batches[0]!.ops[0]).toEqual({
      op: 'update_element',
      element: 'chart1',
      set: { categories: ['A', 'B'], series: [{ name: 'Share', values: [60, 55] }] },
    });
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'column' } });
    expect(batches[1]!.ops[0]).toEqual({
      op: 'update_element',
      element: 'chart1',
      set: { chartType: 'column' },
    });
  });

  it('edits stats items of a slot', () => {
    const { container, batches } = setup({ slideId: 'kpis' });
    fireEvent.pointerDown(container.querySelector('.ak-slides-slot-box[data-slot="stat"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(batches[0]!.ops[0]).toMatchObject({
      op: 'set_slot',
      slot: 'stat',
      content: { type: 'stats', items: [{ value: '40%' }, { value: '3x' }, { value: '0', label: '' }] },
    });
  });

  it('changes element style and order from the inspector', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'headline');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Text color' })).getByRole('button', { name: 'accent' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to back' }));
    const size = screen.getByLabelText('Font size');
    fireEvent.change(size, { target: { value: '40' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(batches.map((batch) => batch.ops[0])).toEqual([
      { op: 'update_element', element: 'headline', set: { color: 'accent' } },
      { op: 'reorder_element', element: 'headline', to: 'back' },
      { op: 'update_element', element: 'headline', set: { fontSize: 40 } },
    ]);
  });

  it('uploads images through the host callback', async () => {
    const { batches } = setup({
      slideId: 'custom',
      uploadImage: async (file) => ({ asset: 'asset://up1', alt: file.name }),
    });
    const input = document.querySelector<HTMLInputElement>('.ak-slides-editor input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });
    });
    expect(batches[0]!.ops[0]).toMatchObject({
      op: 'add_element',
      element: { type: 'image', asset: 'asset://up1', alt: 'logo.png', id: 'img1' },
    });
  });

  it('shows the lint overflow indicator on elements and slots', () => {
    const lint: LintIssue[] = [
      { code: 'text-overflow', severity: 'warning', target: 'element:headline', message: 'Too long' },
      { code: 'text-overflow', severity: 'warning', target: 'slot:custom.title', message: 'x' },
    ];
    const { container } = setup({ slideId: 'custom', lint });
    expect(hit(container, 'headline').className).toContain('ak-slides-overflow');
    expect(hit(container, 'headline').getAttribute('title')).toBe('Too long');
    select(container, 'headline');
    expect(screen.getByText('Too long')).toBeTruthy();
  });
});

describe('SlidesEditor standard toolbar', () => {
  it('copies and pastes elements with fresh ids and selects the copies', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'photo');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(batches.at(-1)!.ops[0]).toMatchObject({
      op: 'add_element',
      slide: 'custom',
      element: { id: 'img1', type: 'image', asset: 'asset://photo' },
    });
  });

  it('inserts a chart of the chosen type from the menu', () => {
    const { batches } = setup({ slideId: 'custom' });
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pie chart' }));
    expect(batches.at(-1)!.ops[0]).toMatchObject({
      op: 'add_element',
      element: { type: 'chart', chartType: 'pie' },
    });
  });

  it('aligns and reorders the selection from the menus', () => {
    const { container, batches } = setup({ slideId: 'custom' });
    select(container, 'photo');
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Align left' }));
    expect(batches.at(-1)!.ops).toEqual([
      { op: 'update_element', element: 'photo', set: { x: 0, y: expect.any(Number) } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Order' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send to back' }));
    expect(batches.at(-1)!.ops).toEqual([{ op: 'reorder_element', element: 'photo', to: 'back' }]);
  });

  it('adds a slide with a layout and sets the background color', () => {
    const { batches } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New slide' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Section' }));
    expect(batches.at(-1)!.ops[0]).toMatchObject({ op: 'add_slide', slide: { layout: 'section' } });
    fireEvent.click(screen.getByRole('button', { name: /^Background/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Surface' }));
    expect(batches.at(-1)!.ops[0]).toMatchObject({ op: 'set_background', background: { color: 'surface' } });
  });
});
