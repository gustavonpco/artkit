// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOperations, createRegistry, prepareContent } from '@artkit-ai/core';
import { createSheetFormat, emptyWorkbook } from '@artkit-ai/format-sheet';
import { createUniverEngine } from '@artkit-ai/format-sheet/server';
import { describe, expect, it } from 'vitest';
import { artkitSkillFiles, createSkillsRegistry, nativeFormats, SKILL_NAMES } from '../src/index.js';

const files = artkitSkillFiles();
const byPath = new Map(files.map((file) => [file.path, file.content]));
const skillsDir = new URL('../skills', import.meta.url).pathname;

function frontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const field = /^([a-z-]+):\s*(.+)$/.exec(line);
    if (field) out[field[1]!] = field[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

describe('@artkit-ai/skills', () => {
  it('generates both skills with Agent Skills frontmatter', () => {
    for (const name of SKILL_NAMES) {
      const skill = byPath.get(`${name}/SKILL.md`);
      expect(skill, name).toBeDefined();
      const meta = frontmatter(skill!);
      expect(meta.name).toBe(name);
      expect(meta.description!.length).toBeGreaterThan(40);
    }
  });

  it('documents every native format with a reference file', () => {
    for (const format of nativeFormats().map((adapter) => adapter.format)) {
      expect(byPath.has(`artkit-artefatos/references/${format}.md`), format).toBe(true);
    }
    expect(byPath.has('artkit-artefatos/references/erros.md')).toBe(true);
  });

  it('every instruction example of the markdown and OpenUI formats applies on the adapter', async () => {
    const registry = createSkillsRegistry();
    for (const format of ['markdown', 'openui']) {
      const adapter = registry.get(format);
      for (const example of adapter.instructions.examples) {
        const base =
          example.content === undefined
            ? adapter.empty()
            : prepareContent(registry, format, example.content).content;
        if (example.operations) {
          await applyOperations(
            registry,
            { format, content: base, title: 'Example', themeId: 'default', locale: 'en' },
            example.operations,
          );
        }
      }
    }
  });

  it('every instruction example of the sheet format runs on Univer headless', async () => {
    const sheet = createSheetFormat(createUniverEngine());
    const registry = createRegistry({ formats: [sheet] });
    for (const example of sheet.instructions.examples) {
      await applyOperations(
        registry,
        {
          format: 'univer-sheet',
          content: emptyWorkbook('wb', 'Planilha', 'pt-BR'),
          title: 'Example',
          themeId: 'default',
          locale: 'pt-BR',
        },
        example.operations ?? [],
      );
    }
  });

  it('the committed skills folder matches the generated files when present', () => {
    if (!existsSync(skillsDir)) return;
    for (const [path, content] of byPath) {
      expect(readFileSync(join(skillsDir, path), 'utf8'), path).toBe(content);
    }
  });
});
