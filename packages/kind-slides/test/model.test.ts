import {
  ArtifactError,
  applyOperations,
  createArtifactService,
  createMemoryStore,
  createRegistry,
  defaultTheme,
  prepareContent,
} from '@artkit/core';
import { defineKindConformanceTests } from '@artkit/core/testing';
import { describe, expect, it } from 'vitest';
import {
  createSlidesKind,
  outlineToSlides,
  parsePartialSlides,
  type SlidesContent,
  type SlidesOperation,
  slidesKind,
  slidesOperationTargets,
} from '../src/index.js';
import { fullDeck } from './fixtures.js';

const registry = createRegistry({ kinds: [slidesKind] });

function prepare(content: unknown): SlidesContent {
  return prepareContent(registry, 'slides', content).content as SlidesContent;
}

function apply(content: SlidesContent, operations: unknown[], locale = 'en') {
  return applyOperations(
    registry,
    { kind: 'slides', content, title: 'Deck', themeId: 'default', locale },
    operations,
  );
}

function rejection(content: SlidesContent, operations: unknown[]): ArtifactError {
  try {
    apply(content, operations);
  } catch (error) {
    if (error instanceof ArtifactError) return error;
    throw error;
  }
  throw new Error('expected the batch to be rejected');
}

const base = (): SlidesContent => prepare(structuredClone(fullDeck));

defineKindConformanceTests(
  slidesKind,
  [
    {
      title: 'full deck',
      content: fullDeck,
      batches: [
        [
          { op: 'set_slot', slide: 'cover', slot: 'subtitle', content: 'Updated' },
          { op: 'move_slide', slide: 'custom', position: 1 },
        ],
        [{ op: 'duplicate_slide', slide: 'custom' }],
        [{ op: 'set_layout', slide: 'problem', layout: 'two-columns' }],
      ],
      rejects: [
        { operations: [{ op: 'remove_slide', slide: 'nope' }], code: 'OPERATION_FAILED' },
        {
          operations: [{ op: 'update_element', element: 'headline', set: { w: 20 } }],
          code: 'OPERATION_FAILED',
        },
        { operations: [{ op: 'explode' }], code: 'INVALID_OPERATION' },
      ],
    },
    { title: 'empty deck', content: { slides: [] } },
  ],
  { describe, it },
);

