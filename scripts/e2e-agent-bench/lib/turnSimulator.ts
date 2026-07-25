import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { countTokens } from '../../../src/tokenize/counter.js';
import {
  costModelFromPricing,
  estimateSessionUsd,
  type PricingTable,
} from '../../../src/lib/pricing.js';
import {
  costRatio,
  estimateTurnCostInputEq,
  outlineBreakEvenThreshold,
  sessionCostInputEq,
  turnsRatio,
  type CostModelConfig,
  type SessionUsage,
} from '../../../src/lib/costModel.js';

export type AgentPolicy = 'baseline' | 'tokendiet_v1' | 'tokendiet_v2_phase1' | 'tokendiet_v2_phase2';

export interface PolicyParams {
  outline_threshold: number;
  full_passthrough_threshold: number;
  follow_up_rate: number;
  expand_rate: number;
  batch_size: number;
  search_calls: number;
  stats_calls: number;
  run_calls: number;
  use_mcp_for_small_reads: boolean;
}

export const POLICIES: Record<AgentPolicy, PolicyParams> = {
  baseline: {
    outline_threshold: Number.POSITIVE_INFINITY,
    full_passthrough_threshold: 0,
    follow_up_rate: 0,
    expand_rate: 0,
    batch_size: 1,
    search_calls: 8,
    stats_calls: 0,
    run_calls: 2,
    use_mcp_for_small_reads: false,
  },
  tokendiet_v1: {
    outline_threshold: 800,
    full_passthrough_threshold: 200,
    follow_up_rate: 0.35,
    expand_rate: 0.15,
    batch_size: 1,
    search_calls: 15,
    stats_calls: 2,
    run_calls: 3,
    use_mcp_for_small_reads: true,
  },
  tokendiet_v2_phase1: {
    outline_threshold: Number.POSITIVE_INFINITY,
    full_passthrough_threshold: 2982,
    follow_up_rate: 0.08,
    expand_rate: 0.02,
    batch_size: 1,
    search_calls: 15,
    stats_calls: 0,
    run_calls: 3,
    use_mcp_for_small_reads: false,
  },
  tokendiet_v2_phase2: {
    outline_threshold: Number.POSITIVE_INFINITY,
    full_passthrough_threshold: 2982,
    follow_up_rate: 0.05,
    expand_rate: 0.01,
    batch_size: 12,
    search_calls: 15,
    stats_calls: 0,
    run_calls: 3,
    use_mcp_for_small_reads: false,
  },
};

export interface FileTokenInfo {
  path: string;
  tokens: number;
}

export interface TurnSimulationResult {
  policy: AgentPolicy;
  read_files: number;
  estimated_turns: number;
  read_turns: number;
  follow_up_turns: number;
  expand_turns: number;
  other_turns: number;
  follow_up_rate: number;
  projected_usage: SessionUsage;
  projected_cost_input_eq: number;
  projected_cost_usd: number;
  t_full: number;
  e_turn: number;
}

export function loadFileTokens(workspace: string, relPaths: string[]): FileTokenInfo[] {
  const out: FileTokenInfo[] = [];
  for (const rel of relPaths) {
    const abs = join(workspace, rel);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    out.push({ path: rel, tokens: countTokens(content) });
  }
  return out;
}

export function flattenExplorationFiles(manifest: Record<string, string[]>): string[] {
  const all: string[] = [];
  for (const key of Object.keys(manifest)) {
    if (key === 'description') continue;
    const val = manifest[key];
    if (Array.isArray(val)) all.push(...val);
  }
  return all;
}

function readTurnsForFile(file: FileTokenInfo, policy: PolicyParams): number {
  if (!policy.use_mcp_for_small_reads && file.tokens < policy.full_passthrough_threshold) {
    return 0; // built-in Read — no MCP turn
  }
  return 1 / policy.batch_size;
}

function followUpsForFile(file: FileTokenInfo, policy: PolicyParams): number {
  if (file.tokens < policy.outline_threshold) return 0;
  return policy.follow_up_rate + policy.expand_rate;
}

