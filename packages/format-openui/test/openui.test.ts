// @vitest-environment node

import { applyOperations, createRegistry, prepareContent } from '@artkit-ai/core';
import { defineFormatConformanceTests } from '@artkit-ai/core/testing';
import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  lintOpenUI,
  openuiFormat,
  parseStatements,
  removeReferences,
  renameReferences,
  validateOpenUI,
} from '../src/index.js';

const registry = createRegistry({ formats: [openuiFormat] });

const deck = `root = Deck([capa, escopo])
capa = Slide("title", [Title("Portal de Fornecedores"), Subtitle("Grupo Meridiano")])
escopo = Slide("title-content", [Title("Escopo em 13 módulos"), Bullets(["Cadastro e homologação", "Integração Protheus"])])
`;

function run(content: string, operations: unknown[]) {
  return applyOperations(
    registry,
    { format: 'openui', content, title: 'Deck', themeId: 'default', locale: 'pt-BR' },
    operations,
  );
}

describe('openui validation', () => {
  it('accepts a visual built from the library', () => {
    const result = validateOpenUI(deck);
    expect(result.ok).toBe(true);
  });

  it('rejects components that are not in the library', () => {
    const result = validateOpenUI(deck.replace('Title("Portal', 'Marquee("Portal'));
    expect(result.ok).toBe(false);
  });

  it('requires a root that is a visual', () => {
    expect(validateOpenUI('capa = Title("x")\n').ok).toBe(false);
    expect(validateOpenUI('root = Title("x")\n').ok).toBe(false);
  });

  it('rejects references that are never declared', () => {
    expect(validateOpenUI('root = Deck([fantasma])\n').ok).toBe(false);
  });

  it('rejects cycles', () => {
    expect(validateOpenUI('root = Deck([a])\na = Slide("title", [a])\n').ok).toBe(false);
  });
});

describe('openui operations', () => {
  it('sets a declaration keeping its position and appends new ones', async () => {
    const result = await run(deck, [
      { op: 'set_statement', name: 'capa', expr: 'Slide("title", [Title("Novo título")])' },
      { op: 'set_statement', name: 'fim', expr: 'Slide("quote", [Quote("Obrigado")])' },
    ]);
    const names = parseStatements(result.content).statements.map((s) => s.name);
    expect(names).toEqual(['root', 'capa', 'escopo', 'fim']);
    expect(result.createdRefs).toEqual(['fim']);
  });

  it('insert_child adds a reference after another child', async () => {
    const result = await run(deck, [
      { op: 'set_statement', name: 'meio', expr: 'Slide("section", [Title("Meio")])' },
      { op: 'insert_child', name: 'root', child: 'meio', after: 'capa' },
    ]);
    expect(childrenOf(parseStatements(result.content).statements[0]!.expr)).toEqual([
      'capa',
      'meio',
      'escopo',
    ]);
  });

  it('move_child reorders the children of a declaration', async () => {
    const result = await run(deck, [{ op: 'move_child', name: 'root', child: 'escopo', position: 0 }]);
    expect(childrenOf(parseStatements(result.content).statements[0]!.expr)).toEqual(['escopo', 'capa']);
  });

  it('remove_statement refuses a referenced declaration without cascade', async () => {
    await expect(run(deck, [{ op: 'remove_statement', name: 'capa' }])).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });

  it('remove_statement with cascade also removes the references', async () => {
    const result = await run(deck, [{ op: 'remove_statement', name: 'capa', cascade: true }]);
    expect(result.content).not.toContain('capa');
    expect(childrenOf(parseStatements(result.content).statements[0]!.expr)).toEqual(['escopo']);
  });

  it('rename_statement updates every reference', async () => {
    const result = await run(deck, [{ op: 'rename_statement', name: 'capa', to: 'abertura' }]);
    expect(result.content).toContain('root = Deck([abertura, escopo])');
    expect(result.content).toContain('abertura = Slide');
  });

  it('insert_child fails on a declaration without a child list', async () => {
    await expect(
      run(deck, [
        { op: 'set_statement', name: 'logo', expr: 'Image("asset://logo", "Logotipo")' },
        { op: 'insert_child', name: 'logo', child: 'escopo' },
      ]),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
  });
});

describe('openui helpers, reading and lint', () => {
  it('splits children without changing their text', () => {
    expect(childrenOf('Slide("title", [Title("a, b"), capa])')).toEqual(['Title("a, b")', 'capa']);
  });

  it('removes and renames references in expressions', () => {
    expect(removeReferences('Deck([a, b])', 'a')).toBe('Deck([b])');
    expect(renameReferences('Deck([a, b])', 'a', 'z')).toBe('Deck([z, b])');
  });

  it('outline lists the root first with its children', () => {
    const content = prepareContent(registry, 'openui', deck).content as string;
    const outline = openuiFormat.read(content, { mode: 'outline', locale: 'pt-BR' });
    expect(outline.text.split('\n')[1]).toContain('root');
  });

  it('lint reports slides without title, long bullet lists and unused declarations', () => {
    const text = `root = Deck([a])
a = Slide("title-content", [Bullets(["1","2","3","4","5","6","7"])])
x = Text("sobra")
`;
    const codes = lintOpenUI(text).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['bullets-overflow', 'unused-declaration']));
  });

  it('diff targets declarations by name', () => {
    const changes = openuiFormat.diff(deck, deck.replace('Grupo Meridiano', 'Grupo X'));
    expect(changes).toEqual([expect.objectContaining({ type: 'changed', target: 'node:capa' })]);
  });
});

defineFormatConformanceTests(
  openuiFormat,
  [
    {
      title: 'deck de dois slides',
      content: deck,
      batches: [
        [{ op: 'move_child', name: 'root', child: 'escopo', position: 0 }],
        [{ op: 'rename_statement', name: 'capa', to: 'abertura' }],
      ],
      rejects: [
        { operations: [{ op: 'set_statement', name: 'x', expr: 'Marquee("x")' }], code: 'OPERATION_FAILED' },
      ],
    },
  ],
  { describe, it },
);
