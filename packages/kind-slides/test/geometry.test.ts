import { describe, expect, it } from 'vitest';
import {
  alignRects,
  clampPosition,
  distributeRects,
  moveRect,
  nudgeRect,
  resizeRect,
  snapMove,
  snapResize,
} from '../src/edit/geometry.js';
import {
  averageCharWidth,
  chartExtent,
  estimateTextFit,
  gridCells,
  niceScale,
  normalizeParagraphs,
  wrapLineCount,
} from '../src/index.js';

describe('snapping', () => {
  const others = [{ x: 2, y: 2, w: 3, h: 1 }];

  it('snaps edges and centers to other elements and reports guides', () => {
    const result = snapMove({ x: 2.05, y: 4, w: 2, h: 1 }, others);
    expect(result.rect.x).toBe(2);
    expect(result.guides).toContainEqual({ axis: 'x', position: 2, from: 2, to: 5 });
    const center = snapMove({ x: 2.53, y: 5, w: 2, h: 1 }, others);
    expect(center.rect.x).toBeCloseTo(2.5);
  });

  it('snaps to the slide center and edges', () => {
    const result = snapMove({ x: 5.7, y: 3.27, w: 2, h: 1 }, []);
    expect(result.rect.x + 1).toBeCloseTo(13.333 / 2, 3);
    expect(result.rect.y + 0.5).toBeCloseTo(3.75, 3);
    expect(snapMove({ x: 0.05, y: 1, w: 1, h: 1 }, []).rect.x).toBe(0);
  });

  it('falls back to the grid when no guide is near', () => {
    const result = snapMove({ x: 7.13, y: 5.9, w: 1, h: 0.7 }, [], { grid: 0.25, threshold: 0.01 });
    expect(result.rect).toMatchObject({ x: 7.25, y: 6 });
    expect(result.guides).toEqual([]);
  });

  it('snaps the moving edges of a resize', () => {
    const result = snapResize({ x: 0.5, y: 4, w: 4.45, h: 1 }, [1, 0], others);
    expect(result.rect.w).toBeCloseTo(4.5);
    expect(result.rect.x).toBe(0.5);
    const left = snapResize({ x: 1.95, y: 4, w: 3, h: 1 }, [-1, 0], others);
    expect(left.rect.x).toBe(2);
    expect(left.rect.w).toBeCloseTo(2.95);
  });
});

describe('resize and move', () => {
  const start = { x: 1, y: 1, w: 4, h: 2 };

  it('resizes from any handle with a minimum size', () => {
    expect(resizeRect(start, [1, 1], 1, 0.5)).toEqual({ x: 1, y: 1, w: 5, h: 2.5 });
    expect(resizeRect(start, [-1, -1], 1, 0.5)).toEqual({ x: 2, y: 1.5, w: 3, h: 1.5 });
    expect(resizeRect(start, [1, 0], -10, 0).w).toBe(0.1);
  });

  it('keeps the aspect ratio when asked', () => {
    const result = resizeRect(start, [1, 1], 2, 0);
    expect(result).toEqual({ x: 1, y: 1, w: 6, h: 2 });
    const ratio = resizeRect(start, [1, 1], 2, 0, { keepRatio: true });
    expect(ratio.w / ratio.h).toBeCloseTo(2);
    expect(ratio.w).toBeCloseTo(6);
  });

  it('keeps moved and resized rects on the canvas', () => {
    expect(moveRect(start, 20, -5)).toEqual({ x: 9.333, y: 0, w: 4, h: 2 });
    expect(resizeRect(start, [1, 0], 20, 0).w).toBeCloseTo(12.333);
    expect(clampPosition({ x: -1, y: 7, w: 2, h: 1 })).toEqual({ x: 0, y: 6.5, w: 2, h: 1 });
  });

  it('nudges and resizes with the keyboard', () => {
    expect(nudgeRect(start, 'ArrowRight', 0.05, false)).toMatchObject({ x: 1.05, y: 1 });
    expect(nudgeRect(start, 'ArrowUp', 0.5, false)).toMatchObject({ y: 0.5 });
    expect(nudgeRect(start, 'ArrowDown', 0.5, true)).toMatchObject({ w: 4, h: 2.5 });
  });
});

