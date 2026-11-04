import { type RenderSkillsOptions, renderSkills, type SkillFile } from '@artkit-ai/agent';
import { type AnyArtifactKind, type ArtifactRegistry, createRegistry } from '@artkit-ai/core';
import { diagramKind } from '@artkit-ai/kind-diagram';
import { documentKind } from '@artkit-ai/kind-document';
import { sheetKind } from '@artkit-ai/kind-sheet';
import { slidesKind } from '@artkit-ai/kind-slides';

export type { RenderSkillsOptions, SkillFile };

/** The skill folders shipped in this package (spec §14.7). */
export const SKILL_NAMES = ['artkit-artefatos', 'artkit-integracao'] as const;

/** The four phase-1 kinds, in the order the skills document them. */
export function nativeKinds(): AnyArtifactKind[] {
  return [documentKind, sheetKind, slidesKind, diagramKind];
}

/** Registry with the native kinds, used to generate the distributed skills. */
export function createSkillsRegistry(extraKinds: AnyArtifactKind[] = []): ArtifactRegistry {
  return createRegistry({ kinds: [...nativeKinds(), ...extraKinds] });
}

/**
 * Files of both skills generated from the registry. The technical parts (fields, operations, limits,
 * examples) always come from the kinds' schemas and instructions; authored prose lives in `@artkit-ai/agent`.
 * Apps with their own kinds or rules pass a registry and `extensions` instead of editing the base skill.
 */
export function artkitSkillFiles(
  options: RenderSkillsOptions & { registry?: ArtifactRegistry } = {},
): SkillFile[] {
  const { registry = createSkillsRegistry(), ...rest } = options;
  return renderSkills(registry, rest).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