describe('content validation', () => {
  it('fills missing ids deterministically', () => {
    const content = prepare({
      slides: [
        { layout: 'title', slots: { title: 'A' } },
        {
          layout: 'blank',
          elements: [
            { type: 'text', x: 1, y: 1, w: 2, h: 1, paragraphs: ['x'] },
            {
              type: 'chart',
              x: 4,
              y: 1,
              w: 4,
              h: 3,
              chartType: 'bar',
              categories: ['a'],
              series: [{ name: 's', values: [1] }],
            },
          ],
        },
      ],
    });
    expect(content.slides.map((slide) => slide.id)).toEqual(['s1', 's2']);
    expect(content.slides[1]!.elements.map((element) => element.id)).toEqual(['txt1', 'cht1']);
  });

  it('rejects elements outside the canvas with a path', () => {
    const error = (() => {
      try {
        prepare({
          slides: [
            {
              id: 'a',
              layout: 'blank',
              elements: [{ id: 'e', type: 'text', x: 12, y: 1, w: 3, h: 1, paragraphs: ['x'] }],
            },
          ],
        });
      } catch (caught) {
        return caught as ArtifactError;
      }
    })();
    expect(error?.code).toBe('INVALID_CONTENT');
    expect(error?.issues[0]?.path).toBe('content.slides[0].elements[0].w');
    expect(error?.issues[0]?.hint).toContain('13.333');
  });

  it('rejects unknown layouts, unknown slots and wrong slot kinds', () => {
    const run = (slide: unknown) => {
      try {
        prepare({ slides: [slide] });
      } catch (caught) {
        return (caught as ArtifactError).issues[0]?.path;
      }
    };
    expect(run({ id: 'a', layout: 'nope' })).toBe('content.slides[0].layout');
    expect(run({ id: 'a', layout: 'title', slots: { body: 'x' } })).toBe('content.slides[0].slots.body');
    expect(
      run({
        id: 'a',
        layout: 'title',
        slots: {
          title: { type: 'chart', chartType: 'bar', categories: ['a'], series: [{ name: 'x', values: [1] }] },
        },
      }),
    ).toBe('content.slides[0].slots.title');
  });

  it('rejects inconsistent tables and charts', () => {
    const run = (slots: unknown) => {
      try {
        prepare({ slides: [{ id: 'a', layout: 'title-content', slots }] });
      } catch (caught) {
        return (caught as ArtifactError).issues[0];
      }
    };
    expect(run({ body: { type: 'table', header: ['a', 'b'], rows: [['1']] } })?.path).toBe(
      'content.slides[0].slots.body.rows[0]',
    );
    expect(
      run({
        body: {
          type: 'chart',
          chartType: 'line',
          categories: ['a', 'b'],
          series: [{ name: 's', values: [1] }],
        },
      })?.path,
    ).toBe('content.slides[0].slots.body.series[0].values');
    expect(
      run({
        body: {
          type: 'chart',
          chartType: 'pie',
          categories: ['a'],
          series: [
            { name: 's', values: [1] },
            { name: 't', values: [2] },
          ],
        },
      })?.message,
    ).toContain('pie');
  });

  it('enforces unique ids across the deck and the slide limits', () => {
    expect(() =>
      prepare({
        slides: [
          {
            id: 'a',
            layout: 'blank',
            elements: [{ id: 'a', type: 'text', x: 1, y: 1, w: 1, h: 1, paragraphs: ['x'] }],
          },
        ],
      }),
    ).toThrow(ArtifactError);
    const many = { slides: Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, layout: 'blank' })) };
    try {
      prepare(many);
    } catch (error) {
      expect((error as ArtifactError).code).toBe('LIMIT_EXCEEDED');
    }
    const crowded = {
      slides: [
        {
          id: 'a',
          layout: 'blank',
          elements: Array.from({ length: 61 }, (_, i) => ({
            id: `e${i}`,
            type: 'shape',
            shape: 'rect',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
          })),
        },
      ],
    };
    expect(() => prepare(crowded)).toThrow(/elementsPerSlide/);
  });

  it('requires exactly one of paragraphs or bullets in text elements', () => {
    expect(() =>
      prepare({
        slides: [{ id: 'a', layout: 'blank', elements: [{ id: 'e', type: 'text', x: 1, y: 1, w: 1, h: 1 }] }],
      }),
    ).toThrow(ArtifactError);
  });
});

