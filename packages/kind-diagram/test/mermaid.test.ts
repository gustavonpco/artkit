import {
  ArtifactError,
  createArtifactService,
  createMemoryStore,
  createRegistry,
  prepareContent,
} from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { diagramKind, MermaidSyntaxError, mermaidToContent, parseMermaid } from '../src/index.js';

function syntaxError(source: string, locale?: string): MermaidSyntaxError {
  try {
    parseMermaid(source, locale ? { locale } : {});
  } catch (error) {
    if (error instanceof MermaidSyntaxError) return error;
    throw error;
  }
  throw new Error('expected a syntax error');
}

describe('parseMermaid', () => {
  it('parses shapes, links, labels, chains and fan-out', () => {
    const { content, notes } = parseMermaid(`flowchart LR
      %% a comment
      A[Box] --> B(Round)
      B -->|yes| C{Decide}
      C -- no --> D((Circle))
      D -.-> E[(Database)]
      E --- F
      F ==> G & H
      G <--> H
      A -. maybe .-> H
    `);
    expect(notes).toEqual(['Line 8: thick link drawn as solid.']);
    expect(content.direction).toBe('LR');
    expect(content.layout).toBe('auto');
    expect(content.nodes.map((node) => [node.id, node.shape, node.label])).toEqual([
      ['A', 'box', 'Box'],
      ['B', 'round', 'Round'],
      ['C', 'diamond', 'Decide'],
      ['D', 'ellipse', 'Circle'],
      ['E', 'cylinder', 'Database'],
      ['F', 'box', 'F'],
      ['G', 'box', 'G'],
      ['H', 'box', 'H'],
    ]);
    expect(
      content.edges.map((edge) => [edge.id, edge.from, edge.to, edge.label ?? '', edge.style, edge.arrow]),
    ).toEqual([
      ['e1', 'A', 'B', '', 'solid', 'end'],
      ['e2', 'B', 'C', 'yes', 'solid', 'end'],
      ['e3', 'C', 'D', 'no', 'solid', 'end'],
      ['e4', 'D', 'E', '', 'dashed', 'end'],
      ['e5', 'E', 'F', '', 'solid', 'none'],
      ['e6', 'F', 'G', '', 'solid', 'end'],
      ['e7', 'F', 'H', '', 'solid', 'end'],
      ['e8', 'G', 'H', '', 'solid', 'both'],
      ['e9', 'A', 'H', 'maybe', 'dashed', 'end'],
    ]);
  });

  it('chains with statements separated by semicolons and quoted labels', () => {
    const { content } = parseMermaid(
      'graph TD; a["Label with [brackets] and ; semicolon"] --> b --> c; c -->|"quoted | text"| a',
    );
    expect(content.nodes[0]!.label).toBe('Label with [brackets] and ; semicolon');
    expect(content.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['a>b', 'b>c', 'c>a']);
    expect(content.edges[2]!.label).toBe('quoted | text');
  });

  it('maps directions sensibly', () => {
    expect(parseMermaid('flowchart TD\nA-->B').content.direction).toBe('TB');
    expect(parseMermaid('graph').content.direction).toBe('TB');
    const bt = parseMermaid('flowchart BT\nA-->B');
    expect(bt.content.direction).toBe('TB');
    expect(bt.notes).toEqual(['Line 1: BT drawn as TB.']);
    expect(parseMermaid('flowchart RL\nA-->B').content.direction).toBe('LR');
  });

  it('turns layered subgraphs into ordered bands', () => {
    const { content } = parseMermaid(`flowchart TD
      subgraph data [Data]
        db[(DB)]
      end
      subgraph channels [Channels]
        web[Web] & app[App]
      end
      subgraph svc [Services]
        api(API)
      end
      web --> api
      app --> api
      api --> db
      user((User)) --> web`);
    expect(content.layout).toBe('bands');
    expect(content.groups).toEqual([
      { id: 'channels', label: 'Channels', kind: 'band' },
      { id: 'svc', label: 'Services', kind: 'band' },
      { id: 'data', label: 'Data', kind: 'band' },
    ]);
    expect(content.nodes.find((node) => node.id === 'api')!.group).toBe('svc');
    expect(content.nodes.find((node) => node.id === 'user')!.group).toBeUndefined();
  });

  it('keeps subgraphs as boxes when edges loop back or they are nested', () => {
    const cyclic = parseMermaid(`flowchart LR
      subgraph a [A]
        x
      end
      subgraph b [B]
        y
      end
      x --> y
      y --> x`);
    expect(cyclic.content.layout).toBe('auto');
    expect(cyclic.content.groups.map((group) => group.kind)).toEqual(['box', 'box']);
    const nested = parseMermaid(`flowchart TD
      subgraph outer [Outer]
        a
        subgraph inner [Inner]
          b
        end
      end
      a --> b`);
    expect(nested.content.groups.map((group) => group.kind)).toEqual(['box', 'box']);
    expect(nested.content.nodes.map((node) => node.group)).toEqual(['outer', 'inner']);
    expect(nested.notes[0]).toContain('nested subgraph "inner" flattened');
  });

  it('accepts subgraph title forms', () => {
    const { content } = parseMermaid(
      'flowchart TD\nsubgraph "Área de dados"\na\nend\nsubgraph two\nb\nend\nsubgraph Third One\nc\nend',
    );
    expect(content.groups.map((group) => [group.id, group.label])).toEqual([
      ['area-de-dados', 'Área de dados'],
      ['two', 'two'],
      ['third-one', 'Third One'],
    ]);
  });

  it('ignores styling statements with notes', () => {
    const { content, notes } = parseMermaid(`flowchart TD
      A:::hot --> B
      classDef hot fill:#f00
      style A fill:#f9f
      click A callback
      linkStyle 0 stroke:#f00
      A ~~~ B`);
    expect(content.edges).toHaveLength(1);
    expect(notes).toEqual([
      'Line 2: class "hot" ignored.',
      'Line 3: "classDef" ignored; colors and styles come from the theme and node tones.',
      'Line 4: "style" ignored; colors and styles come from the theme and node tones.',
      'Line 5: "click" ignored; colors and styles come from the theme and node tones.',
      'Line 6: "linkStyle" ignored; colors and styles come from the theme and node tones.',
      'Line 7: invisible link (~~~) ignored.',
    ]);
  });

  it('approximates other shapes and renames invalid ids', () => {
    const { content, notes } = parseMermaid(
      'flowchart TD\nA([Stadium]) --> B{{Hex}}\nB --> C>Flag]\n_x --> C',
    );
    expect(content.nodes.map((node) => node.shape)).toEqual(['round', 'box', 'box', 'box']);
    expect(content.nodes.map((node) => node.id)).toContain('x');
    expect(notes.some((note) => note.includes('hexagon'))).toBe(true);
  });

  it('reports errors with line numbers and hints', () => {
    expect(syntaxError('sequenceDiagram\nA->>B: hi').message).toBe(
      'Line 1: only flowchart diagrams are supported, found "sequenceDiagram".',
    );
    expect(syntaxError('hello').line).toBe(1);
    const unclosed = syntaxError('flowchart TD\nA --> B\nB --> C[Open');
    expect(unclosed.line).toBe(3);
    expect(unclosed.message).toContain('missing "]"');
    expect(unclosed.hint).toContain('C[Label]');
    expect(syntaxError('flowchart TD\nA --> ').message).toContain('link without a target');
    expect(syntaxError('flowchart TD\nA -- text B').message).toContain('link text is not closed');
    expect(syntaxError('flowchart TD\nA@{ shape: rect } --> B').hint).toContain('classic shapes');
    expect(syntaxError('flowchart TD\nsubgraph s\nA\n').message).toBe('Line 2: subgraph "s" is not closed.');
    expect(syntaxError('flowchart TD\nend').message).toContain('"end" without an open subgraph');
    expect(syntaxError(`flowchart TD\nA[${'x'.repeat(61)}]`).message).toContain('max 60');
    expect(syntaxError(`flowchart TD\nA -->|${'y'.repeat(41)}| B`).message).toContain('max 40');
    expect(syntaxError('flowchart TD\nsubgraph s\na\nend\na --> s').message).toContain(
      'edges to or from subgraphs',
    );
    expect(syntaxError('flowchart TD\nA <--- B').message).toContain('unsupported link');
  });

  it('localizes errors', () => {
    expect(syntaxError('flowchart TD\nA --> B[x', 'pt-BR').message).toBe(
      'Linha 2: falta "]" para fechar o rótulo do nó "B".',
    );
  });
});

