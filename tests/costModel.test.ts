import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COST_MODEL,
  estimateTurnCostInputEq,
  outlineBreakEvenThreshold,
  netEstimate,
  sessionCostInputEq,
  shouldCompress,
  costRatio,
  turnsRatio,
  type SessionUsage,
} from '../src/lib/costModel.js';

describe('costModel', () => {
  it('E_turn matches user A/B calibration (~8449)', () => {
    const cfg = {
      ...DEFAULT_COST_MODEL,
      avg_context_estimate: 11_644_672 / 212,
      avg_tool_output_estimate: 41_961 / 212,
    };
    const eTurn = estimateTurnCostInputEq(cfg);
    expect(eTurn).toBeGreaterThan(8000);
    expect(eTurn).toBeLessThan(9000);
  });

  it('outline break-even near 3000 BPE at default p=0.3', () => {
    const t = outlineBreakEvenThreshold(DEFAULT_COST_MODEL);
    expect(t).toBeGreaterThan(2500);
    expect(t).toBeLessThan(3500);
  });

  it('shouldCompress rejects small file savings', () => {
    expect(shouldCompress(500, 400, true, DEFAULT_COST_MODEL)).toBe(false);
    expect(shouldCompress(500, 400, false, DEFAULT_COST_MODEL)).toBe(true);
  });

  it('shouldCompress accepts large file outline savings', () => {
    const saved = Math.round(4000 * 0.85);
    expect(shouldCompress(4000, saved, true, DEFAULT_COST_MODEL)).toBe(false);
    expect(shouldCompress(4000, saved, false, DEFAULT_COST_MODEL)).toBe(true);
  });

  it('netEstimate negative on redundant small read', () => {
    const net = netEstimate(400, true, DEFAULT_COST_MODEL);
    expect(net).toBeLessThan(0);
  });

  it('sessionCostInputEq validates user A/B ratio', () => {
    const baseline: SessionUsage = {
      turns: 48,
      fresh_input: 407_955,
      cache_read: 2_591_232,
      output: 21_006,
    };
    const tokendiet: SessionUsage = {
      turns: 212,
      fresh_input: 334_165,
      cache_read: 11_644_672,
      output: 41_961,
    };
    const ratio = costRatio(tokendiet, baseline);
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(2.5);
  });

  it('turnsRatio from user A/B', () => {
    expect(turnsRatio(212, 48)).toBeCloseTo(4.42, 1);
  });

  it('user billed cost model within 15% of reported +126%', () => {
    const baseline: SessionUsage = {
      turns: 48,
      fresh_input: 407_955,
      cache_read: 2_591_232,
      output: 21_006,
    };
    const tokendiet: SessionUsage = {
      turns: 212,
      fresh_input: 334_165,
      cache_read: 11_644_672,
      output: 41_961,
    };
    const baseCost = sessionCostInputEq(baseline);
    const tdCost = sessionCostInputEq(tokendiet);
    const pct = ((tdCost - baseCost) / baseCost) * 100;
    expect(pct).toBeGreaterThan(110);
    expect(pct).toBeLessThan(145);
  });
});
