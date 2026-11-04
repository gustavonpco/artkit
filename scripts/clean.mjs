#!/usr/bin/env node
// Removes build outputs (dist/ and *.tsbuildinfo) from every package.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
for (const group of ['packages', 'examples']) {
  let entries = [];
  try {
    entries = readdirSync(join(root, group));
  } catch {
    continue;
  }
  for (const name of entries) {
    const dir = join(root, group, name);
    if (!statSync(dir).isDirectory()) continue;
    rmSync(join(dir, 'dist'), { recursive: true, force: true });
    for (const file of readdirSync(dir))
      if (file.endsWith('.tsbuildinfo')) rmSync(join(dir, file), { force: true });
  }
}
console.log('Cleaned build outputs.');
