import { describe, expect, it } from 'vitest';
import {
  blocksToMarkdown,
  type Cover,
  contentToMarkdown,
  documentKind,
  escapeText,
  inlineToMarkdown,
  markdownToContent,
  parseMarkdown,
  type Run,
  splitFrontMatter,
} from '../src/index.js';
import fixture from './fixtures/workia-documento.json' with { type: 'json' };
import { catchError, prepare } from './helpers.js';

/** md → blocks → md must reach a fixed point after the first serialization and keep the blocks. */
function expectStable(markdown: string): string {
  const first = markdownToContent(markdown).content;
  const serialized = contentToMarkdown(first);
  const second = markdownToContent(serialized).content;
  expect(second).toEqual(first);
  expect(contentToMarkdown(second)).toBe(serialized);
  return serialized;
}

describe('Markdown input', () => {
  it('converts the GFM subset into blocks', () => {
    const { blocks, warnings, errors } = parseMarkdown(
      [
        '# Title',
        '',
        'Text with **bold**, *italic*, ~~strike~~, `code`, <u>under</u>, H<sub>2</sub>O, x<sup>2</sup> and [a link](https://example.com).',
        '',
        '1. one',
        '   - nested',
        '     1. deeper',
        '2. two',
        '',
        '| Left | Center | Right |',
        '| :--- | :---: | ---: |',
        '| a | b | c |',
        '',
        '> quoted',
        '>',
        '> — Someone',
        '',
        '> [!WARNING] Heads up',
        '> Be careful.',
        '',
        '```ts',
        'const a = 1;',
        '```',
        '',
        '***',
        '',
        '![Diagram of the flow](asset://img_1 "The flow")',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'table',
      'quote',
      'callout',
      'code',
      'divider',
      'image',
    ]);
    const paragraph = blocks[1] as { runs: Run[] };
    expect(paragraph.runs).toEqual(
      expect.arrayContaining([
        { text: 'bold', bold: true },
        { text: 'italic', italic: true },
        { text: 'strike', strike: true },
        { text: 'code', code: true },
        { text: 'under', underline: true },
        { text: '2', subscript: true },
        { text: '2', superscript: true },
        { text: 'a link', link: 'https://example.com' },
      ]),
    );
    expect(blocks[2]).toEqual({
      type: 'list',
      ordered: true,
      items: [
        {
          runs: [{ text: 'one' }],
          children: [
            { runs: [{ text: 'nested' }], children: [{ runs: [{ text: 'deeper' }] }], childrenOrdered: true },
          ],
          childrenOrdered: false,
        },
        { runs: [{ text: 'two' }] },
      ],
    });
    expect(blocks[3]).toMatchObject({ align: ['left', 'center', 'right'] });
    expect(blocks[4]).toEqual({ type: 'quote', runs: [{ text: 'quoted' }], attribution: 'Someone' });
    expect(blocks[5]).toEqual({
      type: 'callout',
      tone: 'warning',
      title: 'Heads up',
      runs: [{ text: 'Be careful.' }],
    });
    expect(blocks[6]).toEqual({ type: 'code', language: 'ts', text: 'const a = 1;' });
    expect(blocks[8]).toEqual({
      type: 'image',
      asset: 'asset://img_1',
      alt: 'Diagram of the flow',
      caption: 'The flow',
    });
  });

  it('reads GitHub alerts with a bold title line, toc and page break markers', () => {
    const { blocks } = parseMarkdown(
      '> [!NOTE]\n> **Title**\n> Body\n\n<!-- toc -->\n\n<!-- pagebreak -->\n\n[[_TOC_]]',
    );
    expect(blocks).toEqual([
      { type: 'callout', tone: 'info', title: 'Title', runs: [{ text: 'Body' }] },
      { type: 'toc' },
      { type: 'pageBreak' },
      { type: 'toc' },
    ]);
  });

  it('reports or drops what it cannot convert', () => {
    expect(parseMarkdown('![x](https://example.com/x.png)').errors[0]?.hint).toContain('asset://');
    const dropped = parseMarkdown(
      '![x](https://example.com/x.png)\n\n###### Deep\n\n<div>raw</div>\n\n[bad](javascript:alert(1))',
      { externalImages: 'drop' },
    );
    expect(dropped.errors).toEqual([]);
    expect(dropped.blocks).toEqual([
      { type: 'heading', level: 4, runs: [{ text: 'Deep' }] },
      { type: 'paragraph', runs: [{ text: '<div>raw</div>' }] },
      { type: 'paragraph', runs: [{ text: 'bad' }] },
    ]);
    expect(dropped.warnings).toHaveLength(4);
    const error = catchError(() => markdownToContent('![x](http://x.com/a.png)'));
    expect(error.code).toBe('INVALID_CONTENT');
    expect(error.issues[0]?.path).toBe('input.source');
  });

  it('flattens lists deeper than 3 levels and task items', () => {
    const { blocks, warnings } = parseMarkdown('- a\n  - b\n    - c\n      - d\n- [x] done\n- [ ] todo');
    expect(blocks[0]).toEqual({
      type: 'list',
      items: [
        {
          runs: [{ text: 'a' }],
          children: [
            { runs: [{ text: 'b' }], children: [{ runs: [{ text: 'c' }] }, { runs: [{ text: 'd' }] }] },
          ],
        },
        { runs: [{ text: '[x] done' }] },
        { runs: [{ text: '[ ] todo' }] },
      ],
    });
    expect(warnings[0]).toContain('3 levels');
    expect(() => prepare(markdownToContent('- a\n  - b\n    - c\n      - d').content)).not.toThrow();
  });

  it('pads short table rows and resolves reference links', () => {
    const { blocks } = parseMarkdown(
      '| a | b |\n|---|---|\n| 1 |\n\nSee [docs][d].\n\n[d]: https://docs.example.com',
    );
    expect(blocks[0]).toMatchObject({ rows: [[[{ text: '1' }], []]] });
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'See ' }, { text: 'docs', link: 'https://docs.example.com' }, { text: '.' }],
    });
  });

  it('reads front matter into the cover', () => {
    const front = splitFrontMatter(
      '---\ntitle: "Plan #1"\nsubtitle: Q3 # comment\nfields:\n  - label: Client\n    value: Acme\n  - label: "Date"\n    value: 2026-11-04\npage: {"size":"Letter"}\n---\n\nBody',
    );
    expect(front?.data).toEqual({
      title: 'Plan #1',
      subtitle: 'Q3',
      fields: [
        { label: 'Client', value: 'Acme' },
        { label: 'Date', value: '2026-11-04' },
      ],
      page: { size: 'Letter' },
    });
    const { content } = markdownToContent(
      '---\ntitulo: Proposta\nsubtitulo: Portal\ncampos:\n  cliente: Acme\n  prazo: 30 dias\n---\n\nTexto',
    );
    expect(content.cover).toEqual({
      title: 'Proposta',
      subtitle: 'Portal',
      fields: [
        { label: 'cliente', value: 'Acme' },
        { label: 'prazo', value: '30 dias' },
      ],
    });
    expect(content.blocks).toEqual([{ id: 'p1', type: 'paragraph', runs: [{ text: 'Texto' }] }]);
    const explicit = markdownToContent({
      markdown: '---\ntitle: A\n---\n\nx',
      cover: { title: 'B' },
    }).content;
    expect(explicit.cover).toEqual({ title: 'B' });
  });

  it('is registered as the "markdown" input', () => {
    const content = documentKind.inputs?.markdown?.toContent('# Hi\n\nThere', { locale: 'en' });
    expect(content).toEqual({
      blocks: [
        { id: 'h1', type: 'heading', level: 1, runs: [{ text: 'Hi' }] },
        { id: 'p1', type: 'paragraph', runs: [{ text: 'There' }] },
      ],
    });
  });
});

