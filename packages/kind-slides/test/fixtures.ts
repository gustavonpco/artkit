import type { SlidesContent } from '../src/index.js';

/** A deck that exercises every slot content kind and every element type. */
export const fullDeck: SlidesContent = {
  size: '16:9',
  footer: { text: 'Acme · Confidential', slideNumber: true },
  slides: [
    {
      id: 'cover',
      layout: 'title',
      slots: { title: 'Supplier portal', subtitle: 'Proposal · 2026' },
      elements: [],
      notes: 'Open with the discovery meeting context.',
    },
    {
      id: 'problem',
      layout: 'title-content',
      slots: {
        title: 'Manual onboarding takes 12 days',
        body: {
          type: 'bullets',
          items: [
            'Three disconnected systems',
            { runs: [{ text: 'Data typed ' }, { text: 'twice', bold: true }] },
            { text: 'Late reports', level: 1 },
          ],
        },
      },
      elements: [],
    },
    {
      id: 'kpis',
      layout: 'big-number',
      slots: {
        title: 'The pilot cut onboarding by 40%',
        stat: {
          type: 'stats',
          items: [
            { value: '40%', label: 'faster' },
            { value: '3x', label: 'fewer errors' },
          ],
        },
        caption: 'Pilot with 25 suppliers',
      },
      elements: [],
    },
    {
      id: 'plan',
      layout: 'two-columns',
      slots: {
        title: 'Plan and budget',
        left: {
          type: 'steps',
          items: [{ title: 'Discovery', description: 'Interviews' }, { title: 'Build' }],
        },
        right: {
          type: 'table',
          header: ['Phase', 'Weeks'],
          rows: [
            ['Discovery', '4'],
            ['Build', '12'],
          ],
          widths: [2, 1],
        },
      },
      elements: [],
    },
    {
      id: 'growth',
      layout: 'title-image',
      slots: {
        title: 'Suppliers double every quarter',
        image: {
          type: 'chart',
          chartType: 'column',
          categories: ['Q1', 'Q2', 'Q3'],
          series: [
            { name: 'Suppliers', values: [120, 250, 510] },
            { name: 'Active', values: [80, 200, 430] },
          ],
          showValues: true,
        },
        body: { type: 'text', paragraphs: ['Growth accelerates after rollout.'] },
      },
      elements: [],
    },
    {
      id: 'why',
      layout: 'comparison',
      slots: {
        title: 'Why now',
        leftTitle: 'Today',
        left: {
          type: 'cards',
          items: [
            { title: 'Slow', bullets: ['12 days', 'Manual'] },
            { image: { asset: 'asset://diagram', alt: 'Architecture' }, caption: 'Current flow' },
          ],
        },
        rightTitle: 'With the portal',
        right: { type: 'quote', text: 'Onboarding became a one-day task.', attribution: 'Pilot customer' },
      },
      elements: [],
    },
    {
      id: 'custom',
      layout: 'blank',
      slots: {},
      background: { color: 'surface' },
      elements: [
        {
          id: 'headline',
          type: 'text',
          x: 0.6,
          y: 0.4,
          w: 12.1,
          h: 1,
          paragraphs: ['Three markets'],
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
          fill: 'info',
          text: { paragraphs: ['Brazil'], color: 'background' },
        },
        {
          id: 'arrow1',
          type: 'shape',
          shape: 'arrow',
          x: 6.6,
          y: 4,
          w: 1,
          h: 0,
          line: { color: 'muted', width: 2 },
        },
        {
          id: 'photo',
          type: 'image',
          x: 7.8,
          y: 1.8,
          w: 4.9,
          h: 2.4,
          asset: 'asset://photo',
          alt: 'Team photo',
          fit: 'cover',
        },
        {
          id: 'chart1',
          type: 'chart',
          x: 7.8,
          y: 4.4,
          w: 4.9,
          h: 2.4,
          chartType: 'pie',
          categories: ['A', 'B'],
          series: [{ name: 'Share', values: [60, 40] }],
          legend: 'right',
        },
      ],
      hidden: true,
    },
  ],
};
