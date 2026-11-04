#!/usr/bin/env node
// Checks that every publishable package is ready for npm: metadata, exports pointing to built files,
// README and LICENSE presence. With --release, placeholders (TODO-OWNER) and missing builds are errors.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const release = process.argv.includes('--release');
const root = new URL('..', import.meta.url).pathname;
const packagesDir = join(root, 'packages');
const errors = [];
const warnings = [];

for (const dir of readdirSync(packagesDir)) {
  const path = join(packagesDir, dir);
  if (!statSync(path).isDirectory()) continue;
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  if (pkg.private) continue;
  const where = pkg.name;
  for (const field of [
    'name',
    'version',
    'description',
    'license',
    'exports',
    'files',
    'repository',
    'engines',
  ]) {
    if (pkg[field] === undefined) errors.push(`${where}: missing "${field}"`);
  }
  if (pkg.license !== 'Apache-2.0') errors.push(`${where}: license must be Apache-2.0`);
  if (pkg.type !== 'module') errors.push(`${where}: "type" must be "module"`);
  if (pkg.publishConfig?.access !== 'public') errors.push(`${where}: publishConfig.access must be "public"`);
  if (pkg.publishConfig?.provenance !== true)
    warnings.push(`${where}: publishConfig.provenance should be true`);
  if (!existsSync(join(path, 'README.md'))) (release ? errors : warnings).push(`${where}: README.md missing`);
  const repo = pkg.repository?.url ?? '';
  if (repo.includes('TODO-OWNER'))
    (release ? errors : warnings).push(`${where}: repository.url still has the TODO-OWNER placeholder`);
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    if (typeof target === 'string') continue;
    for (const condition of ['types', 'import']) {
      const file = target[condition];
      if (!file) errors.push(`${where}: export "${subpath}" lacks the "${condition}" condition`);
      else if (release && !existsSync(join(path, file)))
        errors.push(`${where}: ${file} not built (run pnpm build)`);
    }
    const order = Object.keys(target);
    if (order.indexOf('types') > order.indexOf('import'))
      errors.push(`${where}: "types" must come before "import" in export "${subpath}"`);
  }
  for (const [range, version] of Object.entries(pkg.dependencies ?? {})) {
    if (String(version).startsWith('workspace:') && !String(version).match(/^workspace:[\^~*]/)) {
      warnings.push(`${where}: dependency ${range} uses ${version}; prefer workspace:^`);
    }
  }
}

if (!existsSync(join(root, 'LICENSE'))) errors.push('root LICENSE missing');
for (const message of warnings) console.warn(`warning: ${message}`);
if (errors.length > 0) {
  console.error(`Publish check failed (${errors.length}):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Publish check OK${release ? ' (release mode)' : ''}.`);
