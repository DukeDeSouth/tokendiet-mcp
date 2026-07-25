import {
  estimatedOutlineSaved,
  netEstimate,
  shouldCompress,
  type CostModelConfig,
} from './costModel.js';
import { costModelFromPricing } from './pricing.js';

export type PassthroughReason = 'redundant_turn' | 'savings_below_turn_cost' | 'explicit_full';

export interface CompressGateResult {
  passthrough: boolean;
  reason?: PassthroughReason;
  net_estimate: number;
  estimated_saved: number;
}

export function evaluateCompressGate(
  tokensIn: number,
  estimatedSaved: number,
  isRedundantTurn: boolean,
  cfg?: CostModelConfig,
): CompressGateResult {
  const config = cfg ?? costModelFromPricing();
  const net = netEstimate(estimatedSaved, isRedundantTurn, config);
  const passthrough = !shouldCompress(tokensIn, estimatedSaved, isRedundantTurn, config);
  let reason: PassthroughReason | undefined;
  if (passthrough) {
    reason = isRedundantTurn ? 'redundant_turn' : 'savings_below_turn_cost';
  }
  return {
    passthrough,
    ...(reason !== undefined && { reason }),
    net_estimate: net,
    estimated_saved: estimatedSaved,
  };
}

/** Estimate saved tokens for outline-style code compression. */
export function estimateCodeOutlineSaved(tokensIn: number, cfg?: CostModelConfig): number {
  const config = cfg ?? costModelFromPricing();
  return estimatedOutlineSaved(tokensIn, config);
}

/** Estimate saved tokens for outline+ (more payload retained than plain outline). */
export function estimateCodeOutlinePlusSaved(tokensIn: number, cfg?: CostModelConfig): number {
  const config = cfg ?? costModelFromPricing();
  return Math.round(tokensIn * config.compression_ratio_outline_plus);
}

/** Rough savings estimate by content profile (fetch / plain read). */
export function estimateTransformSaved(
  tokensIn: number,
  profile: 'html' | 'json' | 'plain' | 'log',
): number {
  const ratio = profile === 'html' ? 0.9 : profile === 'log' ? 0.7 : profile === 'json' ? 0.1 : 0.3;
  return Math.round(tokensIn * ratio);
}
