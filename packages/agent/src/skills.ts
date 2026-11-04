import {
  type AnyArtifactKind,
  type ArtifactRegistry,
  COLOR_TOKENS,
  ERROR_CODES,
  type KindExample,
  slugify,
} from '@artkit/core';
import { ERROR_ACTIONS, MAX_RETRIES } from './guides/errors.js';
import { INTEGRATION_DESCRIPTION, integrationBody } from './guides/integration.js';
import { kindGuide } from './guides/kinds.js';
import {
  COMBINING_KINDS,
  GENERAL_RULES,
  KEY_ERROR_CODES,
  RECOVERY_INTRO,
  SECURITY_RULE,
  SKILL_DESCRIPTION,
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
import { renderOperation } from './schema-doc.js';

/** Library version range declared by the generated skills (spec §14.7). */
export const ARTKIT_VERSION = '0.1.0';

export const RUNTIME_SKILL = 'artkit-artefatos';
export const INTEGRATION_SKILL = 'artkit-integracao';

/** Reserved guide topics; every other topic is a kind name. */
export const OVERVIEW_TOPIC = 'overview';
export const THEMES_TOPIC = 'themes';
export const ERRORS_TOPIC = 'errors';

export interface SkillFile {
  /** Relative path, e.g. `artkit-artefatos/references/document.md`. */
  path: string;
  content: string;
}

export interface RenderSkillsOptions {
  /** Kinds to document (default: every registered kind). */
  kinds?: string[];
  /** Library version written to the skill metadata (default {@link ARTKIT_VERSION}). */
  libraryVersion?: string;
  /** Tool naming used in the text. `per-kind` mentions `artifact_apply_<kind>`. */
  applyMode?: 'union' | 'per-kind';
  /** Include the `artkit-integracao` developer skill (default true). */
  integration?: boolean;
  /**
   * Application overlays (spec §14.7): extra Markdown appended to generated files, keyed by relative path
   * (e.g. `artkit-artefatos/references/document.md`), so the base skill is never edited.
   */
  extensions?: Record<string, string>;
}

function frontmatter(fields: Record<string, string>, metadata: Record<string, string>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${JSON.stringify(value)}`);
  lines.push('metadata:');
  for (const [key, value] of Object.entries(metadata)) lines.push(`  ${key}: ${JSON.stringify(value)}`);
  lines.push('---', '');
  return lines.join('\n');
}

function schemaVersions(kinds: AnyArtifactKind[]): string {
  return kinds.map((kind) => `${kind.kind}@${kind.version}`).join(', ');
}

function exampleFile(kind: AnyArtifactKind, example: KindExample, index: number): SkillFile {
  const name = `${kind.kind}-${slugify(example.title) || String(index + 1)}`;
  const body: Record<string, unknown> = {
    kind: kind.kind,
    schemaVersion: kind.version,
    title: example.title,
  };
  if (example.input !== undefined) body.input = example.input;
  if (example.content !== undefined) body.content = example.content;
  if (example.operations !== undefined) body.operations = example.operations;
  return { path: `${RUNTIME_SKILL}/examples/${name}.json`, content: `${json(body)}\n` };
}

function runtimeSkill(kinds: AnyArtifactKind[], options: RenderSkillsOptions): string {
  const applyName = options.applyMode === 'per-kind' ? '`artifact_apply_<kind>`' : '`artifact_apply`';
  const lines: string[] = [
    frontmatter(
      { name: RUNTIME_SKILL, description: SKILL_DESCRIPTION },
      {
        'artkit-version': options.libraryVersion ?? ARTKIT_VERSION,
        'schema-versions': schemaVersions(kinds),
      },
    ),
    '# Working with artkit artifacts',
    '',
    SECURITY_RULE,
    '',
    '## Choosing the kind',
    '',
    '| Need | Kind | Reference |',
    '|---|---|---|',
    ...kinds.map((kind) => {
      const need = kindGuide(kind.kind).useWhen || kind.instructions.summary;
      return `| ${need.replace(/\|/g, '\\|')} | \`${kind.kind}\` | [references/${kind.kind}.md](references/${kind.kind}.md) |`;
    }),
    '',
    COMBINING_KINDS,
    '',
    '## Standard flow',
    '',
    ...WORKFLOW.map((step, index) => `${index + 1}. ${step.replace(/`artifact_apply`/g, applyName)}`),
    '',
    '## General rules',
    '',
    ...GENERAL_RULES.map((rule) => `- ${rule}`),
    '- Theme tokens are listed in [references/themes.md](references/themes.md).',
    '',
    '## Error recovery',
    '',
    RECOVERY_INTRO,
    '',
    ...KEY_ERROR_CODES.map((code) => `- \`${code}\`: ${ERROR_ACTIONS[code]}`),
    '',
    `Every code and its fix: [references/errors.md](references/errors.md). Stop after ${MAX_RETRIES} failed attempts and ask the user.`,
    '',
    '## References',
    '',
    `Open \`references/<kind>.md\` before working on a kind. Without file access, call \`artifact_guide\` with the topic (\`${kinds.map((kind) => kind.kind).join('`, `')}\`, \`${THEMES_TOPIC}\`, \`${ERRORS_TOPIC}\`).`,
    '',
  ];
  return lines.join('\n');
}