export function simulateTurns(
  files: FileTokenInfo[],
  policyName: AgentPolicy,
  cfg: CostModelConfig,
  baselineUsage?: SessionUsage,
): TurnSimulationResult {
  const policy = POLICIES[policyName];
  const tFull = outlineBreakEvenThreshold(cfg);
  const effectivePolicy: PolicyParams =
    policyName === 'tokendiet_v2_phase1' || policyName === 'tokendiet_v2_phase2'
      ? { ...policy, full_passthrough_threshold: tFull }
      : policy;

  let readTurns = 0;
  let followUpTurns = 0;
  let mcpReads = 0;

  for (const file of files) {
    const rt = readTurnsForFile(file, effectivePolicy);
    if (rt > 0) {
      readTurns += rt;
      mcpReads += 1;
      followUpTurns += followUpsForFile(file, effectivePolicy);
    }
  }

  const otherTurns = effectivePolicy.search_calls + effectivePolicy.stats_calls + effectivePolicy.run_calls;
  const baselineTurns = policyName === 'baseline'
    ? files.length + otherTurns
    : readTurns + followUpTurns + otherTurns;
  const estimatedTurns = policyName === 'baseline'
    ? files.length + otherTurns
    : readTurns + followUpTurns + otherTurns;

  const followUpRate = mcpReads > 0 ? followUpTurns / mcpReads : 0;

  const projected = projectUsageFromTurns(
    estimatedTurns,
    policyName,
    cfg,
    baselineUsage,
  );

  return {
    policy: policyName,
    read_files: files.length,
    estimated_turns: Math.round(estimatedTurns * 10) / 10,
    read_turns: Math.round(readTurns * 10) / 10,
    follow_up_turns: Math.round(followUpTurns * 10) / 10,
    expand_turns: Math.round(followUpTurns * (effectivePolicy.expand_rate / (effectivePolicy.follow_up_rate + effectivePolicy.expand_rate || 1)) * 10) / 10,
    other_turns: otherTurns,
    follow_up_rate: Math.round(followUpRate * 1000) / 1000,
    projected_usage: projected,
    projected_cost_input_eq: sessionCostInputEq(projected, cfg),
    projected_cost_usd: estimateSessionUsd(projected),
    t_full: tFull,
    e_turn: estimateTurnCostInputEq(cfg),
  };
}

/** Scale cache/output from baseline per-turn averages; adjust fresh for compression policy. */
function projectUsageFromTurns(
  turns: number,
  policy: AgentPolicy,
  cfg: CostModelConfig,
  baselineUsage?: SessionUsage,
): SessionUsage {
  const base = baselineUsage ?? {
    turns: 48,
    fresh_input: 407_955,
    cache_read: 2_591_232,
    output: 21_006,
  };

  const cachePerTurn = base.cache_read / base.turns;
  const outputPerTurn = base.output / base.turns;
  const freshPerTurn = base.fresh_input / base.turns;

  let freshMultiplier = 1;
  if (policy === 'tokendiet_v1') freshMultiplier = 0.82;
  if (policy === 'tokendiet_v2_phase1') freshMultiplier = 0.95;
  if (policy === 'tokendiet_v2_phase2') freshMultiplier = 0.88;

  return {
    turns,
    fresh_input: Math.round(freshPerTurn * turns * freshMultiplier),
    cache_read: Math.round(cachePerTurn * turns),
    output: Math.round(outputPerTurn * turns * (policy === 'baseline' ? 1 : 1.05)),
  };
}

export interface FixtureSession {
  label: string;
  usage: SessionUsage;
  billed_cost_usd?: number;
  quality_pass?: boolean;
  expected_gate?: string;
}

export function loadFixture(path: string): FixtureSession {
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureSession;
}

export function evaluateAgainstBaseline(
  candidate: SessionUsage,
  baseline: SessionUsage,
  cfg: CostModelConfig,
): {
  turns_ratio: number;
  cost_ratio: number;
  fresh_saved_pct: number;
} {
  const freshSaved = baseline.fresh_input > 0
    ? Math.round(((baseline.fresh_input - candidate.fresh_input) / baseline.fresh_input) * 1000) / 10
    : 0;
  return {
    turns_ratio: Math.round(turnsRatio(candidate.turns, baseline.turns) * 100) / 100,
    cost_ratio: Math.round(costRatio(candidate, baseline, cfg) * 100) / 100,
    fresh_saved_pct: freshSaved,
  };
}

export function defaultCostModel(): CostModelConfig {
  return costModelFromPricing();
}

export function calibrateCostModelFromUserAb(): CostModelConfig {
  return costModelFromPricing({
    avg_context_estimate: 11_644_672 / 212,
    avg_tool_output_estimate: 41_961 / 212,
  });
}
