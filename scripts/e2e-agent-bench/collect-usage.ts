#!/usr/bin/env npx tsx
/**
 * Evaluate a session usage JSON file against pricing + cost model.
 * Usage: npx tsx scripts/e2e-agent-bench/collect-usage.ts path/to/usage.json [--baseline path]
 */
import { readFileSync } from 'node:fs';
import { estimateSessionUsd } from '../../src/lib/pricing.js';
import { evaluateAgainstBaseline, loadFixture, type FixtureSession } from './lib/turnSimulator.js';
import { calibrateCostModelFromUserAb } from './lib/turnSimulator.js';

function main(): void {
  const args = process.argv.slice(2);
  const fileIdx = args.findIndex((a) => !a.startsWith('--'));
  if (fileIdx === -1) {
    console.error('Usage: collect-usage.ts <usage.json> [--baseline baseline.json]');
    process.exit(1);
  }
  const usagePath = args[fileIdx]!;
  const baselineFlag = args.indexOf('--baseline');
  const baselinePath = baselineFlag >= 0 ? args[baselineFlag + 1] : undefined;

  const session = JSON.parse(readFileSync(usagePath, 'utf8')) as FixtureSession;
  const cfg = calibrateCostModelFromUserAb();
  const computedUsd = estimateSessionUsd(session.usage);

  const out: Record<string, unknown> = {
    label: session.label,
    usage: session.usage,
    billed_cost_usd_reported: session.billed_cost_usd,
    billed_cost_usd_computed: Math.round(computedUsd * 10000) / 10000,
    cost_model: cfg,
  };

  if (baselinePath) {
    const baseline = loadFixture(baselinePath);
    out.comparison = evaluateAgainstBaseline(session.usage, baseline.usage, cfg);
    if (baseline.billed_cost_usd && session.billed_cost_usd) {
      out.billed_cost_ratio_reported =
        Math.round((session.billed_cost_usd / baseline.billed_cost_usd) * 100) / 100;
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main();
