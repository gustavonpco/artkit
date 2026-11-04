import type { Color } from '@artkit-ai/core';
import type { Paragraph, Run } from '../schema.js';
import { denormalizeParagraph, mergeRuns, type NormalizedParagraph } from '../text.js';

/** A caret position inside a list of paragraphs: paragraph index and character offset. */
export interface TextPoint {
  paragraph: number;
  offset: number;
}

export interface TextRange {
  start: TextPoint;
  end: TextPoint;
}

export type Mark = 'bold' | 'italic' | 'underline';

function comparePoints(a: TextPoint, b: TextPoint): number {
  return a.paragraph - b.paragraph || a.offset - b.offset;
}

export function orderedRange(range: TextRange): TextRange {
  return comparePoints(range.start, range.end) <= 0 ? range : { start: range.end, end: range.start };
}

export function isCollapsed(range: TextRange): boolean {
  return comparePoints(range.start, range.end) === 0;
}

function paragraphLength(paragraph: NormalizedParagraph): number {
  return paragraph.runs.reduce((sum, run) => sum + run.text.length, 0);
}

/** Splits runs so that `offset` falls on a run boundary; returns the index of the run starting there. */
function splitAt(runs: Run[], offset: number): number {
  let position = 0;
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!;
    const end = position + run.text.length;
    if (offset === position) return index;
    if (offset < end) {
      runs.splice(
        index,
        1,
        { ...run, text: run.text.slice(0, offset - position) },
        { ...run, text: run.text.slice(offset - position) },
      );
      return index + 1;
    }
    position = end;
  }
  return runs.length;
}

/** Applies `update` to every run (or run fragment) inside the range. Pure: returns new paragraphs. */
export function updateRuns(
  paragraphs: readonly NormalizedParagraph[],
  range: TextRange,
  update: (run: Run) => Run,
): NormalizedParagraph[] {
  const { start, end } = orderedRange(range);
  return paragraphs.map((paragraph, index) => {
    if (index < start.paragraph || index > end.paragraph) return paragraph;
    const from = index === start.paragraph ? start.offset : 0;
    const to = index === end.paragraph ? end.offset : paragraphLength(paragraph);
    if (from >= to) return paragraph;
    const runs = paragraph.runs.map((run) => ({ ...run }));
    const first = splitAt(runs, from);
    const last = splitAt(runs, to);
    for (let i = first; i < last; i++) runs[i] = update(runs[i]!);
    return { ...paragraph, runs: mergeRuns(runs) };
  });
}

/** True when every character in the range has the mark. */
export function hasMark(paragraphs: readonly NormalizedParagraph[], range: TextRange, mark: Mark): boolean {
  const { start, end } = orderedRange(range);
  let any = false;
  for (let index = start.paragraph; index <= end.paragraph; index++) {
    const paragraph = paragraphs[index];
    if (!paragraph) continue;
    const from = index === start.paragraph ? start.offset : 0;
    const to = index === end.paragraph ? end.offset : paragraphLength(paragraph);
    let position = 0;
    for (const run of paragraph.runs) {
      const runEnd = position + run.text.length;
      if (runEnd > from && position < to) {
        any = true;
        if (!run[mark]) return false;
      }
      position = runEnd;
    }
  }
  return any;
}

/** Toggles a mark over the range: removes it when the whole range has it, adds it otherwise. */
export function toggleMark(
  paragraphs: readonly NormalizedParagraph[],
  range: TextRange,
  mark: Mark,
): NormalizedParagraph[] {
  const active = hasMark(paragraphs, range, mark);
  return updateRuns(paragraphs, range, (run) => {
    const next = { ...run };
    if (active) delete next[mark];
    else next[mark] = true;
    return next;
  });
}

