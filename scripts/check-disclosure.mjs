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
  { re: /\bINTAKE\.md\b/i, label: 'INTAKE.md' },
  { re: /\bDISCOVERY\.md\b/i, label: 'DISCOVERY.md' },
  { re: /\bSIMULATION\.md\b/i, label: 'SIMULATION.md' },
  { re: /\bCONCEPT\.md\b/i, label: 'CONCEPT.md' },
  { re: /\bp0-turn-neutral\b/i, label: 'p0-turn-neutral cycle' },
  { re: /\bM7 cycle\b/i, label: 'M7 cycle' },
  { re: /\bM7 MCP\b/i, label: 'M7 MCP' },
  { re: /\bSprint [0-9]/i, label: 'Sprint N' },
  { re: /\bphases? 0[–-]4\b/i, label: 'internal cycle phases 0-4' },
  { re: /\bPhase [0-9]\b.*\bharness\b/i, label: 'internal cycle Phase harness' },
];

/** High-confidence credential formats — not generic words like "token" or "password". */
const SECRET_PATTERNS = [
  { re: /\bsk-[a-zA-Z0-9]{20,}\b/, label: 'OpenAI/Anthropic-style API key' },
  { re: /\bghp_[a-zA-Z0-9]{36,}\b/, label: 'GitHub personal access token' },
  { re: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/, label: 'GitHub fine-grained PAT' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/, label: 'Slack token' },
  { re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, label: 'private key block' },
];

const SKIP = new Set(['check-disclosure.mjs', 'publish-to-github.mjs', 'package-lock.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (SKIP.has(name)) continue;
    if (name === '.env' || name.startsWith('.env.')) {
      out.push(abs);
      continue;
    }
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
  const rel = relative(ROOT, file);
  const base = rel.split(/[/\\]/).pop() ?? rel;
  if (base === '.env' || base.startsWith('.env.')) {
    violations.push({ file: rel, label: '.env file in publish tree' });
    continue;
  }
  const text = readFileSync(file, 'utf8');
  for (const { re, label } of BANNED) {
    if (re.test(text)) {
      violations.push({ file: rel, label });
    }
  }
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) {
      violations.push({ file: rel, label });
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
