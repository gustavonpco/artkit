// @vitest-environment node

import { applyOperations, createRegistry, prepareContent, type ReadRequest } from '@artkit-ai/core';
import { defineFormatConformanceTests } from '@artkit-ai/core/testing';
import { describe, expect, it } from 'vitest';
import { diffMarkdown, lintMarkdown, markdownFormat, parseDocument, stripRawHtml } from '../src/index.js';

const registry = createRegistry({ formats: [markdownFormat] });
const base = `---
cliente: Grupo Meridiano
---
Introdução do documento.

# Escopo {#escopo}

Texto do escopo com a palavra chave.

## Premissas

- Ambiente em nuvem.

# Cronograma

Entrega em 16 semanas.
`;

function run(content: string, operations: unknown[]) {
  return applyOperations(
    registry,
    { format: 'markdown', content, title: 'Doc', themeId: 'default', locale: 'pt-BR' },
    operations,
  );
}

function read(content: string, request: Partial<ReadRequest> & Pick<ReadRequest, 'mode'>) {
  return markdownFormat.read(content, { locale: 'pt-BR', ...request });
}

describe('markdown document model', () => {
  it('parses frontmatter, preamble, sections and keeps explicit anchors', () => {
    const doc = parseDocument(base);
    expect(doc.frontMatter).toEqual([{ key: 'cliente', value: 'Grupo Meridiano' }]);
    expect(doc.preamble).toEqual(['Introdução do documento.', '']);
    expect(doc.sections.map((s) => [s.anchor, s.level])).toEqual([
      ['escopo', 1],
      ['premissas', 2],
      ['cronograma', 1],
    ]);
    expect(doc.sections[0]!.explicit).toBe(true);
  });

  it('ignores headings inside fenced code blocks', () => {
    const doc = parseDocument('# Real\n\n```md\n# Não é título\n```\n');
    expect(doc.sections).toHaveLength(1);
  });

  it('suffixes repeated titles so anchors stay unique', () => {
    const doc = parseDocument('# Detalhes\n\n# Detalhes\n');
    expect(doc.sections.map((s) => s.anchor)).toEqual(['detalhes', 'detalhes-2']);
  });
});