function kindReference(
  registry: ArtifactRegistry,
  kind: AnyArtifactKind,
  options: RenderSkillsOptions,
): string {
  const facts = kindFacts(registry, kind);
  const guide = kindGuide(kind.kind);
  const applyName = options.applyMode === 'per-kind' ? applyToolName(kind.kind) : 'artifact_apply';
  const out: string[] = [
    `# ${kind.label} (\`${kind.kind}\`)`,
    '',
    `Schema version ${kind.version}. Edit with \`${applyName}\`.`,
    '',
  ];
  out.push('## Summary', '', kind.instructions.summary, '');
  if (guide.useWhen) out.push('## When to use', '', guide.useWhen, '');
  if (kind.instructions.rules.length > 0)
    out.push('## Rules', '', ...kind.instructions.rules.map((rule) => `- ${rule}`), '');
  out.push('## Content fields', '', ...contentFields(kind), '');
  if (facts.inputs.length > 0) {
    out.push(
      '## Alternative inputs',
      '',
      'Pass `input: { format, source }` to `artifact_create` instead of `content`.',
      '',
    );
    out.push(...facts.inputs.map((input) => `- \`${input.format}\`: ${input.description}`), '');
  }
  out.push('## Operations', '');
  for (const doc of operationDocs(kind)) out.push(renderOperation(doc), '');
  out.push('### Envelope operations (every kind)', '');
  for (const doc of envelopeDocs()) out.push(renderOperation(doc, '####'), '');
  out.push('## Limits', '', '| Counter | Maximum |', '|---|---|');
  for (const [name, max] of Object.entries(facts.limits)) out.push(`| \`${name}\` | ${max} |`);
  out.push(`| operations per call | ${registry.batch.maxOperations} |`);
  out.push(`| serialized artifact | ${Math.round(registry.batch.maxEnvelopeBytes / 1024)} KB |`, '');
  if (kind.instructions.examples.length > 0) {
    out.push('## Examples', '');
    for (const example of kind.instructions.examples) {
      out.push(`### ${example.title}`, '');
      if (example.input !== undefined)
        out.push(
          `Input (\`${example.input.format}\`):`,
          '',
          '```',
          typeof example.input.source === 'string' ? example.input.source : json(example.input.source),
          '```',
          '',
        );
      if (example.content !== undefined)
        out.push('Content:', '', '```json', json(example.content), '```', '');
      if (example.operations !== undefined)
        out.push('Operations:', '', '```json', json(example.operations), '```', '');
    }
  }
  out.push('## Checklist', '', ...guide.checklist.map((item) => `- [ ] ${item}`), '');
  out.push('## Anti-patterns', '', ...guide.antiPatterns.map((item) => `- ${item}`), '');
  return out.join('\n');
}

