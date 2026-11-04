import { describe, expect, it } from 'vitest';
import { documentKind } from '../src/index.js';

describe('document diff locale', () => {
  it('writes summaries in Portuguese when asked', () => {
    const before = { blocks: [{ id: 'p1', type: 'paragraph', runs: [{ text: 'centraliza' }] }] };
    const after = {
      blocks: [
        { id: 'p1', type: 'paragraph', runs: [{ text: 'unifica' }] },
        { id: 'p2', type: 'paragraph', runs: [{ text: 'novo' }] },
      ],
    };
    const pt = documentKind.diff(before as never, after as never, 'pt-BR').map((c) => c.summary);
    expect(pt).toEqual(["Parágrafo: 'centraliza' para 'unifica'.", "Inserido: Parágrafo 'novo' após 'p1'."]);
    const en = documentKind.diff(before as never, after as never).map((c) => c.summary);
    expect(en[0]).toBe("Paragraph: 'centraliza' to 'unifica'.");
  });
});
