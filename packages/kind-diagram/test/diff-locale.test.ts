import { describe, expect, it } from 'vitest';
import { diagramKind } from '../src/index.js';

describe('diagram diff locale', () => {
  it('writes summaries in Portuguese when asked', () => {
    const base = { direction: 'TB', layout: 'auto', groups: [], edges: [] };
    const before = { ...base, nodes: [{ id: 'api', label: 'API', shape: 'box' }] };
    const after = { ...base, direction: 'LR', nodes: [{ id: 'api', label: 'Gateway', shape: 'box' }] };
    const pt = diagramKind.diff(before as never, after as never, 'pt-BR').map((c) => c.summary);
    expect(pt).toEqual(["direction: 'TB' para 'LR'.", "api: label 'API' para 'Gateway'."]);
  });
});