describe('slide operations', () => {
  it('add_slide inserts after an id, at a position or at the end, generating ids', () => {
    const result = apply(base(), [
      { op: 'add_slide', after: 'cover', slide: { layout: 'section', slots: { title: 'Part 1' } } },
      {
        op: 'add_slide',
        position: 1,
        slide: {
          id: 'first',
          layout: 'blank',
          elements: [{ type: 'text', x: 1, y: 1, w: 3, h: 1, paragraphs: ['Hi'] }],
        },
      },
      {
        op: 'add_slide',
        slide: { id: 'last', layout: 'quote', slots: { quote: { type: 'quote', text: 'Ship it' } } },
      },
    ]);
    const ids = (result.content as SlidesContent).slides.map((slide) => slide.id);
    expect(ids[0]).toBe('first');
    expect(ids[2]).toBe('s1');
    expect(ids.at(-1)).toBe('last');
    expect(result.createdIds).toEqual(expect.arrayContaining(['first', 's1', 'last', 'txt1']));
  });

  it('add_slide rejects duplicate ids, bad layouts, bad slots and bad positions', () => {
    expect(
      rejection(base(), [{ op: 'add_slide', slide: { id: 'cover', layout: 'title' } }]).issues[0]?.path,
    ).toBe('operations[0].slide.id');
    expect(rejection(base(), [{ op: 'add_slide', slide: { layout: 'nope' } }]).issues[0]?.path).toBe(
      'operations[0].slide.layout',
    );
    expect(
      rejection(base(), [{ op: 'add_slide', slide: { layout: 'title', slots: { body: 'x' } } }]).issues[0]
        ?.path,
    ).toBe('operations[0].slide.slots.body');
    expect(
      rejection(base(), [{ op: 'add_slide', position: 99, slide: { layout: 'title' } }]).issues[0]?.path,
    ).toBe('operations[0].position');
    const outside = rejection(base(), [
      {
        op: 'add_slide',
        slide: { layout: 'blank', elements: [{ type: 'text', x: 1, y: 7, w: 1, h: 1, paragraphs: ['x'] }] },
      },
    ]);
    expect(outside.code).toBe('OPERATION_FAILED');
    expect(outside.issues[0]?.path).toBe('operations[0].slide.elements[0].h');
  });

  it('remove_slide and move_slide', () => {
    const removed = apply(base(), [{ op: 'remove_slide', slide: 'kpis' }]).content as SlidesContent;
    expect(removed.slides.some((slide) => slide.id === 'kpis')).toBe(false);
    const moved = apply(base(), [{ op: 'move_slide', slide: 'cover', after: 'plan' }]);
    expect((moved.content as SlidesContent).slides.map((s) => s.id).slice(0, 4)).toEqual([
      'problem',
      'kpis',
      'plan',
      'cover',
    ]);
    expect(moved.diff.some((change) => change.type === 'moved' && change.target === 'slide:cover')).toBe(
      true,
    );
    expect(rejection(base(), [{ op: 'move_slide', slide: 'cover', after: 'cover' }]).issues[0]?.path).toBe(
      'operations[0].after',
    );
    expect(rejection(base(), [{ op: 'move_slide', slide: 'cover' }]).code).toBe('INVALID_OPERATION');
  });

  it('duplicate_slide copies with new deterministic ids', () => {
    const result = apply(base(), [{ op: 'duplicate_slide', slide: 'custom' }]);
    const content = result.content as SlidesContent;
    const index = content.slides.findIndex((slide) => slide.id === 'custom');
    const copy = content.slides[index + 1]!;
    expect(copy.id).toBe('custom-copy1');
    expect(copy.elements.map((element) => element.id)).toEqual([
      'headline-copy1',
      'panel-copy1',
      'arrow1-copy1',
      'photo-copy1',
      'chart1-copy1',
    ]);
    const again = apply(content, [{ op: 'duplicate_slide', slide: 'custom', id: 'mine', after: 'cover' }])
      .content as SlidesContent;
    expect(again.slides[1]!.id).toBe('mine');
    expect(again.slides[1]!.elements[0]!.id).toBe('headline-copy2');
  });

  it('set_layout migrates equivalent slots and keeps orphans as elements', () => {
    const toTwo = apply(base(), [{ op: 'set_layout', slide: 'problem', layout: 'two-columns' }])
      .content as SlidesContent;
    const problem = toTwo.slides.find((slide) => slide.id === 'problem')!;
    expect(Object.keys(problem.slots).sort()).toEqual(['left', 'title']);
    const toTitle = apply(base(), [{ op: 'set_layout', slide: 'kpis', layout: 'title' }])
      .content as SlidesContent;
    const kpis = toTitle.slides.find((slide) => slide.id === 'kpis')!;
    expect(kpis.slots.title).toBe('The pilot cut onboarding by 40%');
    expect(kpis.slots.subtitle).toBe('Pilot with 25 suppliers');
    expect(kpis.elements.length).toBeGreaterThan(0);
    expect(kpis.elements.every((element) => /^(txt|shp)\d+$/.test(element.id))).toBe(true);
    const dropped = apply(base(), [{ op: 'set_layout', slide: 'kpis', layout: 'title', orphans: 'drop' }])
      .content as SlidesContent;
    expect(dropped.slides.find((slide) => slide.id === 'kpis')!.elements).toEqual([]);
    expect(rejection(base(), [{ op: 'set_layout', slide: 'kpis', layout: 'nope' }]).issues[0]?.path).toBe(
      'operations[0].layout',
    );
  });

  it('set_slot sets, replaces and clears content, with precise rejections', () => {
    const content = apply(base(), [
      { op: 'set_slot', slide: 'problem', slot: 'body', content: { type: 'text', paragraphs: ['New body'] } },
      { op: 'set_slot', slide: 'cover', slot: 'subtitle', content: null },
    ]).content as SlidesContent;
    expect(content.slides[1]!.slots.body).toEqual({ type: 'text', paragraphs: ['New body'] });
    expect(content.slides[0]!.slots.subtitle).toBeUndefined();
    expect(
      rejection(base(), [{ op: 'set_slot', slide: 'cover', slot: 'body', content: 'x' }]).issues[0]?.path,
    ).toBe('operations[0].slot');
    expect(
      rejection(base(), [
        { op: 'set_slot', slide: 'cover', slot: 'title', content: { type: 'bullets', items: ['x'] } },
      ]).issues[0]?.path,
    ).toBe('operations[0].content');
    const table = rejection(base(), [
      {
        op: 'set_slot',
        slide: 'problem',
        slot: 'body',
        content: { type: 'table', header: ['a'], rows: [['1', '2']] },
      },
    ]);
    expect(table.issues[0]?.path).toBe('operations[0].content.rows[0]');
  });

  it('set_notes, set_background, set_hidden', () => {
    const content = apply(base(), [
      { op: 'set_notes', slide: 'cover', notes: '' },
      { op: 'set_notes', slide: 'problem', notes: 'Talk slowly' },
      { op: 'set_background', slide: 'problem', background: { color: '#112233' } },
      { op: 'set_background', slide: 'custom', background: null },
      { op: 'set_hidden', slide: 'custom', hidden: false },
      { op: 'set_hidden', slide: 'cover', hidden: true },
    ]).content as SlidesContent;
    expect(content.slides[0]!.notes).toBeUndefined();
    expect(content.slides[0]!.hidden).toBe(true);
    expect(content.slides[1]!.notes).toBe('Talk slowly');
    expect(content.slides[1]!.background).toEqual({ color: '#112233' });
    const custom = content.slides.find((slide) => slide.id === 'custom')!;
    expect(custom.background).toBeUndefined();
    expect(custom.hidden).toBeUndefined();
  });

  it('set_footer sets and removes the footer', () => {
    const removed = apply(base(), [{ op: 'set_footer', footer: null }]);
    expect((removed.content as SlidesContent).footer).toBeUndefined();
    expect(removed.diff.some((change) => change.target === 'deck')).toBe(true);
  });
});

