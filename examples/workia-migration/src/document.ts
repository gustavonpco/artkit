import type { CreateRequest } from '@artkit/core';
import type { WorkiaDocumento } from './types.js';

/**
 * documento → document. The front matter becomes the cover and the body goes through the kind's Markdown
 * input, so ids are generated deterministically. `{{campo:x}}` and `{{ref:x}}` placeholders stay literal:
 * resolving them belongs to the application that owns the referenced data.
 */
export function documentoRequest(source: WorkiaDocumento): CreateRequest {
  const { titulo, subtitulo, campos } = source.frontmatter;
  return {
    kind: 'document',
    title: titulo,
    input: {
      format: 'markdown',
      source: {
        markdown: source.body,
        cover: {
          title: titulo,
          ...(subtitulo ? { subtitle: subtitulo } : {}),
          ...(campos && Object.keys(campos).length > 0
            ? { fields: Object.entries(campos).map(([label, value]) => ({ label, value })) }
            : {}),
        },
      },
    },
  };
}
