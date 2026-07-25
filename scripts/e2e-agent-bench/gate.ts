#!/usr/bin/env npx tsx
/**
 * E2E turn-neutral gate — offline harness + release checks.
 * Run: npm run e2e:gate
 *
 * Evaluates:
 * 1. User A/B fixtures (documents current v1 FAIL)
 * 2. Offline N-corpus turn simulation (v1 vs v2 policies)
 * 3. Optional dogfood H-corpus payload metrics
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { costRatio, turnsRatio } from '../../src/lib/costModel.js';
import { estimateSessionUsd } from '../../src/lib/pricing.js';
import {
  calibrateCostModelFromUserAb,
  evaluateAgainstBaseline,
  flattenExplorationFiles,
  loadFileTokens,
  loadFixture,
  simulateTurns,
} from './lib/turnSimulator.js';

const benchRoot = join(dirname(fileURLToPath(import.meta.url)));
const pkgRoot = join(benchRoot, '..', '..');

interface GateThresholds {
  turns_ratio_max: number;
  billed_cost_ratio_max: number;
  follow_up_rate_max?: number;
}

interface GateFile {
  version: string;
  date: string;
  'N-project-study': GateThresholds;
  'user_ab_regression': GateThresholds & { document_current_v1_fail?: boolean };
}

interface GateCheck {
  name: string;
  pass: boolean;
  actual: number | string;
  threshold: string;
  note?: string;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(benchRoot, rel), 'utf8')) as T;
}

function runDogfoodScript(script: string): Promise<{ saved_pct: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', join('scripts', script)], {
      cwd: pkgRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
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
        const parsed = JSON.parse(out) as { saved_pct: number };
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function main(): Promise<void> {
  const gates = loadJson<GateFile>('config/gates.json');
  const cfg = calibrateCostModelFromUserAb();
  const checks: GateCheck[] = [];

  // --- 1. User A/B regression (real external data) ---
  const baseline = loadFixture(join(benchRoot, 'fixtures/user-ab-baseline.json'));
  const tokendietV1 = loadFixture(join(benchRoot, 'fixtures/user-ab-tokendiet.json'));
  const userMetrics = evaluateAgainstBaseline(tokendietV1.usage, baseline.usage, cfg);

  const userTurnsPass = userMetrics.turns_ratio <= gates['user_ab_regression'].turns_ratio_max;
  const userCostPass = userMetrics.cost_ratio <= gates['user_ab_regression'].billed_cost_ratio_max;

  checks.push({
    name: 'user_ab_turns_ratio',
    pass: userTurnsPass,
    actual: userMetrics.turns_ratio,
    threshold: `≤ ${gates['user_ab_regression'].turns_ratio_max}`,
    note: userTurnsPass ? undefined : 'Expected FAIL on v1 — documents the problem',
  });
  checks.push({
    name: 'user_ab_cost_ratio',
    pass: userCostPass,
    actual: userMetrics.cost_ratio,
    threshold: `≤ ${gates['user_ab_regression'].billed_cost_ratio_max}`,
    note: userCostPass ? undefined : 'Expected FAIL on v1 (+126.6% billed)',
  });

  // Harness validity: v1 MUST fail if document_current_v1_fail is set
  const harnessValid =
    gates['user_ab_regression'].document_current_v1_fail === true
      ? !userTurnsPass || !userCostPass
      : true;
  checks.push({
    name: 'harness_validity_v1_documented_fail',
    pass: harnessValid,
    actual: harnessValid ? 'v1 fails as expected' : 'v1 unexpectedly passes',
    threshold: 'v1 must FAIL',
  });

  // --- 2. Offline N-corpus simulation ---
  const manifest = loadJson<Record<string, string[]>>(
    'corpora/N-project-study/exploration-files.json',
  );
  const relPaths = flattenExplorationFiles(manifest);
  const files = loadFileTokens(pkgRoot, relPaths);

  const simBaseline = simulateTurns(files, 'baseline', cfg, baseline.usage);
  const simV1 = simulateTurns(files, 'tokendiet_v1', cfg, baseline.usage);
  const simV2p1 = simulateTurns(files, 'tokendiet_v2_phase1', cfg, baseline.usage);
  const simV2p2 = simulateTurns(files, 'tokendiet_v2_phase2', cfg, baseline.usage);

  const nThresholds = gates['N-project-study'];

  for (const [label, sim] of [
    ['sim_v2_phase1', simV2p1],
    ['sim_v2_phase2', simV2p2],
  ] as const) {
    const m = evaluateAgainstBaseline(sim.projected_usage, baseline.usage, cfg);
    checks.push({
      name: `${label}_turns_ratio`,
      pass: m.turns_ratio <= nThresholds.turns_ratio_max,
      actual: m.turns_ratio,
      threshold: `≤ ${nThresholds.turns_ratio_max}`,
    });
    checks.push({
      name: `${label}_cost_ratio`,
      pass: m.cost_ratio <= nThresholds.billed_cost_ratio_max,
      actual: m.cost_ratio,
      threshold: `≤ ${nThresholds.billed_cost_ratio_max}`,
    });
    if (nThresholds.follow_up_rate_max !== undefined) {
      checks.push({
        name: `${label}_follow_up_rate`,
        pass: sim.follow_up_rate < nThresholds.follow_up_rate_max,
        actual: sim.follow_up_rate,
        threshold: `< ${nThresholds.follow_up_rate_max}`,
      });
    }
  }

  // v1 simulation should show high turns (not gated — diagnostic)
  const simV1Metrics = evaluateAgainstBaseline(simV1.projected_usage, baseline.usage, cfg);

  // --- 3. H-corpus dogfood (payload diagnostic) ---
  let r3: { saved_pct: number } | undefined;
  try {
    r3 = await runDogfoodScript('dogfood-r3.ts');
    checks.push({
      name: 'H_test_logs_payload_saved',
      pass: r3.saved_pct >= 30,
      actual: r3.saved_pct,
      threshold: '≥ 30%',
      note: 'Payload diagnostic — run compression still valuable',
    });
  } catch (err) {
    checks.push({
      name: 'H_test_logs_payload_saved',
      pass: false,
      actual: 'skipped',
      threshold: '≥ 30%',
      note: err instanceof Error ? err.message : 'dogfood-r3 failed',
    });
  }

  // --- 4. Shrink proxy simulation (turn-neutral structural layer) ---
  let shrink: { saved_pct: number; turns_added?: number } | undefined;
  try {
    shrink = await runDogfoodScript('dogfood-shrink.ts');
    checks.push({
      name: 'shrink_playwright_sim_saved',
      pass: shrink.saved_pct >= 50,
      actual: shrink.saved_pct,
      threshold: '≥ 50%',
      note: 'Shrink proxy — 0 extra agent turns',
    });
  } catch (err) {
    checks.push({
      name: 'shrink_playwright_sim_saved',
      pass: false,
      actual: 'skipped',
      threshold: '≥ 50%',
      note: err instanceof Error ? err.message : 'dogfood-shrink failed',
    });
  }

  const releaseChecks = checks.filter(
    (c) =>
      c.name.startsWith('sim_v2') ||
      c.name === 'H_test_logs_payload_saved' ||
      c.name === 'shrink_playwright_sim_saved',
  );
  const releaseReady = releaseChecks.every((c) => c.pass);
  const harnessOk = harnessValid && checks.some((c) => c.name === 'user_ab_turns_ratio');

  const result = {
    version: gates.version,
    date: new Date().toISOString().slice(0, 10),
    cost_model: {
      e_turn_input_eq: simV2p2.e_turn,
      t_full_bpe: simV2p2.t_full,
      calibrated_from: 'user A/B session',
    },
    user_ab: {
      baseline: {
        ...baseline.usage,
        billed_cost_usd: baseline.billed_cost_usd,
        computed_usd: Math.round(estimateSessionUsd(baseline.usage) * 10000) / 10000,
      },
      tokendiet_v1: {
        ...tokendietV1.usage,
        billed_cost_usd: tokendietV1.billed_cost_usd,
        computed_usd: Math.round(estimateSessionUsd(tokendietV1.usage) * 10000) / 10000,
        metrics: userMetrics,
      },
      turns_ratio: turnsRatio(tokendietV1.usage.turns, baseline.usage.turns),
      cost_ratio: costRatio(tokendietV1.usage, baseline.usage, cfg),
    },
    n_corpus_simulation: {
      files_measured: files.length,
      token_stats: {
        median: files.map((f) => f.tokens).sort((a, b) => a - b)[Math.floor(files.length / 2)],
        max: Math.max(...files.map((f) => f.tokens)),
        files_gte_800: files.filter((f) => f.tokens >= 800).length,
        files_gte_t_full: files.filter((f) => f.tokens >= simV2p2.t_full).length,
      },
      policies: {
        baseline: simBaseline,
        tokendiet_v1: { ...simV1, metrics: simV1Metrics },
        tokendiet_v2_phase1: simV2p1,
        tokendiet_v2_phase2: simV2p2,
      },
    },
    checks,
    pass: harnessOk,
    release_ready: releaseReady,
    note: releaseReady
      ? 'E2E gate PASS — turn-neutral v0.7.0'
      : 'E2E gate FAIL — check sim_v2 and shrink checks',
  };

  const outJson = join(pkgRoot, 'benchmarks', '2026-07-25-e2e-turn-neutral.json');
  const outMd = join(pkgRoot, 'benchmarks', '2026-07-25-e2e-turn-neutral.md');
  mkdirSync(dirname(outJson), { recursive: true });
  writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`);

  const { generateMarkdownReport } = await import('./report.js');
  writeFileSync(outMd, generateMarkdownReport(result));

  console.log(JSON.stringify(result, null, 2));
  process.exit(harnessOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