describe('element operations', () => {
  it('add_element at the front or back with generated ids', () => {
    const content = apply(base(), [
      {
        op: 'add_element',
        slide: 'cover',
        element: { type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, fill: 'accent' },
        position: 'back',
      },
      {
        op: 'add_element',
        slide: 'cover',
        element: { type: 'image', x: 10, y: 5, w: 2, h: 2, asset: 'asset://logo', alt: 'Logo' },
      },
    ]).content as SlidesContent;
    expect(content.slides[0]!.elements.map((element) => element.id)).toEqual(['shp1', 'img1']);
    expect(
      rejection(base(), [
        {
          op: 'add_element',
          slide: 'cover',
          element: { id: 'panel', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1 },
        },
      ]).issues[0]?.path,
    ).toBe('operations[0].element.id');
  });

  it('update_element merges fields, removes nulls and switches paragraphs/bullets', () => {
    const content = apply(base(), [
      {
        op: 'update_element',
        element: 'headline',
        set: { x: 1, bullets: ['a', 'b'], bold: null, color: 'accent' },
      },
    ]).content as SlidesContent;
    const headline = content.slides.find((slide) => slide.id === 'custom')!.elements[0]!;
    expect(headline).toMatchObject({
      id: 'headline',
      type: 'text',
      x: 1,
      bullets: ['a', 'b'],
      color: 'accent',
    });
    expect(headline).not.toHaveProperty('bold');
    expect(headline).not.toHaveProperty('paragraphs');
  });

  it('update_element rejects id/type changes, foreign fields and invalid results', () => {
    expect(rejection(base(), [{ op: 'update_element', element: 'headline', set: { id: 'x' } }]).code).toBe(
      'INVALID_OPERATION',
    );
    const foreign = rejection(base(), [
      { op: 'update_element', element: 'headline', set: { chartType: 'bar' } },
    ]);
    expect(foreign.code).toBe('OPERATION_FAILED');
    expect(foreign.issues[0]?.path).toBe('operations[0].set.chartType');
    const missing = rejection(base(), [{ op: 'update_element', element: 'ghost', set: { x: 1 } }]);
    expect(missing.issues[0]?.path).toBe('operations[0].element');
    const chart = rejection(base(), [
      { op: 'update_element', element: 'chart1', set: { categories: ['a', 'b', 'c'] } },
    ]);
    expect(chart.issues[0]?.path).toBe('operations[0].set.series[0].values');
  });

  it('remove_element and reorder_element', () => {
    const removed = apply(base(), [{ op: 'remove_element', element: 'photo' }]).content as SlidesContent;
    expect(removed.slides.find((slide) => slide.id === 'custom')!.elements.map((e) => e.id)).not.toContain(
      'photo',
    );
    const order = (ops: unknown[]) =>
      (apply(base(), ops).content as SlidesContent).slides
        .find((slide) => slide.id === 'custom')!
        .elements.map((element) => element.id);
    expect(order([{ op: 'reorder_element', element: 'headline', to: 'front' }]).at(-1)).toBe('headline');
    expect(order([{ op: 'reorder_element', element: 'chart1', to: 'back' }])[0]).toBe('chart1');
    expect(order([{ op: 'reorder_element', element: 'headline', to: 'forward' }]).slice(0, 2)).toEqual([
      'panel',
      'headline',
    ]);
    expect(order([{ op: 'reorder_element', element: 'panel', to: 'backward' }]).slice(0, 2)).toEqual([
      'panel',
      'headline',
    ]);
  });

  it('localizes failures in Portuguese', () => {
    try {
      apply(base(), [{ op: 'remove_slide', slide: 'nope' }], 'pt-BR');
    } catch (error) {
      expect((error as ArtifactError).issues[0]?.message).toContain('não existe');
    }
  });
});

