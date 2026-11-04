import { defaultTheme } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  darkTheme,
  diffLines,
  mixColors,
  parsePartialJson,
  themeStyles,
  toSplitRows,
} from '../src/index.js';

describe('diffLines', () => {
  it('finds insertions, deletions and unchanged lines with line numbers', () => {
    const diff = diffLines('a\nb\nc\nd', 'a\nc\nx\nd');
    expect(diff).toEqual([
      { type: 'equal', text: 'a', oldLine: 1, newLine: 1 },
      { type: 'delete', text: 'b', oldLine: 2 },
      { type: 'equal', text: 'c', oldLine: 3, newLine: 2 },
      { type: 'insert', text: 'x', newLine: 3 },
      { type: 'equal', text: 'd', oldLine: 4, newLine: 4 },
    ]);
  });

  it('handles empty sides and CRLF', () => {
    expect(diffLines('', 'a\r\nb')).toEqual([
      { type: 'insert', text: 'a', newLine: 1 },
      { type: 'insert', text: 'b', newLine: 2 },
    ]);
    expect(diffLines('a', '')).toEqual([{ type: 'delete', text: 'a', oldLine: 1 }]);
    expect(diffLines('same', 'same')).toEqual([{ type: 'equal', text: 'same', oldLine: 1, newLine: 1 }]);
  });

  it('keeps the longest common subsequence', () => {
    const before = ['x', 'a', 'b', 'c', 'y'].join('\n');
    const after = ['a', 'q', 'b', 'c', 'z'].join('\n');
    const equal = diffLines(before, after)
      .filter((entry) => entry.type === 'equal')
      .map((entry) => entry.text);
    expect(equal).toEqual(['a', 'b', 'c']);
  });

  it('falls back to a block replacement above maxCells, keeping prefix and suffix', () => {
    const diff = diffLines('head\n1\n2\ntail', 'head\n3\n4\ntail', { maxCells: 1 });
    expect(diff.map((entry) => `${entry.type}:${entry.text}`)).toEqual([
      'equal:head',
      'delete:1',
      'delete:2',
      'insert:3',
      'insert:4',
      'equal:tail',
    ]);
  });

  it('pairs deletions and insertions for the split layout', () => {
    const rows = toSplitRows(diffLines('a\nb\nc', 'a\nB\nC\nD'));
    expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', 'C'],
      [undefined, 'D'],
    ]);
  });
});

describe('parsePartialJson', () => {
  it('parses complete JSON directly', () => {
    expect(parsePartialJson('{"a":[1,2]}')).toEqual({ a: [1, 2] });
  });

  it('keeps complete values and the partial text of a string value', () => {
    expect(parsePartialJson('{"items":[{"id":"a","text":"one"},{"id":"b","text":"tw')).toEqual({
      items: [
        { id: 'a', text: 'one' },
        { id: 'b', text: 'tw' },
      ],
    });
  });

  it('drops unfinished keys, numbers and literals', () => {
    expect(parsePartialJson('{"a":1,"b')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":12')).toEqual({});
    expect(parsePartialJson('{"a":1.')).toEqual({});
    expect(parsePartialJson('{"a":tr')).toEqual({});
    expect(parsePartialJson('[true,fal')).toEqual([true]);
    expect(parsePartialJson('[1, 2, ')).toEqual([1, 2]);
    expect(parsePartialJson('')).toBeUndefined();
  });

  it('handles escapes, including ones cut midway', () => {
    expect(parsePartialJson('{"t":"a\\"b\\u00e9')).toEqual({ t: 'a"bé' });
    expect(parsePartialJson('{"t":"line\\')).toEqual({ t: 'line' });
    expect(parsePartialJson('{"t":"x\\u00')).toEqual({ t: 'x' });
  });

  it('returns undefined for text that is not a JSON prefix', () => {
    expect(parsePartialJson('{"a" 1}')).toBeUndefined();
    expect(parsePartialJson('{a:1}')).toBeUndefined();
    expect(parsePartialJson('{"a":1x')).toBeUndefined();
    expect(parsePartialJson(`${'['.repeat(500)}`)).toBeUndefined();
  });
});

describe('i18n', () => {
  it('picks pt-BR for Portuguese tags and English otherwise, with overrides', () => {
    expect(createTranslator('pt-BR')('tabHistory')).toBe('Histórico');
    expect(createTranslator('pt-PT')('tabHistory')).toBe('Histórico');
    expect(createTranslator('de')('tabHistory')).toBe('History');
    const es = createTranslator('es-MX', {
      es: { tabHistory: 'Historial' },
      'es-MX': { tabCode: 'Código MX' },
    });
    expect(es('tabHistory')).toBe('Historial');
    expect(es('tabCode')).toBe('Código MX');
    expect(es('tabView')).toBe('View');
    expect(createTranslator('en')('savedVersion', { version: 3 })).toBe('Saved version 3');
  });
});

describe('theme styles', () => {
  it('derives dark variants and scopes themes', () => {
    expect(mixColors('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    const dark = darkTheme(defaultTheme);
    expect(dark.colors.background).not.toBe(defaultTheme.colors.background);
    const custom = {
      ...defaultTheme,
      id: 'corp"x',
      fonts: { ...defaultTheme.fonts, body: 'Evil"}body{color:red' },
    };
    const css = themeStyles(defaultTheme, [custom]);
    expect(css).toContain('.ak-root{--ak-color-text:#1D2F3C;');
    expect(css).toContain('.ak-root[data-ak-theme="corp\\"x"]');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('[data-theme="dark"] .ak-root');
    expect(css).not.toContain('}body{');
  });
});
