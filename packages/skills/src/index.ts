import { type RenderSkillsOptions, renderSkills, type SkillFile } from '@artkit-ai/agent';
import { type AnyFormatAdapter, type ArtifactRegistry, createRegistry } from '@artkit-ai/core';
import { markdownFormat } from '@artkit-ai/format-markdown';
import { openuiFormat } from '@artkit-ai/format-openui';
import { createSheetFormat, type SheetEngine } from '@artkit-ai/format-sheet';

export type { RenderSkillsOptions, SkillFile };

/** The skill folders shipped in this package (spec §16). */
export const SKILL_NAMES = ['artkit-artefatos', 'artkit-integracao'] as const;

/**
 * The phase-1 formats, in the order the skills document them. The sheet format is built with an engine that is never
 * called: skills only read its instructions, limits and schemas, so generation does not start Univer.
 */
export function nativeFormats(): AnyFormatAdapter[] {
  const instructionsOnly: SheetEngine = {
    async execute() {
      throw new Error('The skills generator does not execute operations.');
    },
  };
  return [markdownFormat, createSheetFormat(instructionsOnly), openuiFormat];
}

/** Registry with the native formats, used to generate the distributed skills. */
export function createSkillsRegistry(extraFormats: AnyFormatAdapter[] = []): ArtifactRegistry {
  return createRegistry({ formats: [...nativeFormats(), ...extraFormats] });
}

/**
 * Files of both skills generated from the registry. The technical parts (operations, limits, examples) come from the
 * adapters and their instructions; authored prose lives in `@artkit-ai/agent`. Apps with their own formats pass a
 * registry instead of editing the base skill.
 */
export function artkitSkillFiles(
  options: RenderSkillsOptions & { registry?: ArtifactRegistry } = {},
): SkillFile[] {
  const { registry = createSkillsRegistry(), ...rest } = options;
  return renderSkills(registry, rest).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
