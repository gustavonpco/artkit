#!/usr/bin/env node
// Enforces the dependency rules of spec §5.3:
// - no circular dependencies between workspace packages;
// - @artkit-ai/core imports only zod (no React, Node APIs, DOM or AI SDK);
// - the "." entry of every kind package (files outside react/, edit/, export/) imports only
//   @artkit-ai/core, zod and the pure parsers allowed for that kind, and never touches DOM or Node globals;
// - @artkit-ai/agent never imports the AI SDK;
// - every import of a workspace or npm package is declared in the importing package.json.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packagesDir = join(root, 'packages');
const errors = [];

const packages = readdirSync(packagesDir)
  .filter((name) => statSync(join(packagesDir, name)).isDirectory())
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
    return { dir, pkg, path: join(packagesDir, dir) };
  });

const byName = new Map(packages.map((p) => [p.pkg.name, p]));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function stripComments(source) {
  // Keeps string contents (import specifiers live there) and removes // and /* */ comments.
  return source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match, str) => str ?? '',
  );
}

function stripStrings(source) {
  // Line by line, so a quote inside a regex literal cannot swallow the rest of the file.
  return source
    .split('\n')
    .map((line) => line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""'))
    .join('\n');
}

function importsOf(file) {
  const source = stripComments(readFileSync(file, 'utf8'));
  // Template literals hold code samples (guides, docs); real specifiers never use backticks.
  const code = source.replace(/`(?:\\.|[^`\\])*`/g, '``');
  const found = [];
  for (const match of code.matchAll(IMPORT)) found.push(match[1] ?? match[2] ?? match[3]);
  return { source, imports: found.filter(Boolean) };
}

function packageOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const KIND_MODEL_ALLOWED = {
  'kind-document': [
    '@artkit-ai/core',
    'zod',
    'mdast-util-from-markdown',
    'mdast-util-gfm',
    'micromark-extension-gfm',
  ],
  // Pure-JS layout shared by renderer, svg exporter and editor; runs in every runtime.
  'kind-diagram': ['@artkit-ai/core', 'zod', '@dagrejs/dagre'],
};
const DOM_GLOBALS = /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement)\s*[.[]/;

for (const { dir, pkg, path } of packages) {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const srcDir = join(path, 'src');
  let files = [];
  try {
    files = walk(srcDir);
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(srcDir, file).split(sep).join('/');
    const { source, imports } = importsOf(file);
    const isKindModel = dir.startsWith('kind-') && !/^(react|edit|export)\//.test(rel);
    for (const specifier of imports) {
      const name = packageOf(specifier);
      if (specifier.startsWith('.')) continue;
      const where = `${pkg.name} ${rel}`;
      if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(name)) {
        if (dir === 'core' || dir === 'agent' || isKindModel)
          errors.push(`${where}: Node built-in "${specifier}" is not allowed here`);
        continue;
      }
      if (name === 'react' || name === 'react-dom' || name.startsWith('@types/')) {
        if (dir === 'core' || dir === 'agent' || isKindModel)
          errors.push(`${where}: React is not allowed here`);
      }
      if (dir === 'core' && name !== 'zod')
        errors.push(`${where}: @artkit-ai/core may only import zod (found "${specifier}")`);
      if (dir === 'agent' && name === 'ai')
        errors.push(`${where}: @artkit-ai/agent must not import the AI SDK`);
      if (isKindModel) {
        const allowed = KIND_MODEL_ALLOWED[dir] ?? ['@artkit-ai/core', 'zod'];
        if (!allowed.includes(name))
          errors.push(
            `${where}: the "." entry of a kind may only import ${allowed.join(', ')} (found "${specifier}")`,
          );
      }
      if (!declared.has(name) && name !== pkg.name)
        errors.push(`${where}: "${name}" is imported but not declared in package.json`);
    }
    if ((dir === 'core' || isKindModel) && DOM_GLOBALS.test(stripStrings(source))) {
      errors.push(`${pkg.name} ${rel}: DOM globals are not allowed in runtime-neutral code`);
    }
  }
}

// Cycle detection over workspace dependencies.
const graph = new Map(
  packages.map(({ pkg }) => [
    pkg.name,
    Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter((dep) => byName.has(dep)),
  ]),
);
const state = new Map();
function visit(name, stack) {
  if (state.get(name) === 'done') return;
  if (state.get(name) === 'visiting') {
    errors.push(`circular dependency: ${[...stack.slice(stack.indexOf(name)), name].join(' -> ')}`);
    return;
  }
  state.set(name, 'visiting');
  for (const dep of graph.get(name) ?? []) visit(dep, [...stack, name]);
  state.set(name, 'done');
}
for (const name of graph.keys()) visit(name, []);

if (errors.length > 0) {
  console.error(`Dependency rules violated (${errors.length}):\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Dependency rules OK (${packages.length} packages).`);
