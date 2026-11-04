import {
  type ArtifactRegistry,
  type ArtifactService,
  type CommitResult,
  createRegistry,
  type Scope,
} from '@artkit/core';
import { diagramKind } from '@artkit/kind-diagram';
import { documentKind } from '@artkit/kind-document';
import { sheetKind } from '@artkit/kind-sheet';
import { createSlidesKind } from '@artkit/kind-slides';
import { documentoRequest } from './document.js';
import { cronogramaPlan, planilhaPlan, type SheetPlan } from './sheet.js';
import { deckRequest, workiaLayouts } from './slides.js';
import type { WorkiaArtifact } from './types.js';

export { documentoRequest } from './document.js';
export { cronogramaPlan, planilhaPlan, type SheetPlan, scheduleCronograma } from './sheet.js';
export { convertSlide, deckRequest, markdownParagraphs, workiaLayouts } from './slides.js';
export type * from './types.js';

/** Slides kind with Workia's layouts registered next to the built-ins. */
export const workiaSlidesKind = createSlidesKind({ layouts: workiaLayouts });

/** Registry an application migrating from Workia uses: the four kinds, slides with Workia's layouts. */
export function createWorkiaRegistry(): ArtifactRegistry {
  return createRegistry({ kinds: [documentKind, sheetKind, workiaSlidesKind, diagramKind] });
}

export type WorkiaKind = 'documento' | 'planilha' | 'deck' | 'cronograma';

export function workiaKindOf(source: WorkiaArtifact): WorkiaKind {
  if ('frontmatter' in source) return 'documento';
  return source.tipo;
}

/** Create request plus follow-up operations for one Workia artifact. */
export function migrationPlan(
  source: WorkiaArtifact,
  options: { assets?: Record<string, string> } = {},
): SheetPlan {
  switch (workiaKindOf(source)) {
    case 'documento':
      return { request: documentoRequest(source as never), operations: [] };
    case 'planilha':
      return planilhaPlan(source as never);
    case 'cronograma':
      return cronogramaPlan(source as never);
    case 'deck':
      return { request: deckRequest(source as never, options.assets), operations: [] };
  }
}

/**
 * Imports a Workia artifact through the artkit pipeline: validated creation, then the follow-up batch
 * (formulas filled with fill_range, notes). Both steps are versioned, so the history shows the import.
 */
export async function importWorkiaArtifact(
  service: ArtifactService,
  scope: Scope,
  source: WorkiaArtifact,
  options: { assets?: Record<string, string>; locale?: string } = {},
): Promise<CommitResult> {
  const plan = migrationPlan(source, options);
  const created = await service.create(scope, {
    ...plan.request,
    locale: options.locale ?? 'pt-BR',
    tags: ['workia-import'],
    message: `Imported from Workia (${workiaKindOf(source)})`,
  });
  if (plan.operations.length === 0) return created;
  return service.apply(scope, {
    artifactId: created.artifact.id,
    baseVersion: created.version,
    operations: plan.operations,
    message: 'Workia import: formulas and notes',
  });
}