/** Sets (or clears with `undefined`) the color of the range. */
export function setRunColor(
  paragraphs: readonly NormalizedParagraph[],
  range: TextRange,
  color: Color | undefined,
): NormalizedParagraph[] {
  return updateRuns(paragraphs, range, (run) => {
    const next = { ...run };
    if (color) next.color = color;
    else delete next.color;
    return next;
  });
}

function touched(paragraphs: readonly NormalizedParagraph[], range: TextRange): Set<number> {
  const { start, end } = orderedRange(range);
  const out = new Set<number>();
  for (let index = start.paragraph; index <= Math.min(end.paragraph, paragraphs.length - 1); index++)
    out.add(index);
  return out;
}

/** Sets the list kind of the paragraphs in the range (`undefined` makes them plain paragraphs). */
export function setList(
  paragraphs: readonly NormalizedParagraph[],
  range: TextRange,
  list: 'bullet' | 'number' | undefined,
): NormalizedParagraph[] {
  const indexes = touched(paragraphs, range);
  return paragraphs.map((paragraph, index) => {
    if (!indexes.has(index)) return paragraph;
    const { list: _list, ...rest } = paragraph;
    return list ? { ...rest, list } : { ...rest, level: 0 };
  });
}

/** Changes the indentation level of list paragraphs in the range by `delta`, within 0–4. */
export function shiftLevel(
  paragraphs: readonly NormalizedParagraph[],
  range: TextRange,
  delta: number,
): NormalizedParagraph[] {
  const indexes = touched(paragraphs, range);
  return paragraphs.map((paragraph, index) =>
    indexes.has(index) && paragraph.list
      ? { ...paragraph, level: Math.max(0, Math.min(4, paragraph.level + delta)) }
      : paragraph,
  );
}

/** Compact schema form of edited paragraphs, as `paragraphs` or as `bullets` when every item is a bullet. */
export function toTextFields(
  paragraphs: readonly NormalizedParagraph[],
  preferBullets: boolean,
): { paragraphs: Paragraph[] } | { bullets: Paragraph[] } {
  const allBullets = paragraphs.length > 0 && paragraphs.every((paragraph) => paragraph.list === 'bullet');
  if (allBullets && preferBullets)
    return { bullets: paragraphs.map((paragraph) => denormalizeParagraph(paragraph, 'bullet')) };
  return { paragraphs: paragraphs.map((paragraph) => denormalizeParagraph(paragraph)) };
}