describe('mermaid input', () => {
  it('produces valid content through the kind input', () => {
    const content = diagramKind.inputs!.mermaid!.toContent(
      'flowchart LR\nA[Start] --> B{Ok?}\nB -->|yes| C[(DB)]',
      { locale: 'en' },
    );
    const registry = createRegistry({ kinds: [diagramKind] });
    expect(prepareContent(registry, 'diagram', content).content).toEqual(content);
  });

  it('throws INVALID_CONTENT with line, hint and path', () => {
    try {
      mermaidToContent('flowchart TD\nA --> B\nC --> D[x', 'en');
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactError);
      const artifactError = error as ArtifactError;
      expect(artifactError.code).toBe('INVALID_CONTENT');
      expect(artifactError.details).toEqual({ line: 3 });
      expect(artifactError.issues[0]).toMatchObject({
        path: 'input.source',
        message: expect.stringContaining('Line 3'),
      });
      expect(artifactError.issues[0]!.hint).toBeTruthy();
    }
  });

  it('creates an artifact through the service', async () => {
    const service = createArtifactService({
      registry: createRegistry({ kinds: [diagramKind] }),
      store: createMemoryStore(),
    });
    const scope = { workspaceId: 'w', actor: { type: 'agent' as const, id: 'a' } };
    const result = await service.create(scope, {
      kind: 'diagram',
      title: 'Flow',
      input: { format: 'mermaid', source: 'flowchart TD\nA --> B' },
    });
    expect(result.artifact.content).toMatchObject({
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [{ from: 'A', to: 'B' }],
    });
  });
});
