import type { KindInstructions } from '@artkit-ai/core';
import type { LayoutRegistry } from './layouts.js';

function describeLayouts(layouts: LayoutRegistry): string {
  return layouts
    .list()
    .map((layout) => {
      const slots = layout.slots.map(
        (slot) =>
          `${slot.name}${slot.accepts.length === 1 ? `:${slot.accepts[0]}` : `:${slot.accepts.join('|')}`}`,
      );
      return `${layout.name} (${slots.length > 0 ? slots.join(', ') : 'no slots'}): ${layout.description}`;
    })
    .join('; ');
}

const exampleDeck = {
  slides: [
    {
      id: 'intro',
      layout: 'title',
      slots: { title: 'Supplier portal: one place for every vendor', subtitle: 'Proposal · November 2026' },
    },
    {
      id: 'problem',
      layout: 'title-content',
      slots: {
        title: 'Manual onboarding takes 12 days per supplier',
        body: {
          type: 'bullets',
          items: [
            'Three disconnected systems',
            'Data typed twice by hand',
            { text: 'Reports arrive a week late', level: 1 },
          ],
        },
      },
      notes: 'Mention the audit findings from March.',
    },
    {
      id: 'impact',
      layout: 'big-number',
      slots: {
        title: 'The pilot cut onboarding time by 40%',
        stat: {
          type: 'stats',
          items: [
            { value: '40%', label: 'faster onboarding' },
            { value: '3x', label: 'fewer data errors' },
          ],
        },
        caption: 'Pilot with 25 suppliers, Q3 2026',
      },
    },
    {
      id: 'plan',
      layout: 'title-content',
      slots: {
        title: 'Delivery in three phases',
        body: {
          type: 'steps',
          items: [
            { title: 'Discovery', description: 'Interviews and process map' },
            { title: 'Build', description: 'Portal and integrations' },
            { title: 'Rollout', description: 'Training and support' },
          ],
        },
      },
    },
    {
      id: 'growth',
      layout: 'title-content',
      slots: {
        title: 'Registered suppliers double every quarter',
        body: {
          type: 'chart',
          chartType: 'column',
          categories: ['Q1', 'Q2', 'Q3'],
          series: [{ name: 'Suppliers', values: [120, 250, 510] }],
          showValues: true,
        },
      },
    },
  ],
  footer: { text: 'Acme · Confidential', slideNumber: true },
};

const editDeck = {
  slides: [
    { id: 'cover', layout: 'title', slots: { title: 'Quarterly review' } },
    {
      id: 'results',
      layout: 'title-content',
      slots: { title: 'Revenue grew 18%', body: { type: 'bullets', items: ['New region', 'Upsell'] } },
    },
  ],
};

export function createInstructions(layouts: LayoutRegistry): KindInstructions {
  return {
    summary:
      'Slide deck (16:9 canvas of 13.333 x 7.5 inches). Each slide picks a layout and fills its named slots; free elements positioned in inches are available for compositions no layout covers. Exports to editable PowerPoint.',
    rules: [
      `Layouts and their slots: ${describeLayouts(layouts)}.`,
      'Prefer layouts with slots; use free elements (x, y, w, h in inches) only when no layout fits. Elements must stay inside the canvas: x + w ≤ 13.333 and y + h ≤ 7.5.',
      'One idea per slide. The title is a short assertion stating the takeaway (e.g. "Costs fell 20% after automation"), not a topic label.',
      'At most 6 bullets per box and 2 indentation levels; keep bullets under 12 words.',
      'Highlight numbers with the big-number layout or "stats" content; use "steps" for processes, "cards" for parallel items, charts for trends and comparisons.',
      'Put details, sources and talking points in the speaker notes, not on the slide.',
      'Colors are theme tokens (text, muted, accent, background, surface, info, warning, success, danger); use hex only when the user asks for a specific color.',
      'Slide and element ids are unique across the whole deck and stay stable; read the projection and reference items by id.',
      'Edit with operations (set_slot, update_element, add_slide…) instead of replace_content. A text slot accepts a plain string; other contents need "type".',
      'Tables: every row has one cell per column (header included), at most about 8 rows per slide. Charts: one value per category in every series; pie charts take one series.',
      'Images use "asset://<id>" references registered beforehand and always need alt text.',
    ],
    examples: [
      { title: 'Create a deck with layouts', content: exampleDeck },
      {
        title: 'Edit slots, add a slide and notes',
        content: editDeck,
        operations: [
          { op: 'set_slot', slide: 'cover', slot: 'subtitle', content: 'Board meeting · Q3 2026' },
          {
            op: 'add_slide',
            after: 'results',
            slide: {
              id: 'next',
              layout: 'two-columns',
              slots: {
                title: 'Two bets for next quarter',
                left: { type: 'bullets', items: ['Self-service onboarding', 'Partner channel'] },
                right: { type: 'stats', items: [{ value: '+12%', label: 'expected revenue' }] },
              },
            },
          },
          { op: 'set_notes', slide: 'results', notes: 'Growth came mostly from the new region.' },
          { op: 'move_slide', slide: 'next', position: 2 },
        ],
      },
      {
        title: 'Free elements on a blank slide',
        content: editDeck,
        operations: [
          {
            op: 'add_slide',
            slide: {
              id: 'custom',
              layout: 'blank',
              elements: [
                {
                  id: 'headline',
                  type: 'text',
                  x: 0.6,
                  y: 0.4,
                  w: 12.1,
                  h: 1,
                  paragraphs: ['Three markets, one platform'],
                  fontSize: 32,
                  bold: true,
                },
                {
                  id: 'panel',
                  type: 'shape',
                  shape: 'roundRect',
                  x: 0.6,
                  y: 1.8,
                  w: 5.8,
                  h: 4.6,
                  fill: 'surface',
                },
                {
                  id: 'panel-text',
                  type: 'text',
                  x: 0.9,
                  y: 2.1,
                  w: 5.2,
                  h: 4,
                  bullets: ['Brazil', 'Mexico', 'Chile'],
                },
              ],
            },
          },
          { op: 'update_element', element: 'panel', set: { fill: 'info' } },
          { op: 'update_element', element: 'panel-text', set: { color: 'background' } },
          {
            op: 'add_element',
            slide: 'custom',
            element: {
              type: 'text',
              x: 6.9,
              y: 1.8,
              w: 5.8,
              h: 1,
              paragraphs: ['Rollout starts in March'],
              color: 'muted',
            },
          },
        ],
      },
    ],
  };
}