describe('align and distribute', () => {
  const rects = [
    { x: 1, y: 1, w: 1, h: 1 },
    { x: 3, y: 2, w: 2, h: 1 },
    { x: 8, y: 4, w: 1, h: 2 },
  ];

  it('aligns to the selection bounds', () => {
    expect(alignRects(rects, 'left').map((r) => r.x)).toEqual([1, 1, 1]);
    expect(alignRects(rects, 'right').map((r) => r.x + r.w)).toEqual([9, 9, 9]);
    expect(alignRects(rects, 'middle').map((r) => r.y + r.h / 2)).toEqual([3.5, 3.5, 3.5]);
    expect(alignRects(rects, 'bottom').map((r) => r.y + r.h)).toEqual([6, 6, 6]);
  });

  it('aligns a single rect to the slide', () => {
    expect(alignRects([rects[0]!], 'center')[0]!.x).toBeCloseTo((13.333 - 1) / 2, 3);
  });

  it('distributes with equal gaps', () => {
    const result = distributeRects(rects, 'horizontal');
    const gap1 = result[1]!.x - (result[0]!.x + result[0]!.w);
    const gap2 = result[2]!.x - (result[1]!.x + result[1]!.w);
    expect(gap1).toBeCloseTo(gap2);
    expect(result[0]!.x).toBe(1);
    expect(result[2]!.x).toBe(8);
    expect(distributeRects(rects.slice(0, 2), 'vertical')).toEqual(rects.slice(0, 2));
  });
});

describe('text metrics', () => {
  it('wraps at word boundaries and splits long words', () => {
    expect(wrapLineCount('one two three', 7)).toBe(2);
    expect(wrapLineCount('abcdefghij', 4)).toBe(3);
    expect(wrapLineCount('a\nb\n', 10)).toBe(3);
  });

  it('uses font-family widths and detects overflow', () => {
    expect(averageCharWidth('Consolas')).toBeGreaterThan(averageCharWidth('Calibri'));
    expect(averageCharWidth('Calibri', true)).toBeGreaterThan(averageCharWidth('Calibri'));
    const short = estimateTextFit({
      paragraphs: normalizeParagraphs(['Hello']),
      fontSize: 18,
      fontFamily: 'Calibri',
      width: 4,
      height: 0.5,
    });
    expect(short.fits).toBe(true);
    expect(short.lines).toBe(1);
    const long = estimateTextFit({
      paragraphs: normalizeParagraphs(['word '.repeat(80)]),
      fontSize: 18,
      fontFamily: 'Calibri',
      width: 4,
      height: 0.5,
    });
    expect(long.fits).toBe(false);
    expect(long.ratio).toBeGreaterThan(2);
    const bullets = estimateTextFit({
      paragraphs: normalizeParagraphs(['x'.repeat(30)], 'bullet'),
      fontSize: 18,
      fontFamily: 'Calibri',
      width: 3,
      height: 2,
    });
    const plain = estimateTextFit({
      paragraphs: normalizeParagraphs(['x'.repeat(30)]),
      fontSize: 18,
      fontFamily: 'Calibri',
      width: 3,
      height: 2,
    });
    expect(bullets.lines).toBeGreaterThanOrEqual(plain.lines);
  });

  it('lays out grids and chart scales', () => {
    const cells = gridCells({ x: 0, y: 0, w: 10, h: 4 }, 5, 3, 0.5);
    expect(cells).toHaveLength(5);
    expect(cells[3]).toMatchObject({ x: 0, y: 2.25 });
    expect(niceScale(0, 510).ticks).toEqual([0, 200, 400, 600]);
    expect(niceScale(0, 9).ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceScale(-3, 7).min).toBeLessThanOrEqual(-3);
    expect(
      chartExtent({
        chartType: 'stackedBar',
        categories: ['a', 'b'],
        series: [
          { name: 's', values: [1, 2] },
          { name: 't', values: [3, -1] },
        ],
      }),
    ).toEqual({ min: -1, max: 4 });
  });
});