function themesReference(registry: ArtifactRegistry): string {
  const themes = registry.themes();
  const out: string[] = [
    '# Theme tokens',
    '',
    'Colors are written as tokens so artifacts follow the theme (light, dark, brand). Use a hex value ("#RRGGBB") only when the user asks for a specific color.',
    '',
    `| Token | ${themes.map((theme) => `${theme.label ?? theme.id} (\`${theme.id}\`)`).join(' | ')} |`,
    `|---|${themes.map(() => '---').join('|')}|`,
  ];
  for (const token of COLOR_TOKENS)
    out.push(`| \`${token}\` | ${themes.map((theme) => theme.colors[token]).join(' | ')} |`);
  out.push('', '## Typography', '', '| Theme | Heading | Body | Mono |', '|---|---|---|---|');
  for (const theme of themes)
    out.push(`| \`${theme.id}\` | ${theme.fonts.heading} | ${theme.fonts.body} | ${theme.fonts.mono} |`);
  out.push('', '## Chart palette', '');
  for (const theme of themes) out.push(`- \`${theme.id}\`: ${theme.chartPalette.join(', ')}`);
  out.push(
    '',
    'Change the theme of an artifact with the `set_theme` envelope operation and a theme id from this table.',
    '',
  );
  return out.join('\n');
}

function errorsReference(): string {
  const out: string[] = [
    '# Errors',
    '',
    'Every tool returns errors as data instead of failing:',
    '',
    '```json',
    json({
      ok: false,
      error: {
        code: 'INVALID_OPERATION',
        message: 'Operation 2 is invalid.',
        issues: [
          {
            path: 'operations[2].text',
            message: 'Expected string.',
            hint: 'Provide a value of type string.',
          },
        ],
      },
    }),
    '```',
    '',
    RECOVERY_INTRO,
    '',
    '| Code | What to do |',
    '|---|---|',
  ];
  for (const code of ERROR_CODES) out.push(`| \`${code}\` | ${ERROR_ACTIONS[code]} |`);
  out.push(
    '',
    'Lint warnings are not errors: the change was saved. Fix the ones that matter and continue.',
    '',
  );
  return out.join('\n');
}

/**
 * Generates the two Agent Skills folders of spec §14.7. Technical parts (fields, operations, limits,
 * examples) come from the registry; prose comes from the versioned guides in this package.
 */
export function renderSkills(registry: ArtifactRegistry, options: RenderSkillsOptions = {}): SkillFile[] {
  const kinds = selectKinds(registry, options.kinds);
  const files: SkillFile[] = [
    { path: `${RUNTIME_SKILL}/SKILL.md`, content: runtimeSkill(kinds, options) },
    ...kinds.map((kind) => ({
      path: `${RUNTIME_SKILL}/references/${kind.kind}.md`,
      content: kindReference(registry, kind, options),
    })),
    { path: `${RUNTIME_SKILL}/references/themes.md`, content: themesReference(registry) },
    { path: `${RUNTIME_SKILL}/references/errors.md`, content: errorsReference() },
    ...kinds.flatMap((kind) =>
      kind.instructions.examples
        .filter((example) => example.content !== undefined)
        .map((example, index) => exampleFile(kind, example, index)),
    ),
  ];
  if (options.integration !== false) {
    const meta = frontmatter(
      { name: INTEGRATION_SKILL, description: INTEGRATION_DESCRIPTION },
      {
        'artkit-version': options.libraryVersion ?? ARTKIT_VERSION,
        'schema-versions': schemaVersions(kinds),
      },
    );
    files.push({
      path: `${INTEGRATION_SKILL}/SKILL.md`,
      content: `${meta}\n${integrationBody(kinds.map((kind) => kind.kind))}`,
    });
  }
  const extensions = options.extensions ?? {};
  return files.map((file) => {
    const extra = extensions[file.path];
    return extra ? { path: file.path, content: `${file.content.trimEnd()}\n\n${extra.trim()}\n` } : file;
  });
}

/** Guide topics served by `artifact_guide`, MCP prompts and `artkit://guide/{topic}` resources. */
export function guideTopics(registry: ArtifactRegistry, kinds?: string[]): string[] {
  const names = selectKinds(registry, kinds)
    .map((kind) => kind.kind)
    .filter((name) => name !== OVERVIEW_TOPIC && name !== THEMES_TOPIC && name !== ERRORS_TOPIC);
  return [OVERVIEW_TOPIC, ...names, THEMES_TOPIC, ERRORS_TOPIC];
}

/** Maps a topic to its skill file path. */
export function guidePath(topic: string): string {
  if (topic === OVERVIEW_TOPIC) return `${RUNTIME_SKILL}/SKILL.md`;
  return `${RUNTIME_SKILL}/references/${topic}.md`;
}

/** Drops YAML frontmatter: harness tools return the body only. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  return end < 0 ? content : content.slice(end + 5).trimStart();
}
