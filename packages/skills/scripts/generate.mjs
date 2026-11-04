#!/usr/bin/env node
// Writes the generated skills to packages/skills/skills (shipped in the npm package and installable by
// copying the folder). With --check, fails when the folder is out of date with the kind schemas.
// Requires a build first (it imports dist/).
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { artkitSkillFiles } from '../dist/index.js';

const check = process.argv.includes('--check');
const outDir = new URL('../skills', import.meta.url).pathname;
const files = artkitSkillFiles();

function listFiles(dir) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(relative(outDir, full));
  }
  return out;
}

if (check) {
  const expected = new Map(files.map((file) => [file.path, file.content]));
  const problems = [];
  for (const path of listFiles(outDir)) {
    if (!expected.has(path)) problems.push(`unexpected file ${path}`);
  }
  for (const [path, content] of expected) {
    let current;
    try {
      current = readFileSync(join(outDir, path), 'utf8');
    } catch {
      problems.push(`missing ${path}`);
      continue;
    }
    if (current !== content) problems.push(`outdated ${path}`);
  }
  if (problems.length > 0) {
    console.error(
      `Skills are out of date (run pnpm skills:generate):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`Skills up to date (${files.length} files).`);
} else {
  rmSync(outDir, { recursive: true, force: true });
  for (const file of files) {
    const target = join(outDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  console.log(`Wrote ${files.length} skill files to ${relative(process.cwd(), outDir)}.`);
}
