#!/usr/bin/env node
/**
 * Disclosure lint for publishable surfaces.
 * Blocks terms that reveal *how* internal methodology works (tools, phases, internal docs).
 * "M7" as attribution is fine; sprint/internal docs stay out of the publish tree.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const SCAN_DIRS = ['src', 'templates', 'benchmarks', 'scripts'];
const SCAN_FILES = ['README.md', 'LICENSE', 'package.json', 'docs/TOKENIZER.md'];

const BANNED = [
  { re: /\bANIR\b/i, label: 'ANIR' },
  { re: /trap checker/i, label: 'trap checker' },
  { re: /\bmcp_m7\b/i, label: 'mcp_m7' },
  { re: /\bmcp_m7_/i, label: 'mcp_m7_ tool prefix' },
  { re: /\bfog of war\b/i, label: 'fog of war' },
  { re: /\breflection gate\b/i, label: 'reflection gate' },
  { re: /\b7\/7\b.*\bcycle\b/i, label: '7/7 cycle' },
  { re: /\bHive\b.*\bconsensus\b/i, label: 'Hive consensus' },
  { re: /\bDCCE\b/i, label: 'DCCE' },
  { re: /\bINTAKE\b.*\bDISCOVERY\b.*\bARCHITECTURE\b/i, label: 'M7 phase sequence' },
  { re: /\bFIX_PLAN\.md\b/i, label: 'FIX_PLAN.md' },
  { re: /\bSPRINT\d*_PLAN\.md\b/i, label: 'SPRINT_PLAN' },
  { re: /\bHANDOFF\b/i, label: 'HANDOFF' },
  { re: /m7-cycles\//i, label: 'm7-cycles path' },
  { re: /\bcycles\/(?:sprint|p\d)/i, label: 'internal cycles path' },
  { re: /\brepentance\b/i, label: 'repentance' },
  { re: /\blitany\b/i, label: 'litany' },
  { re: /\bhive_coordinator\b/i, label: 'hive_coordinator' },
  { re: /\bknowledge_hub\b/i, label: 'knowledge_hub' },
  { re: /\bIMPACT_ANALYSIS\.md\b/i, label: 'IMPACT_ANALYSIS' },
  { re: /\bSOLUTION_PLAN\.md\b/i, label: 'SOLUTION_PLAN' },
  { re: /\bmemory-bank\//i, label: 'memory-bank path' },
];

const SKIP = new Set(['check-disclosure.mjs', 'publish-to-github.mjs', 'package-lock.json']);

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
