// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  hasMark,
  readParagraphs,
  readSelection,
  setList,
  setRunColor,
  shiftLevel,
  toggleMark,
  toTextFields,
  writeSelection,
} from '../src/edit/rich-text.js';
import { denormalizeParagraph, type NormalizedParagraph, normalizeParagraphs } from '../src/index.js';

const text = (paragraphs: NormalizedParagraph[]) => paragraphs.map((p) => p.runs.map((r) => r.text).join(''));

describe('run marks', () => {
  const base = normalizeParagraphs(['Hello world', 'Second line']);
  const range = { start: { paragraph: 0, offset: 6 }, end: { paragraph: 1, offset: 6 } };

  it('toggles marks across paragraphs, splitting runs', () => {
    const bold = toggleMark(base, range, 'bold');
    expect(bold[0]!.runs).toEqual([{ text: 'Hello ' }, { text: 'world', bold: true }]);
    expect(bold[1]!.runs).toEqual([{ text: 'Second', bold: true }, { text: ' line' }]);
    expect(hasMark(bold, range, 'bold')).toBe(true);
    const plain = toggleMark(bold, range, 'bold');
    expect(plain[0]!.runs).toEqual([{ text: 'Hello world' }]);
    expect(text(plain)).toEqual(text(base));
  });

  it('sets and clears colors', () => {
    const colored = setRunColor(
      base,
      { start: { paragraph: 0, offset: 0 }, end: { paragraph: 0, offset: 5 } },
      'accent',
    );
    expect(colored[0]!.runs[0]).toEqual({ text: 'Hello', color: 'accent' });
    expect(
      setRunColor(
        colored,
        { start: { paragraph: 0, offset: 0 }, end: { paragraph: 0, offset: 11 } },
        undefined,
      )[0]!.runs,
    ).toEqual([{ text: 'Hello world' }]);
  });

  it('changes list kinds and levels', () => {
    const listed = setList(base, range, 'bullet');
    expect(listed.every((p) => p.list === 'bullet')).toBe(true);
    const deeper = shiftLevel(
      listed,
      { start: { paragraph: 1, offset: 0 }, end: { paragraph: 1, offset: 0 } },
      1,
    );
    expect(deeper[1]!.level).toBe(1);
    expect(shiftLevel(deeper, range, 9)[1]!.level).toBe(4);
    expect(toTextFields(deeper, true)).toEqual({
      bullets: ['Hello world', { text: 'Second line', level: 1 }],
    });
    expect(toTextFields(setList(deeper, range, 'number'), true)).toEqual({
      paragraphs: [
        { text: 'Hello world', list: 'number' },
        { text: 'Second line', list: 'number', level: 1 },
      ],
    });
  });

  it('denormalizes to the most compact form', () => {
    expect(denormalizeParagraph({ runs: [{ text: 'a' }, { text: 'b' }], level: 0 })).toBe('ab');
    expect(denormalizeParagraph({ runs: [{ text: 'a', bold: true }], level: 0 })).toEqual({
      runs: [{ text: 'a', bold: true }],
    });
  });
});

describe('DOM bridge', () => {
  it('reads paragraphs, lists and marks from the editable DOM', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div data-list="bullet" data-level="1"><span style="font-weight: 700">Bold</span> and <i>italic</i></div><div>Plain <span data-color="accent">color</span></div><div><br></div>';
    const paragraphs = readParagraphs(root);
    expect(paragraphs).toEqual([
      {
        runs: [{ text: 'Bold', bold: true }, { text: ' and ' }, { text: 'italic', italic: true }],
        level: 1,
        list: 'bullet',
      },
      { runs: [{ text: 'Plain ' }, { text: 'color', color: 'accent' }], level: 0 },
      { runs: [{ text: '' }], level: 0 },
    ]);
  });

  it('round-trips selections as paragraph offsets', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><span>Hello </span><span>world</span></div><div>Two</div>';
    document.body.append(root);
    writeSelection(root, { start: { paragraph: 0, offset: 7 }, end: { paragraph: 1, offset: 2 } });
    expect(readSelection(root)).toEqual({
      start: { paragraph: 0, offset: 7 },
      end: { paragraph: 1, offset: 2 },
    });
    root.remove();
  });
});