describe('targets, diff and rebase', () => {
  it('targets use the diff vocabulary', () => {
    const ops: SlidesOperation[] = [
      { op: 'set_slot', slide: 'a', slot: 'title', content: 'x' },
      { op: 'update_element', element: 'e1', set: { x: 1 } },
      { op: 'set_footer', footer: null },
      { op: 'set_notes', slide: 'a', notes: 'n' },
    ];
    expect(ops.flatMap(slidesOperationTargets)).toEqual(['slot:a.title', 'element:e1', 'deck', 'slide:a']);
  });

  it('diff reports slot, element and slide changes', () => {
    const result = apply(base(), [
      { op: 'set_slot', slide: 'cover', slot: 'title', content: 'New title' },
      { op: 'update_element', element: 'panel', set: { x: 1 } },
      { op: 'update_element', element: 'headline', set: { color: 'accent' } },
      { op: 'set_layout', slide: 'problem', layout: 'two-columns' },
      {
        op: 'add_element',
        slide: 'cover',
        element: { id: 'logo', type: 'image', x: 10, y: 5, w: 2, h: 2, asset: 'asset://logo', alt: 'Logo' },
      },
    ]);
    const targets = result.diff.map((change) => `${change.type} ${change.target}`);
    expect(targets).toEqual(
      expect.arrayContaining([
        'changed slot:cover.title',
        'changed element:panel',
        'changed element:headline',
        'changed slide:problem',
        'added element:logo',
        'removed slot:problem.body',
        'added slot:problem.left',
      ]),
    );
    expect(result.diff.find((change) => change.target === 'element:panel')?.summary).toContain(
      'Moved/resized',
    );
  });

  it('rebases edits on different slots and conflicts on the same one', async () => {
    const store = createMemoryStore();
    const service = createArtifactService({ registry, store });
    const scope = { workspaceId: 'ws', actor: { type: 'user' as const, id: 'u1' } };
    const created = await service.create(scope, { kind: 'slides', title: 'Deck', content: fullDeck });
    const id = created.artifact.id;
    await service.apply(scope, {
      artifactId: id,
      baseVersion: 1,
      operations: [{ op: 'set_slot', slide: 'cover', slot: 'title', content: 'A' }],
    });
    const rebased = await service.apply(scope, {
      artifactId: id,
      baseVersion: 1,
      operations: [{ op: 'set_notes', slide: 'problem', notes: 'B' }],
    });
    expect(rebased.rebased).toBe(true);
    await expect(
      service.apply(scope, {
        artifactId: id,
        baseVersion: 1,
        operations: [{ op: 'set_slot', slide: 'cover', slot: 'title', content: 'C' }],
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('projection', () => {
  it('follows the spec format with ids, boxes and notes', () => {
    const content = base();
    const text = slidesKind.project(content, { mode: 'full', locale: 'en' }).text;
    expect(text).toContain(
      'Deck 16:9 (13.333x7.5 in), 7 slides, footer: "Acme · Confidential" + slide numbers',
    );
    expect(text).toContain('Slide 2 (id: problem, layout: title-content)');
    expect(text).toContain('  [title] text "Manual onboarding takes 12 days" (0.6,0.4 12.13x0.9)');
    expect(text).toContain('    - Data typed **twice**');
    expect(text).toContain('      - Late reports');
    expect(text).toContain('  notes: "Open with the discovery meeting context."');
    expect(text).toContain('  #headline text "Three markets" (0.6,0.4 12.1x1) 32pt bold');
    expect(text).toContain('Slide 7 (id: custom, layout: blank, hidden)');
    expect(text).toContain('    | Phase | Weeks | (header)');
    expect(text).toContain('    series "Suppliers": 120, 250, 510');
    const pt = slidesKind.project(content, { mode: 'full', locale: 'pt-BR' }).text;
    expect(pt).toContain('  notas: "Open with the discovery meeting context."');
  });

  it('outline has one line per slide and range selects by index or id', () => {
    const content = base();
    const outline = slidesKind.project(content, { mode: 'outline', locale: 'en' }).text.split('\n');
    expect(outline).toHaveLength(8);
    expect(outline[1]).toBe('Slide 1 (id: cover, layout: title): Supplier portal');
    const range = slidesKind.project(content, { mode: 'range', range: '2-3', locale: 'en' }).text;
    expect(range).toContain('id: problem');
    expect(range).toContain('id: kpis');
    expect(range).not.toContain('id: cover');
    const byId = slidesKind.project(content, { mode: 'range', range: 'plan', locale: 'en' }).text;
    expect(byId).toContain('id: plan');
    expect(byId).not.toContain('id: kpis');
  });

  it('paginates on slide boundaries', () => {
    const projection = slidesKind.project(base(), { mode: 'full', locale: 'en', maxTokens: 120 });
    expect(projection.truncated).toBe(true);
    expect(projection.cursor).toMatch(/^c\d+$/);
    expect(projection.remainingOutline).toContain('Slide 7');
  });
});

describe('lint', () => {
  const lint = (content: SlidesContent) => slidesKind.lint(content, { locale: 'en', theme: defaultTheme });

  it('the fixture deck is clean apart from intentional choices', () => {
    const codes = lint(base()).map((issue) => `${issue.code} ${issue.target}`);
    expect(codes.filter((code) => !code.startsWith('missing-title slide:custom'))).toEqual([]);
  });

  it('warns about overflow, bullets, contrast, overlap, titles, alt and empty slots', () => {
    const content = prepare({
      slides: [
        {
          id: 'a',
          layout: 'title-content',
          slots: {
            body: {
              type: 'bullets',
              items: Array.from({ length: 8 }, (_, i) => `Bullet number ${i} with some words`),
            },
          },
          elements: [
            {
              id: 'long',
              type: 'text',
              x: 1,
              y: 2,
              w: 2,
              h: 0.5,
              paragraphs: ['This sentence is far too long for such a small box and will overflow it'],
            },
            {
              id: 'pale',
              type: 'text',
              x: 8,
              y: 6.9,
              w: 3,
              h: 0.5,
              paragraphs: ['Pale'],
              color: '#EEEEEE',
              fontSize: 12,
            },
            { id: 'img', type: 'image', x: 5, y: 2, w: 2, h: 2, asset: 'asset://a', alt: '' },
          ],
        },
        { id: 'b', layout: 'two-columns', slots: { title: 'Only title' } },
        {
          id: 'c',
          layout: 'title-content',
          slots: {
            title: 'Table',
            body: { type: 'table', header: ['a'], rows: Array.from({ length: 30 }, () => ['row']) },
          },
        },
      ],
    });
    const issues = lint(content).map((issue) => `${issue.code} ${issue.target}`);
    expect(issues).toEqual(
      expect.arrayContaining([
        'missing-title slide:a',
        'too-many-bullets slot:a.body',
        'text-overflow element:long',
        'low-contrast element:pale',
        'overlap element:long',
        'overlap element:img',
        'missing-alt element:img',
        'empty-slot slot:b.left',
        'empty-slot slot:b.right',
        'table-overflow slot:c.body',
      ]),
    );
  });

  it('uses the shape fill as the background for text on cards', () => {
    const content = prepare({
      slides: [
        {
          id: 'a',
          layout: 'blank',
          elements: [
            { id: 'title', type: 'text', x: 0.5, y: 0.3, w: 8, h: 1, paragraphs: ['Title'], fontSize: 30 },
            { id: 'card', type: 'shape', shape: 'rect', x: 1, y: 2, w: 4, h: 3, fill: '#1D2F3C' },
            {
              id: 'on-card',
              type: 'text',
              x: 1.2,
              y: 2.2,
              w: 3.6,
              h: 1,
              paragraphs: ['Dark text on dark card'],
              color: 'text',
            },
          ],
        },
      ],
    });
    expect(lint(content).map((issue) => `${issue.code} ${issue.target}`)).toEqual([
      'low-contrast element:on-card',
    ]);
  });

  it('localizes lint messages', () => {
    const content = prepare({ slides: [{ id: 'a', layout: 'two-columns', slots: { title: 'T' } }] });
    expect(slidesKind.lint(content, { locale: 'pt-BR', theme: defaultTheme })[0]?.message).toContain('vazio');
  });
});

describe('parsePartial and inputs', () => {
  it('salvages streamed content, dropping invalid trailing pieces', () => {
    const partial = slidesKind.parsePartial({
      slides: [
        { layout: 'title', slots: { title: 'Hello', subtitle: { type: 'bul' } } },
        {
          id: 'two',
          layout: 'blank',
          elements: [
            { type: 'text', x: 1, y: 1, w: 2, h: 1, paragraphs: ['ok'] },
            { type: 'chart', x: 1 },
          ],
        },
        { layout: 'ti' },
      ],
    });
    expect(partial?.slides.map((slide) => slide.id)).toEqual(['s1', 'two']);
    expect(partial!.slides[0]!.slots).toEqual({ title: 'Hello' });
    expect(partial!.slides[1]!.elements).toHaveLength(1);
    expect(parsePartialSlides('nope')).toBeUndefined();
    expect(parsePartialSlides({})).toEqual({ size: '16:9', slides: [] });
  });

  it('converts an outline into slides', () => {
    const content = outlineToSlides(
      '# Supplier portal\nProposal 2026\n\n# The problem\n- Slow\n  - Manual\n> Mention audit\n\n## Plan\n\n# Steps\n1. One\n2. Two',
    );
    expect(content.slides.map((slide) => slide.layout)).toEqual([
      'title',
      'title-content',
      'section',
      'title-content',
    ]);
    expect(content.slides[1]!.slots.body).toEqual({
      type: 'bullets',
      items: ['Slow', { text: 'Manual', level: 1 }],
    });
    expect(content.slides[1]!.notes).toBe('Mention audit');
    expect(content.slides[3]!.slots.body).toEqual({
      type: 'text',
      paragraphs: [
        { text: 'One', list: 'number' },
        { text: 'Two', list: 'number' },
      ],
    });
    expect(() => prepare(content)).not.toThrow();
    expect(() => outlineToSlides('no headings')).toThrow(ArtifactError);
  });
});

describe('createSlidesKind', () => {
  it('registers application layouts and validates their definitions', () => {
    const kind = createSlidesKind({
      layouts: [
        {
          name: 'agenda',
          label: 'Agenda',
          description: 'Agenda items',
          slots: [
            { name: 'title', accepts: ['text'], box: { x: 0.6, y: 0.4, w: 12, h: 0.9 }, role: 'title' },
            {
              name: 'items',
              accepts: ['steps'],
              box: { x: 0.6, y: 1.5, w: 12, h: 5 },
              role: 'body',
              columns: 1,
            },
          ],
        },
      ],
    });
    expect(kind.layouts.names()).toContain('agenda');
    expect(kind.instructions.rules[0]).toContain('agenda (title:text, items:steps)');
    expect(() =>
      createSlidesKind({ layouts: [{ name: 'Bad Name', label: '', description: '', slots: [] }] }),
    ).toThrow(/Invalid slide layout/);
    expect(() =>
      createSlidesKind({
        layouts: [
          {
            name: 'big',
            label: '',
            description: '',
            slots: [{ name: 'x', accepts: ['text'], box: { x: 0, y: 0, w: 20, h: 1 }, role: 'body' }],
          },
        ],
      }),
    ).toThrow(/fit/);
  });
});
