import type { ArtifactRegistry } from '@artkit-ai/core';
import { RUNTIME_WORKFLOW, SECURITY_RULE } from './skills.js';

export type InstructionDetail = 'compact' | 'full';

export interface InstructionOptions {
  detail?: InstructionDetail;
}

export interface InstructionContext {
  registry: ArtifactRegistry;
  formats: string[];
  locale: string;
}

/** System prompt block: which formats exist, when to use each, and the working loop (spec §16.1). */
export function renderInstructions(ctx: InstructionContext, options: InstructionOptions = {}): string {
  const full = options.detail === 'full';
  const lines = [
    'Artifacts: you create and edit documents, spreadsheets and visuals with the artifact tools.',
    'Formats:',
    ...ctx.formats.map((name) => {
      const adapter = ctx.registry.get(name);
      return `- ${name} (${adapter.label}): ${adapter.instructions.summary}`;
    }),
    ...RUNTIME_WORKFLOW.map((step) => `- ${step}`),
    SECURITY_RULE,
  ];
  if (full) {
    for (const name of ctx.formats) {
      for (const rule of ctx.registry.get(name).instructions.rules) lines.push(`  · ${name}: ${rule}`);
    }
  }
  return lines.join('\n');
}