describe('markdown operations', () => {
  it('replace_text changes one unique snippet inside a section', async () => {
    const result = await run(base, [
      { op: 'replace_text', section: 'escopo', find: 'palavra chave', replace: 'palavra-chave' },
    ]);
    expect(result.content).toContain('Texto do escopo com a palavra-chave.');
    expect(result.content).toContain('Entrega em 16 semanas.');
  });

  it('replace_text fails when the snippet is not unique in the section', async () => {
    await expect(
      run(base, [{ op: 'replace_text', section: 'escopo', find: 'Texto', replace: 'X' }]).then(() => 'ok'),
    ).resolves.toBe('ok');
    await expect(
      run(base, [{ op: 'replace_text', section: 'escopo', find: 'nada', replace: 'X' }]),
    ).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });

  it('replace_section keeps the heading and subsections', async () => {
    const result = await run(base, [{ op: 'replace_section', section: 'escopo', body: 'Novo corpo.' }]);
    expect(result.content).toContain('# Escopo {#escopo}\nNovo corpo.\n');
    expect(result.content).toContain('## Premissas');
  });

  it('insert_section adds a heading after another section with an automatic anchor', async () => {
    const result = await run(base, [
      { op: 'insert_section', after: 'cronograma', title: 'Riscos', level: 1, body: 'Atraso.' },
    ]);
    expect(result.createdRefs).toEqual(['riscos']);
    expect(parseDocument(result.content).sections.map((s) => s.anchor)).toEqual([
      'escopo',
      'premissas',
      'cronograma',
      'riscos',
    ]);
  });

  it('insert_section rejects an anchor that already exists', async () => {
    await expect(
      run(base, [{ op: 'insert_section', title: 'X', anchor: 'escopo', body: '' }]),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
  });

  it('remove_section removes the whole subtree', async () => {
    const result = await run(base, [{ op: 'remove_section', section: 'escopo' }]);
    expect(result.content).not.toContain('Premissas');
    expect(result.content).toContain('# Cronograma');
  });

  it('move_section moves a subtree after another section', async () => {
    const result = await run(base, [{ op: 'move_section', section: 'escopo', after: 'cronograma' }]);
    expect(parseDocument(result.content).sections.map((s) => s.anchor)).toEqual([
      'cronograma',
      'escopo',
      'premissas',
    ]);
  });

  it('move_section refuses to move a section after one of its own children', async () => {
    await expect(
      run(base, [{ op: 'move_section', section: 'escopo', after: 'premissas' }]),
    ).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });

  it('rename_section keeps an explicit anchor and changes an automatic one', async () => {
    const explicit = await run(base, [{ op: 'rename_section', section: 'escopo', title: 'Âmbito' }]);
    expect(parseDocument(explicit.content).sections[0]!.anchor).toBe('escopo');
    const automatic = await run(base, [{ op: 'rename_section', section: 'cronograma', title: 'Prazos' }]);
    expect(parseDocument(automatic.content).sections[2]!.anchor).toBe('prazos');
  });

  it('set_frontmatter sets and removes keys', async () => {
    const result = await run(base, [{ op: 'set_frontmatter', set: { versao: '2' }, remove: ['cliente'] }]);
    expect(result.content.startsWith('---\nversao: 2\n---\n')).toBe(true);
  });

  it('append adds markdown at the end of the document', async () => {
    const result = await run(base, [{ op: 'append', body: 'Fim.' }]);
    expect(result.content.trimEnd().endsWith('Fim.')).toBe(true);
  });

  it('a batch with several operations applies in order', async () => {
    const result = await run(base, [
      { op: 'insert_section', after: 'escopo', title: 'Entregáveis', level: 2, body: '- Relatório' },
      { op: 'replace_text', section: 'cronograma', find: '16 semanas', replace: '12 semanas' },
    ]);
    expect(result.createdRefs).toEqual(['entregaveis']);
    expect(result.content).toContain('12 semanas');
  });
});

describe('markdown reading', () => {
  it('outline lists anchors, levels and sizes', () => {
    const out = read(base, { mode: 'outline' });
    expect(out.text).toContain('[escopo]');
    expect(out.text).toContain('[premissas]');
    expect(out.text).toContain('Frontmatter:');
  });

  it('section mode returns the requested subtrees only', () => {
    const out = read(base, { mode: 'section', range: 'cronograma' });
    expect(out.text).toContain('Entrega em 16 semanas.');
    expect(out.text).not.toContain('Ambiente em nuvem');
  });

  it('full mode truncates on section boundaries with a cursor', () => {
    const out = read(base, { mode: 'full', maxTokens: 12 });
    expect(out.truncated).toBe(true);
    expect(out.cursor).toBeDefined();
  });
});

describe('markdown lint, diff and sanitization', () => {
  it('reports heading jumps, images without alt and broken anchors', () => {
    const codes = lintMarkdown('# A\n\n### Pulou\n\n![](asset://x)\n\n[link](#nada)\n').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['heading-jump', 'image-alt', 'broken-anchor']));
  });

  it('diff targets sections by anchor', () => {
    const changes = diffMarkdown(base, base.replace('Entrega em 16 semanas.', 'Entrega em 12 semanas.'));
    expect(changes).toEqual([expect.objectContaining({ type: 'changed', target: 'section:cronograma' })]);
  });

  it('removes raw HTML but keeps the pagebreak directive', () => {
    const result = stripRawHtml('<div>x</div>\n<!-- pagebreak -->\n<!-- nota -->\n');
    expect(result.text).toContain('<!-- pagebreak -->');
    expect(result.text).not.toContain('<div>');
    expect(result.text).not.toContain('nota');
  });

  it('rejects duplicated explicit anchors on validation', () => {
    expect(() => prepareContent(registry, 'markdown', '# A {#x}\n\n# B {#x}\n')).toThrow();
  });
});

defineFormatConformanceTests(
  markdownFormat,
  [
    {
      title: 'documento com frontmatter',
      content: base,
      batches: [
        [{ op: 'append', body: 'Anexo.' }],
        [{ op: 'replace_text', section: 'escopo', find: 'Texto', replace: 'Corpo' }],
      ],
      rejects: [
        { operations: [{ op: 'replace_section', section: 'nope', body: 'x' }], code: 'OPERATION_FAILED' },
      ],
    },
  ],
  { describe, it },
);
