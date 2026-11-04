#!/usr/bin/env node
// Verifies that every production dependency (direct and transitive) of the publishable packages has a
// license compatible with Apache-2.0 (spec §5.4, §26). Copyleft and source-available licenses fail the build.
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Zlib',
]);

// Manually reviewed packages whose license metadata is missing or non-SPDX. Keep the reason next to each.
const REVIEWED = {
  // Transitive dependency of exceljs (unzipper → binary). No "license" field; the source is MIT/X11 by James Halliday.
  'buffers@0.1.1': 'MIT',
  // Transitive dependency of exceljs (unzipper → binary). Declares "MIT/X11", which is the MIT license.
  'chainsaw@0.1.0': 'MIT',
};

// Packages explicitly vetoed by the spec regardless of license field (§5.4).
const VETOED = ['hyperformula', '@blocknote/xl-', 'pptist', 'tldraw', '@tiptap-pro/'];

function licensesOf(expression) {
  return String(expression ?? 'UNKNOWN')
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((s) => s.trim());
}

function accepted(expression) {
  const text = String(expression ?? '');
  const parts = licensesOf(text);
  // "A OR B" is fine when any option is allowed; "A AND B" needs all of them.
  return /\sAND\s/i.test(text) ? parts.every((p) => ALLOWED.has(p)) : parts.some((p) => ALLOWED.has(p));
}

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json', '--recursive'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const report = JSON.parse(raw);
const problems = [];
let count = 0;
for (const [license, entries] of Object.entries(report)) {
  for (const entry of entries) {
    count += 1;
    const name = entry.name;
    const versions = entry.versions ?? [];
    const reviewed = versions.length > 0 && versions.every((v) => REVIEWED[`${name}@${v}`] !== undefined);
    if (VETOED.some((v) => name.startsWith(v))) problems.push(`${name}: vetoed by the spec`);
    else if (!accepted(license) && !reviewed) problems.push(`${name}@${versions.join(',')}: ${license}`);
  }
}

if (problems.length > 0) {
  console.error(
    `Incompatible or unknown licenses (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`License check OK (${count} production packages).`);
