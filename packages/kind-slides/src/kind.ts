import { type ArtifactKind, defineKind } from '@artkit-ai/core';
import { diffSlides } from './diff.js';
import { outlineInput } from './inputs.js';
import { createInstructions } from './instructions.js';
import { createLayoutRegistry, type LayoutDefinition, type LayoutRegistry } from './layouts.js';
import { lintSlides } from './lint.js';
import {
  createApply,
  type SlidesOperation,
  slidesOperationSchema,
  slidesOperationTargets,
} from './operations.js';
import { normalizeSlides, parsePartialSlides } from './partial.js';
import { projectSlides } from './projection.js';
import { type SlidesContent, slidesContentSchema } from './schema.js';
import { validateSlides } from './validate.js';

/** Initial limits (spec §6.6), overridable per registry. */
export const SLIDES_LIMITS = { slides: 100, elementsPerSlide: 60 } as const;

export interface SlidesKindOptions {
  /** Application layouts (spec §20). A layout with a built-in name replaces the built-in. */
  layouts?: readonly LayoutDefinition[];
  /** Keep the built-in layouts (default true). */
  builtInLayouts?: boolean;
}

export type SlidesKind = ArtifactKind<SlidesContent, SlidesOperation> & {
  /** Layouts known to this kind; pass them to the renderer, editor and exporter. */
  readonly layouts: LayoutRegistry;
};

export function createSlidesKind(options: SlidesKindOptions = {}): SlidesKind {
  const layouts = createLayoutRegistry(options.layouts ?? [], options.builtInLayouts ?? true);
  const kind = defineKind<SlidesContent, SlidesOperation>({
    kind: 'slides',
    version: 1,
    label: 'Slides',
    contentSchema: slidesContentSchema,
    operationSchema: slidesOperationSchema,
    empty: () => ({ size: '16:9', slides: [] }),
    normalize: normalizeSlides,
    apply: createApply(layouts),
    ids: (content) =>
      content.slides.flatMap((slide) => [slide.id, ...slide.elements.map((element) => element.id)]),
    validate: (content) => validateSlides(content, layouts),
    measure: (content) => ({
      slides: content.slides.length,
      elementsPerSlide: content.slides.reduce((max, slide) => Math.max(max, slide.elements.length), 0),
    }),
    targets: slidesOperationTargets,
    project: (content, options) => projectSlides(content, options, layouts),
    lint: (content, ctx) => lintSlides(content, ctx, layouts),
    diff: (before, after, locale) => diffSlides(before, after, layouts, locale),
    parsePartial: (raw) => parsePartialSlides(raw, (name) => layouts.has(name)),
    inputs: { outline: outlineInput },
    migrations: [],
    limits: { ...SLIDES_LIMITS },
    instructions: createInstructions(layouts),
  });
  return Object.assign(kind, { layouts });
}

/** Ready instance with the built-in layouts. */
export const slidesKind: SlidesKind = createSlidesKind();