describe('Markdown output', () => {
  it('nests marks and falls back to HTML tags when delimiters would not parse', () => {
    expect(
      inlineToMarkdown([
        { text: 'bold ', bold: true },
        { text: 'both', bold: true, italic: true },
        { text: ' plain' },
      ]),
    ).toBe('**bold *both*** plain');
    expect(inlineToMarkdown([{ text: '"quoted"', bold: true }, { text: 'after' }])).toBe(
      '<b>"quoted"</b>after',
    );
    expect(inlineToMarkdown([{ text: 'see ' }, { text: 'site', link: 'https://x.com', bold: true }])).toBe(
      'see [**site**](https://x.com)',
    );
    expect(inlineToMarkdown([{ text: 'https://x.com', link: 'https://x.com' }])).toBe('<https://x.com>');
    expect(inlineToMarkdown([{ text: 'a`b', code: true }])).toBe('``a`b``');
    expect(inlineToMarkdown([{ text: 'H' }, { text: '2', subscript: true }, { text: 'O' }])).toBe(
      'H<sub>2</sub>O',
    );
  });

  it('escapes Markdown syntax in text', () => {
    expect(escapeText('# not *a* [heading] <b> snake_case _x_ a&amp;b https://x.com me@x.com ~~')).toBe(
      '\\# not \\*a\\* \\[heading\\] \\<b> snake_case \\_x\\_ a\\&amp;b https\\://x.com me\\@x.com \\~\\~',
    );
    expect(escapeText('1. not a list\n- nor this\n> nor a quote')).toBe(
      '1\\. not a list\n\\- nor this\n\\> nor a quote',
    );
  });

  it('keeps adjacent lists separate and serializes metadata comments', () => {
    const content = prepare({
      cover: { title: 'T', fields: [{ label: 'a', value: 'b' }] },
      blocks: [
        { type: 'list', items: [{ runs: [{ text: 'a' }] }] },
        { type: 'list', items: [{ runs: [{ text: 'b' }] }] },
        {
          type: 'table',
          header: [[{ text: 'A' }]],
          rows: [[[{ text: '1' }]]],
          footer: [[{ text: '2' }]],
          caption: 'Cap',
          widths: [1],
        },
        { type: 'paragraph', runs: [{ text: 'centered' }], align: 'center' },
        { type: 'toc', maxLevel: 2 },
        { type: 'pageBreak' },
        { type: 'image', asset: 'asset://a', alt: 'A chart', width: 0.5 },
      ],
    });
    const markdown = contentToMarkdown(content);
    expect(markdown).toContain('- a\n\n* b');
    expect(markdown).toContain('<!-- ak:table {"caption":"Cap","footer":true,"widths":[1]} -->');
    expect(markdown).toContain('<!-- ak:paragraph {"align":"center"} -->');
    expect(markdown).toContain('<!-- ak:toc {"maxLevel":2} -->');
    expect(markdown).toContain('<!-- ak:pagebreak -->');
    expect(markdown.startsWith('---\ntitle: "T"\nfields:\n  - label: "a"\n    value: "b"\n---\n')).toBe(true);
    const back = markdownToContent(markdown).content;
    expect(back.cover).toEqual(content.cover);
    expect(back.blocks.map(({ id: _id, ...rest }) => rest)).toEqual(
      content.blocks.map(({ id: _id, ...rest }) => rest),
    );
  });

  it('keeps ids through anchors when asked', () => {
    const content = prepare({
      blocks: [
        { id: 'scope', type: 'heading', level: 2, runs: [{ text: 'Scope' }] },
        { id: 'tbl', type: 'table', header: [[{ text: 'A' }]], rows: [] },
      ],
    });
    const markdown = blocksToMarkdown(content.blocks, { ids: true });
    expect(markdown).toBe('## Scope <!-- #scope -->\n\n| A |\n| --- |\n\n<!-- #tbl -->');
    expect(markdownToContent(markdown).content.blocks).toEqual(content.blocks);
  });

  it('round-trips the supported subset stably', () => {
    const markdown = expectStable(
      [
        '---',
        'eyebrow: "Proposal"',
        'title: "Portal"',
        '---',
        '',
        '# Heading with `code` and #',
        '',
        'Paragraph with **bold _and italic_**, ~~gone~~, <u>under</u>, x<sup>2</sup>, a [link](https://example.com/a_(b)) and a\nsoft break. Price: $10 | 20% * 3 & co.',
        '',
        '1. first',
        '2. second',
        '   - child **bold**',
        '     - grandchild',
        '',
        '- [ ] task',
        '',
        '| Name | Value |',
        '| --- | ---: |',
        '| a \\| b | `x\\|y` |',
        '',
        '> A quote',
        '> on two lines',
        '>',
        '> — Author',
        '',
        '> [!TIP]',
        '> **Remember**',
        '> Do it.',
        '',
        '````md',
        '```js',
        'nested',
        '```',
        '````',
        '',
        '---',
        '',
        '![Alt [text]](asset://img_1 "Caption \\"q\\"")',
        '',
        'snake_case_word, _emphasis_, 1. not a list, www.example.com and me@example.com',
      ].join('\n'),
    );
    expect(markdown).toContain('| a \\| b | `x\\|y` |');
  });

  it('converts the Workia document fixture without loss', () => {
    const { frontmatter, body } = fixture;
    const cover: Cover = {
      title: frontmatter.titulo,
      subtitle: frontmatter.subtitulo,
      fields: Object.entries(frontmatter.campos).map(([label, value]) => ({ label, value })),
    };
    const { content, warnings } = markdownToContent({ markdown: body, cover });
    expect(warnings).toEqual([]);
    expect(() => prepare(content)).not.toThrow();
    expect(content.cover).toEqual({
      title: 'Proposta Técnica',
      subtitle: 'Portal do Cliente Acme',
      fields: [{ label: 'cliente', value: 'Acme Indústria' }],
    });
    expect(content.blocks.map((block) => `${block.id}:${block.type}`)).toEqual([
      'p1:paragraph',
      'h1:heading',
      'p2:paragraph',
      'h2:heading',
      'l1:list',
      'l2:list',
      'h3:heading',
      'q1:quote',
      't1:table',
      'code1:code',
      'hr1:divider',
      'h4:heading',
      'p3:paragraph',
    ]);
    // Placeholders stay literal text.
    expect(content.blocks[0]).toEqual({
      id: 'p1',
      type: 'paragraph',
      runs: [{ text: 'Documento preparado para {{campo:cliente}}.' }],
    });
    expect(content.blocks[12]).toMatchObject({
      runs: [{ text: 'Total estimado: {{ref:estimativa.totais.total|moeda}}.' }],
    });
    expect(content.blocks[2]).toMatchObject({
      runs: [
        { text: 'A Acme precisa de um ' },
        { text: 'portal único', bold: true },
        { text: ' com ' },
        { text: 'autenticação', italic: true },
        { text: ' e ' },
        { text: 'SSO', code: true },
        { text: ', conforme o ' },
        { text: 'site da Mouts', link: 'https://mouts.info' },
        { text: '.\nO portal substitui três sistemas legados & planilhas.' },
      ],
    });
    expect(content.blocks[4]).toMatchObject({
      items: [{}, { children: [{ runs: [{ text: 'Exportação em PDF' }] }] }, {}],
    });
    expect(content.blocks[5]).toMatchObject({
      ordered: true,
      items: [{ runs: [{ text: 'Descoberta' }] }, {}, {}],
    });
    expect(content.blocks[8]).toMatchObject({
      header: [[{ text: 'Módulo' }], [{ text: 'Horas' }], [{ text: 'Responsável' }]],
      rows: [
        [[{ text: 'Login' }], [{ text: '40' }], [{ text: 'Ana' }]],
        [[{ text: 'Relatórios' }], [{ text: '80' }], []],
      ],
      align: ['left', 'right', 'left'],
    });
    expect(content.blocks[9]).toEqual({
      id: 'code1',
      type: 'code',
      text: 'GET /api/v1/clientes\nPOST /api/v1/pedidos',
    });
    // Serializing back keeps the body readable and stable.
    const markdown = expectStable(body);
    expect(markdown).toContain('Documento preparado para {{campo:cliente}}.');
    expect(markdown).toContain('Total estimado: {{ref:estimativa.totais.total|moeda}}.');
  });
});

