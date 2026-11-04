import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOperations, prepareContent } from '@artkit/core';
import { describe, expect, it } from 'vitest';
import { artkitSkillFiles, createSkillsRegistry, nativeKinds, SKILL_NAMES } from '../src/index.js';

const files = artkitSkillFiles();
const byPath = new Map(files.map((file) => [file.path, file.content]));
const skillsDir = new URL('../skills', import.meta.url).pathname;

function frontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const field = /^([a-z-]+):\s*(.+)$/.exec(line);
    if (field) out[field[1]!] = JSON.parse(field[2]!);
  }
  return out;
}

describe('@artkit/skills', () => {
  it('generates both skills with Agent Skills frontmatter', () => {
    for (const name of SKILL_NAMES) {
      const skill = byPath.get(`${name}/SKILL.md`);
      expect(skill, name).toBeDefined();
      const meta = frontmatter(skill!);
      expect(meta.name).toBe(name);
      expect(meta.description?.length).toBeGreaterThan(40);
    }
  });

  it('has one reference per native kind plus themes and errors', () => {
    for (const kind of nativeKinds())
      expect(byPath.has(`artkit-artefatos/references/${kind.kind}.md`)).toBe(true);
    expect(byPath.has('artkit-artefatos/references/themes.md')).toBe(true);
    expect(byPath.has('artkit-artefatos/references/errors.md')).toBe(true);
  });

  it('documents every operation of every kind', () => {
    for (const kind of nativeKinds()) {
      const reference = byPath.get(`artkit-artefatos/references/${kind.kind}.md`)!;
      const ops = (kind.operationSchema as unknown as { options: { shape: { op: { value: string } } }[] })
        .options;
      for (const option of ops)
        expect(reference, `${kind.kind}.${option.shape.op.value}`).toContain(option.shape.op.value);
    }
  });

  it('ships only examples that validate against the current schemas (spec §14.7)', () => {
    const registry = createSkillsRegistry();
    const blocks = files.flatMap((file) =>
      [...file.content.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => ({
        path: file.path,
        json: match[1]!,
      })),
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(() => JSON.parse(block.json), block.path).not.toThrow();
    for (const kind of nativeKinds()) {
      for (const example of kind.instructions.examples) {
        const content =
          example.content === undefined
            ? kind.empty()
            : prepareContent(registry, kind.kind, example.content).content;
        if (example.operations) {
          applyOperations(
            registry,
            { kind: kind.kind, content, title: 'Example', themeId: 'default', locale: 'en' },
            example.operations,
          );
        }
      }
    }
  });

  it('keeps the distributed folder in sync with the generator', () => {
    if (!existsSync(skillsDir)) return;
    for (const file of files) {
      expect(readFileSync(join(skillsDir, file.path), 'utf8'), file.path).toBe(file.content);
    }
  });
});
