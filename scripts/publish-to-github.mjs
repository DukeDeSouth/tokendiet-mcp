#!/usr/bin/env node
/**
 * Assemble a clean public tree (no parent monorepo history / internal docs).
 * Usage: node scripts/publish-to-github.mjs [--out DIR]
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? process.argv[outArg + 1] : join(ROOT, '..', '.publish-tokendiet-mcp');

const EXCLUDE_DOCS = new Set(['FIX_PLAN.md', 'SPRINT2_PLAN.md', 'SPRINT3_PLAN.md']);

function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true });
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const top = [
  'README.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'pricing.json',
  '.gitignore',
];

for (const f of top) {
  cpSync(join(ROOT, f), join(OUT, f));
}

copyDir(join(ROOT, 'src'), join(OUT, 'src'));
copyDir(join(ROOT, 'tests'), join(OUT, 'tests'));
copyDir(join(ROOT, 'templates'), join(OUT, 'templates'));
copyDir(join(ROOT, 'wasm'), join(OUT, 'wasm'));
copyDir(join(ROOT, 'scripts'), join(OUT, 'scripts'));
copyDir(join(ROOT, 'benchmarks'), join(OUT, 'benchmarks'));

mkdirSync(join(OUT, 'docs'), { recursive: true });
cpSync(join(ROOT, 'docs', 'TOKENIZER.md'), join(OUT, 'docs', 'TOKENIZER.md'));

for (const name of EXCLUDE_DOCS) {
  const p = join(OUT, 'docs', name);
  if (existsSync(p)) rmSync(p);
}

console.log('Running disclosure check on publish tree…');
execSync('node scripts/check-disclosure.mjs', { cwd: OUT, stdio: 'inherit' });

console.log(`\nPublish tree ready: ${OUT}`);
console.log('Next: cd there, git init, commit, gh repo create --public --push');
