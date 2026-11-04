/**
 * Authored guidance per kind (spec §14.7 checklist table). Technical parts (fields, operations, limits)
 * are generated from the registry; only judgement lives here. Third-party kinds use the generic fallback.
 */
export interface KindGuide {
  /** When to pick this kind, for the decision table in SKILL.md. */
  useWhen: string;
  checklist: string[];
  antiPatterns: string[];
}

export const KIND_GUIDES: Record<string, KindGuide> = {
  document: {
    useWhen: 'Text people read, review or sign: proposals, reports, specs, contracts, meeting notes.',
    checklist: [
      'Heading hierarchy has no skipped levels (h1 → h2 → h3).',
      'Tables have a header row; totals get their own final row.',
      'Assumptions and risks go in callouts, not buried in paragraphs.',
      'Create from Markdown (`input.format: "markdown"`); edit existing blocks by id with operations.',
      'Every image has alternative text.',
    ],
    antiPatterns: [
      'Recreating the whole document with `replace_content` to change one paragraph.',
      'Pasting raw HTML into text fields.',
      'Empty paragraphs used as spacing.',
    ],
  },
  sheet: {
    useWhen: 'Calculations, totals, estimates, budgets and any tabular data that needs formulas.',
    checklist: [
      'Totals are always formulas, never typed numbers.',
      'Input values live apart from calculations; keep an assumptions sheet.',
      'Use named number formats (currency, percent, date) instead of formatted text.',
      'Use `fill_range` for series instead of one operation per cell.',
      'Numbers are stored as numbers, not as text.',
    ],
    antiPatterns: [
      'Hard-coding a computed total that will go stale.',
      'Mixing units or currencies in one column.',
      'Formulas pointing at empty cells.',
    ],
  },
  slides: {
    useWhen: 'A presentation for a meeting, pitch or review.',
    checklist: [
      'Prefer layouts and slots before free positioning.',
      'One idea per slide; the title states the takeaway as a sentence.',
      'Keep bullets short and few per slide; move detail to speaker notes.',
      'Highlight key numbers with a `big-number` element.',
      'Use theme color tokens so contrast stays readable.',
    ],
    antiPatterns: [
      'Walls of text copied from a document.',
      'Overlapping elements placed by absolute position without intent.',
      'Slides without a title.',
    ],
  },
  diagram: {
    useWhen: 'Structure and flows: architecture, processes, org charts, dependencies.',
    checklist: [
      'Groups represent layers or swimlanes.',
      'Labels are short (a few words).',
      'Keep one dominant direction (left→right or top→bottom).',
      'Create from Mermaid (`input.format: "mermaid"`); adjust with operations.',
      'Every edge points to existing nodes; no isolated nodes without reason.',
    ],
    antiPatterns: [
      'Long sentences inside node labels.',
      'Duplicate edges between the same nodes.',
      'Empty groups.',
    ],
  },
};

export const GENERIC_KIND_GUIDE: KindGuide = {
  useWhen: '',
  checklist: [
    'Read the outline before editing an existing artifact.',
    'Use short, semantic, stable ids for new items.',
    'Prefer small operations over replacing the whole content.',
    'Resolve lint warnings returned by the tools before finishing.',
  ],
  antiPatterns: [
    'Replacing the whole content to change a single item.',
    'Inventing ids that are not in the projection.',
  ],
};

export function kindGuide(kind: string): KindGuide {
  return KIND_GUIDES[kind] ?? GENERIC_KIND_GUIDE;
}