// ---------------------------------------------------------------------------------------------------------
// DOM bridge for the contentEditable editor. The editor renders each paragraph as a block element with
// `data-list`/`data-level`; browsers clone those attributes when Enter splits a block.

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function marksFrom(element: Element, inherited: Omit<Run, 'text'>): Omit<Run, 'text'> {
  const marks = { ...inherited };
  const tag = element.tagName;
  const style = (element as HTMLElement).style;
  if (tag === 'B' || tag === 'STRONG' || style?.fontWeight === 'bold' || Number(style?.fontWeight) >= 600)
    marks.bold = true;
  if (tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic') marks.italic = true;
  if (tag === 'U' || style?.textDecoration?.includes('underline')) marks.underline = true;
  const color = element.getAttribute('data-color');
  if (color) marks.color = color as Color;
  const link = element.getAttribute('data-link');
  if (link) marks.link = link;
  return marks;
}

function collectRuns(node: Node, marks: Omit<Run, 'text'>, out: Run[]): void {
  if (node.nodeType === 3) {
    out.push({ ...marks, text: node.textContent ?? '' });
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  if (element.tagName === 'BR') {
    out.push({ ...marks, text: '\n' });
    return;
  }
  const next = marksFrom(element, marks);
  for (const child of element.childNodes) collectRuns(child, next, out);
}

function paragraphFrom(element: Element | undefined, runs: Run[]): NormalizedParagraph {
  const list = element?.getAttribute('data-list');
  const level = Number(element?.getAttribute('data-level') ?? 0);
  // A trailing <br> is only the browser's placeholder for an empty line.
  const cleaned = runs.length > 0 && runs[runs.length - 1]!.text === '\n' ? runs.slice(0, -1) : runs;
  return {
    runs: mergeRuns(cleaned.map((run) => ({ ...run, text: run.text.replace(/ /g, ' ') }))),
    level: list ? Math.max(0, Math.min(4, Number.isFinite(level) ? level : 0)) : 0,
    ...(list === 'bullet' || list === 'number' ? { list } : {}),
  };
}

/** Reads the editor DOM back into paragraphs: one per block child, inline marks from tags and data attributes. */
export function readParagraphs(root: Element): NormalizedParagraph[] {
  const paragraphs: NormalizedParagraph[] = [];
  let loose: Run[] = [];
  const flush = () => {
    if (loose.length > 0) paragraphs.push(paragraphFrom(undefined, loose));
    loose = [];
  };
  for (const child of root.childNodes) {
    if (child.nodeType === 1 && BLOCK_TAGS.has((child as Element).tagName)) {
      flush();
      const runs: Run[] = [];
      for (const inner of child.childNodes) collectRuns(inner, marksFrom(child as Element, {}), runs);
      paragraphs.push(paragraphFrom(child as Element, runs));
    } else {
      collectRuns(child, {}, loose);
    }
  }
  flush();
  return paragraphs.length > 0 ? paragraphs : [{ runs: [{ text: '' }], level: 0 }];
}

function blockOf(root: Element, node: Node): Element | undefined {
  let current: Node | null = node;
  while (current && current.parentNode !== root) current = current.parentNode;
  return current && current.nodeType === 1 ? (current as Element) : undefined;
}

/** Converts a DOM position (container + offset) into a paragraph/character point. */
export function pointFromDom(root: Element, container: Node, offset: number): TextPoint {
  const blocks = [...root.children];
  const block = container === root ? blocks[Math.min(offset, blocks.length - 1)] : blockOf(root, container);
  const paragraph = Math.max(0, block ? blocks.indexOf(block) : 0);
  if (!block) return { paragraph, offset: 0 };
  if (container === root) return { paragraph, offset: 0 };
  let count = 0;
  const walker = root.ownerDocument.createTreeWalker(block, 4);
  let node = walker.nextNode();
  while (node) {
    if (node === container) return { paragraph, offset: count + offset };
    count += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  // Container is an element inside the block: count the text before its `offset`-th child.
  if (container.nodeType === 1) {
    let before = 0;
    const children = [...container.childNodes].slice(0, offset);
    for (const child of children) before += child.textContent?.length ?? 0;
    const range = root.ownerDocument.createRange();
    range.setStart(block, 0);
    range.setEnd(container, 0);
    return { paragraph, offset: range.toString().length + before };
  }
  return { paragraph, offset: count };
}

/** Finds the DOM text position for a paragraph/character point. */
export function domFromPoint(root: Element, point: TextPoint): { node: Node; offset: number } {
  const block = root.children[Math.min(point.paragraph, root.children.length - 1)];
  if (!block) return { node: root, offset: 0 };
  const walker = root.ownerDocument.createTreeWalker(block, 4);
  let remaining = point.offset;
  let node = walker.nextNode();
  let last: Node | null = null;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    last = node;
    node = walker.nextNode();
  }
  return last ? { node: last, offset: last.textContent?.length ?? 0 } : { node: block, offset: 0 };
}

/** Current selection inside `root` as a text range, or undefined when the selection is elsewhere. */
export function readSelection(root: Element): TextRange | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  return {
    start: pointFromDom(root, range.startContainer, range.startOffset),
    end: pointFromDom(root, range.endContainer, range.endOffset),
  };
}

export function writeSelection(root: Element, range: TextRange): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const start = domFromPoint(root, range.start);
  const end = domFromPoint(root, range.end);
  const dom = root.ownerDocument.createRange();
  dom.setStart(start.node, start.offset);
  dom.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(dom);
}
