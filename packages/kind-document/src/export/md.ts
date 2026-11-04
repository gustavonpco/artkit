import { type ArtifactExporter, toDataUrl } from '@artkit-ai/core';
import { contentToMarkdown } from '../markdown/serialize.js';
import type { DocumentContent } from '../schema.js';
import { resolveImages } from './html.js';

/**
 * GFM Markdown. The cover and page setup become front matter; what GFM cannot express (table caption and
 * footer, alignment, widths, toc, page breaks) is kept in `<!-- ak:… -->` comments so the file converts
 * back without loss. Options: `images: 'embed'` inlines images as data URLs (default keeps `asset://`
 * references); `metadata: false` omits the comments.
 */
export const documentMarkdownExporter: ArtifactExporter<DocumentContent> = {
  kind: 'document',
  format: 'md',
  mimeType: 'text/markdown; charset=utf-8',
  extension: 'md',
  runtime: 'any',
  async export(content, ctx) {
    let blocks = content.blocks;
    const hasImages = blocks.some((block) => block.type === 'image');
    if (hasImages && ctx.options?.images === 'embed') {
      const resolved = await resolveImages(content, ctx);
      // Embedded images leave the asset:// form, so they are written as plain Markdown images.
      blocks = blocks.map((block) => {
        const asset = block.type === 'image' ? resolved.get(block.asset) : undefined;
        return asset && block.type === 'image'
          ? { ...block, asset: toDataUrl(asset.bytes, asset.mimeType) }
          : block;
      });
    } else if (hasImages) {
      ctx.warn('Images are written as asset:// references; pass options.images = "embed" to inline them.');
    }
    if (content.blocks.some((block) => block.type === 'toc'))
      ctx.warn('The table of contents is written as a <!-- ak:toc --> marker.');
    const markdown = contentToMarkdown({ ...content, blocks }, { metadata: ctx.options?.metadata !== false });
    return new TextEncoder().encode(markdown);
  },
};
