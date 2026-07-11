#!/usr/bin/env node
/**
 * Disclosure lint for publishable surfaces (HANDOFF §8 + DISCLOSURE_BOUNDARY).
 * Fails on internal methodology terms that must not appear in public artifacts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const SCAN_DIRS = ['src', 'templates', 'benchmarks', 'scripts'];
const SCAN_FILES = ['README.md', 'LICENSE', 'package.json', 'docs/TOKENIZER.md'];

const BANNED = [
  { re: /(?<![./\w])M7(?![\w/])/i, label: 'M7' },
  { re: /\bM7MCP\b/i, label: 'M7MCP' },
  { re: /\bANIR\b/i, label: 'ANIR' },
  { re: /trap checker/i, label: 'trap checker' },
  { re: /\bmcp_m7\b/i, label: 'mcp_m7' },
  { re: /\bfog of war\b/i, label: 'fog of war' },
  { re: /\breflection gate\b/i, label: 'reflection gate' },
  { re: /\b7\/7\b.*\bcycle\b/i, label: '7/7 cycle' },
  { re: /\bHive\b.*\bconsensus\b/i, label: 'Hive consensus' },
];

const SKIP = new Set(['check-disclosure.mjs', 'package-lock.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (SKIP.has(name)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.data') continue;
      walk(abs, out);
    } else if (/\.(ts|md|mdc|json|mjs)$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  try {
    walk(abs, files);
  } catch {
    // optional dir
  }
}
for (const f of SCAN_FILES) {
  const abs = join(ROOT, f);
  try {
    statSync(abs);
    files.push(abs);
  } catch {
    // optional
  }
}

const violations = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { re, label } of BANNED) {
    if (re.test(text)) {
      violations.push({ file: relative(ROOT, file), label });
    }
  }
}

if (violations.length) {
  console.error('Disclosure check FAILED:\n');
  for (const v of violations) {
    console.error(`  ${v.file}: banned term "${v.label}"`);
  }
  process.exit(1);
}

console.log(`Disclosure check OK (${files.length} files scanned)`);
