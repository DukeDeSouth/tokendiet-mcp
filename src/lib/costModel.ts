/**
 * Session economics for turn-neutral compression.
 * Thresholds derive from E_turn (cost of one agent round-trip), not hand-tuned constants.
 */

export interface CostModelConfig {
  /** Cache-read price / input price (e.g. 0.125). */
  cache_read_ratio: number;
  /** Output price / input price (e.g. 8.0). */
  output_ratio: number;
  /** Rolling mean context size per API turn (tokens). */
  avg_context_estimate: number;
  /** Mean output tokens per tool-call turn. */
  avg_tool_output_estimate: number;
  /** P(outline read → symbol/expand/re-read same path). */
  follow_up_rate: number;
  /** Expected fraction of tokens saved by outline (0–1). */
  compression_ratio_outline: number;
  /** Expected fraction saved by outline+ (includes small bodies; lower than outline). */
  compression_ratio_outline_plus: number;
}

export const DEFAULT_COST_MODEL: CostModelConfig = {
  cache_read_ratio: 0.125,
  output_ratio: 8,
  avg_context_estimate: 55_000,
  avg_tool_output_estimate: 200,
  follow_up_rate: 0.3,
  compression_ratio_outline: 0.85,
  compression_ratio_outline_plus: 0.72,
};

export interface SessionUsage {
  turns: number;
  fresh_input: number;
  cache_read: number;
  output: number;
}

/** One agent turn in input-token equivalents (normalized to fresh input price). */
export function estimateTurnCostInputEq(cfg: CostModelConfig = DEFAULT_COST_MODEL): number {
  return (
    cfg.avg_context_estimate * cfg.cache_read_ratio +
    cfg.avg_tool_output_estimate * cfg.output_ratio
  );
}

/**
 * Minimum file size (BPE) where outline compression pays for itself:
 * saved ≈ compression_ratio × tokensIn > p × E_turn
 */
export function outlineBreakEvenThreshold(cfg: CostModelConfig = DEFAULT_COST_MODEL): number {
  const eTurn = estimateTurnCostInputEq(cfg);
  const { follow_up_rate: p, compression_ratio_outline: ratio } = cfg;
  if (p <= 0 || ratio <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil((p * eTurn) / ratio);
}

export function estimatedOutlineSaved(tokensIn: number, cfg: CostModelConfig = DEFAULT_COST_MODEL): number {
  return Math.round(tokensIn * cfg.compression_ratio_outline);
}

/** Whether compressing this payload is expected to be net-positive. */
export function shouldCompress(
  tokensIn: number,
  estimatedSaved: number,
  isRedundantTurn: boolean,
  cfg: CostModelConfig = DEFAULT_COST_MODEL,
): boolean {
  if (tokensIn <= 0) return false;
  const eTurn = estimateTurnCostInputEq(cfg);
  const turnCost = isRedundantTurn ? eTurn : 0;
  return estimatedSaved > turnCost;
}

/** Net benefit in input-equivalent tokens (negative = unprofitable). */
export function netEstimate(
  saved: number,
  isRedundantTurn: boolean,
  cfg: CostModelConfig = DEFAULT_COST_MODEL,
): number {
  const turnCost = isRedundantTurn ? estimateTurnCostInputEq(cfg) : 0;
  return saved - turnCost;
}

/** Total session cost in input-token equivalents. */
export function sessionCostInputEq(
  usage: SessionUsage,
  cfg: CostModelConfig = DEFAULT_COST_MODEL,
): number {
  return (
    usage.fresh_input +
    usage.cache_read * cfg.cache_read_ratio +
    usage.output * cfg.output_ratio
  );
}

export function turnsRatio(tokendietTurns: number, baselineTurns: number): number {
  if (baselineTurns <= 0) return tokendietTurns > 0 ? Number.POSITIVE_INFINITY : 1;
  return tokendietTurns / baselineTurns;
}

export function costRatio(tokendiet: SessionUsage, baseline: SessionUsage, cfg?: CostModelConfig): number {
  const base = sessionCostInputEq(baseline, cfg);
  const td = sessionCostInputEq(tokendiet, cfg);
  if (base <= 0) return td > 0 ? Number.POSITIVE_INFINITY : 1;
  return td / base;
}