describe('inline round trip (generated)', () => {
  it('parses back every combination of marks and tricky characters', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const words = [
      'alpha',
      '"quoted"',
      '(paren)',
      'a*b',
      'snake_case',
      '#tag',
      '[x]',
      'a|b',
      '<tag>',
      'x~y',
      '1.',
      '-dash',
      'end.',
      'ç',
      '`tick`',
      'a\\b',
      '&amp;',
    ];
    const flags = ['bold', 'italic', 'strike', 'underline', 'code', 'superscript', 'subscript'] as const;
    for (let round = 0; round < 300; round++) {
      const runs: Run[] = [];
      const count = 1 + Math.floor(random() * 5);
      for (let i = 0; i < count; i++) {
        if (i > 0) runs.push({ text: ' ' });
        const run: Run = { text: words[Math.floor(random() * words.length)]! };
        for (const flag of flags) if (random() < 0.25) run[flag] = true;
        if (run.superscript && run.subscript) delete run.subscript;
        if (random() < 0.15) run.link = 'https://example.com/a';
        runs.push(run);
      }
      const content = prepare({ blocks: [{ id: 'p', type: 'paragraph', runs }] });
      const markdown = contentToMarkdown(content);
      const back = markdownToContent(markdown).content.blocks[0] as { runs: Run[] };
      const expected = (content.blocks[0] as { runs: Run[] }).runs;
      expect({ markdown, runs: back.runs }).toEqual({ markdown, runs: mergeRuns(expected) });
      if (round === 3) expect(markdown).toMatch(/\*|<|~|`/);
    }
  });
});

/** Merges neighbors with equal formatting, like the parser output. */
function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    const { text: _a, ...fa } = last ?? { text: '' };
    const { text: _b, ...fb } = run;
    if (last && JSON.stringify(Object.entries(fa).sort()) === JSON.stringify(Object.entries(fb).sort()))
      last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}
