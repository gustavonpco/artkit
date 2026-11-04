import { type ArtifactRegistry, COLOR_TOKENS, ERROR_CODES } from '@artkit-ai/core';
import { ERROR_ACTIONS } from './guides/errors.js';
import { kindGuide } from './guides/kinds.js';
import {
  GENERAL_RULES,
  INTRO,
  KEY_ERROR_CODES,
  RECOVERY_INTRO,
  SECURITY_RULE,
  WORKFLOW,
} from './guides/runtime.js';
import {
  applyToolName,
  contentFields,
  envelopeDocs,
  json,
  kindFacts,
  operationDocs,
  selectKinds,
} from './kind-doc.js';

export type InstructionDetail = 'compact' | 'full';

export interface InstructionOptions {
  /** Kinds to describe (default: every registered kind). */
  kinds?: string[];
  /** `compact` (default) keeps the system prompt small; `full` adds fields, operation fields and all examples. */
  detail?: InstructionDetail;
}

export interface InstructionContext {
  registry: ArtifactRegistry;
  applyMode: 'union' | 'per-kind';
  guideTopics: string[];
  hasExport: boolean;
}

/** Builds the system block from each kind's `KindInstructions` and schemas (spec §14.3). */
export function renderInstructions(ctx: InstructionContext, options: InstructionOptions = {}): string {
  const detail = options.detail ?? 'compact';
  const kinds = selectKinds(ctx.registry, options.kinds);
  const applyName = (kind: string) => (ctx.applyMode === 'per-kind' ? applyToolName(kind) : 'artifact_apply');
  const out: string[] = [
    '# Artifacts',
    '',
    INTRO,
    '',
    '## Security',
    '',
    SECURITY_RULE,
    '',
    '## Workflow',
    '',
  ];
  WORKFLOW.forEach((step, index) => {
    let text = step;
    if (ctx.applyMode === 'per-kind') text = text.replace(/`artifact_apply`/g, '`artifact_apply_<kind>`');
    if (!ctx.hasExport) text = text.replace('export it (`artifact_export`) or ', '');
    out.push(`${index + 1}. ${text}`);
  });
  out.push('', '## Rules', '', ...GENERAL_RULES.map((rule) => `- ${rule}`));
  out.push(`- Theme color tokens: ${COLOR_TOKENS.map((token) => `\`${token}\``).join(', ')}.`);
  out.push(`- At most ${ctx.registry.batch.maxOperations} operations per call.`);
  if (ctx.guideTopics.length > 0) {
    out.push(
      `- For detailed references call \`artifact_guide\` with a topic: ${ctx.guideTopics.map((topic) => `\`${topic}\``).join(', ')}.`,
    );
  }
  out.push('', '## Error recovery', '', RECOVERY_INTRO, '');
  const codes = detail === 'full' ? ERROR_CODES : KEY_ERROR_CODES;
  for (const code of codes) out.push(`- \`${code}\`: ${ERROR_ACTIONS[code]}`);

  out.push('', '## Kinds');
  for (const kind of kinds) {
    const facts = kindFacts(ctx.registry, kind);
    const guide = kindGuide(kind.kind);
    out.push('', `### \`${kind.kind}\` (${kind.label})`, '', kind.instructions.summary);
    if (guide.useWhen) out.push(`Use for: ${guide.useWhen}`);
    if (kind.instructions.rules.length > 0)
      out.push('', 'Rules:', ...kind.instructions.rules.map((rule) => `- ${rule}`));
    if (facts.inputs.length > 0) {
      out.push(
        '',
        `Alternative inputs for \`artifact_create\`: ${facts.inputs.map((input) => `\`${input.format}\` (${input.description})`).join('; ')}.`,
      );
    }
    out.push(
      '',
      `Operations (\`${applyName(kind.kind)}\`): ${facts.operations.map((op) => `\`${op}\``).join(', ')}; envelope: \`set_title\`, \`set_theme\`, \`set_locale\`, \`replace_content\`.`,
    );
    const limits = Object.entries(facts.limits);
    if (limits.length > 0) out.push(`Limits: ${limits.map(([name, max]) => `${name} ≤ ${max}`).join(', ')}.`);
    if (detail === 'full') {
      out.push('', 'Content fields:', ...contentFields(kind));
      out.push('', 'Operation fields:');
      for (const doc of operationDocs(kind)) {
        out.push(
          `- \`${doc.op}\`${doc.description ? `: ${doc.description}` : ''}`,
          ...doc.fields.map((line) => `  ${line}`),
        );
      }
    }
    const examples = detail === 'full' ? kind.instructions.examples : kind.instructions.examples.slice(0, 1);
    for (const example of examples) {
      out.push('', `Example: ${example.title}`);
      if (example.input !== undefined) out.push(`input: ${json(example.input, false)}`);
      if (example.content !== undefined) out.push(`content: ${json(example.content, false)}`);
      if (example.operations !== undefined) out.push(`operations: ${json(example.operations, false)}`);
    }
  }
  if (detail === 'full') {
    out.push('', '## Envelope operations (every kind)', '');
    for (const doc of envelopeDocs())
      out.push(
        `- \`${doc.op}\`${doc.description ? `: ${doc.description}` : ''}`,
        ...doc.fields.map((line) => `  ${line}`),
      );
  }
  return out.join('\n');
}
