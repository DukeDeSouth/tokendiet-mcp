/**
 * Sprint 2 v3 gate summary — aggregates v2 baselines with v3 code/search/fetch scenarios.
 * Run: npm run dogfood:v3-gate  (after dogfood:r4 r5 sf; includes re-run of r1-r3)
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

interface BenchSummary {
  scenario: string;
  baseline_tokens: number;
  compressed_tokens: number;
  saved_tokens: number;
  saved_pct: number;
}

function runScript(script: string): Promise<BenchSummary> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', join('scripts', script)], {
      cwd: pkgRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${script} exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as BenchSummary);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function weightedGate(scenarios: BenchSummary[]): { baseline: number; saved: number; pct: number } {
  const baseline = scenarios.reduce((s, x) => s + x.baseline_tokens, 0);
  const saved = scenarios.reduce((s, x) => s + x.saved_tokens, 0);
  return { baseline, saved, pct: baseline ? Math.round((saved / baseline) * 100) : 0 };
}

async function main() {
  const r4 = await runScript('dogfood-r4.ts');
  const r5 = await runScript('dogfood-r5.ts');
  let sf: BenchSummary | undefined;
  try {
    sf = await runScript('dogfood-sf.ts');
  } catch (err) {
    console.error('SF skipped (network?):', err instanceof Error ? err.message : err);
  }

  const codeCold = weightedGate([r4]);
  const codeSessions = weightedGate([r4, r5]);
  const v3All = sf ? weightedGate([r4, r5, sf]) : weightedGate([r4, r5]);

  const gate = {
    version: 'v3',
    date: '2026-07-11',
    scenarios: { r4, r5, ...(sf && { sf }) },
    metrics: {
      cold_first_code: codeCold,
      code_sessions_weighted: codeSessions,
      v3_all_weighted: v3All,
    },
    targets: {
      cold_first_min_pct: 25,
      v2_cold_reference_pct: 5,
    },
    pass: {
      cold_first_ge_25: codeCold.pct >= 25,
      cold_first_gt_v2: codeCold.pct > 5,
    },
  };

  console.log(JSON.stringify(gate, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
