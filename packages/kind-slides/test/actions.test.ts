import { describe, expect, it } from 'vitest';
import {
  alignOps,
  cloneElementsOps,
  distributeOps,
  parseClipboard,
  reorderOps,
  serializeElements,
} from '../src/edit/actions.js';
import type { Slide, SlidesContent } from '../src/schema.js';

const box = (id: string, x: number, y = 1) =>
  ({ id, type: 'shape', shape: 'rect', x, y, w: 1, h: 1 }) as Slide['elements'][number];
const slide: Slide = {
  id: 's1',
  layout: 'blank',
  slots: {},
  elements: [box('a', 1), box('b', 4), box('c', 10)],
} as unknown as Slide;
const content = { slides: [slide] } as unknown as SlidesContent;

describe('slide element actions', () => {
  it('clones with deterministic ids that never collide', () => {
    const result = cloneElementsOps(content, 's1', [slide.elements[0]!, slide.elements[1]!]);
    expect(result.select).toEqual(['shp1', 'shp2']);
    expect(result.operations[0]).toMatchObject({
      op: 'add_element',
      element: { id: 'shp1', x: 1.2, y: 1.2 },
    });
  });

  it('round-trips the clipboard payload and rejects foreign text', () => {
    const text = serializeElements(slide, ['b']);
    expect(parseClipboard(text)).toEqual([slide.elements[1]]);
    expect(parseClipboard('hello')).toBeUndefined();
    expect(parseClipboard('artkit-slides-elements:{bad')).toBeUndefined();
  });

  it('aligns one element to the slide and several to their bounds', () => {
    expect(alignOps(slide, ['b'], 'right')).toEqual([
      { op: 'update_element', element: 'b', set: { x: 12.333, y: 1 } },
    ]);
    expect(alignOps(slide, ['a', 'b'], 'left')).toEqual([
      { op: 'update_element', element: 'b', set: { x: 1, y: 1 } },
    ]);
  });

  it('distributes three or more elements with equal gaps', () => {
    expect(distributeOps(slide, ['a', 'b'], 'horizontal')).toEqual([]);
    expect(distributeOps(slide, ['a', 'b', 'c'], 'horizontal')).toEqual([
      { op: 'update_element', element: 'b', set: { x: 5.5, y: 1 } },
    ]);
  });

  it('reorders several elements keeping their relative order', () => {
    expect(reorderOps(slide, ['c', 'a'], 'front').map((op) => (op as { element: string }).element)).toEqual([
      'a',
      'c',
    ]);
    expect(reorderOps(slide, ['a', 'c'], 'back').map((op) => (op as { element: string }).element)).toEqual([
      'c',
      'a',
    ]);
  });
});
