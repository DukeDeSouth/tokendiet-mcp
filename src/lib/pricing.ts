import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CostModelConfig, SessionUsage } from './costModel.js';
import { DEFAULT_COST_MODEL } from './costModel.js';

export interface ModelPricing {
  id: string;
  label: string;
  input_per_million_usd: number;
  cache_read_per_million_usd?: number;
  output_per_million_usd?: number;
}

export interface PricingTable {
  models: ModelPricing[];
  default_model: string;
  context_window_tokens: number;
  cache_read_ratio?: number;
  output_ratio?: number;
  avg_context_estimate?: number;
  follow_up_rate_default?: number;
  compression_ratio_outline?: number;
  compression_ratio_outline_plus?: number;
}

let cached: PricingTable | undefined;

export function loadPricing(): PricingTable {
  if (cached) return cached;
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const raw = readFileSync(join(pkgRoot, 'pricing.json'), 'utf8');
  cached = JSON.parse(raw) as PricingTable;
  return cached;
}

export function costModelFromPricing(overrides: Partial<CostModelConfig> = {}): CostModelConfig {
  const p = loadPricing();
  return {
    cache_read_ratio: p.cache_read_ratio ?? DEFAULT_COST_MODEL.cache_read_ratio,
    output_ratio: p.output_ratio ?? DEFAULT_COST_MODEL.output_ratio,
    avg_context_estimate: p.avg_context_estimate ?? DEFAULT_COST_MODEL.avg_context_estimate,
    avg_tool_output_estimate: DEFAULT_COST_MODEL.avg_tool_output_estimate,
    follow_up_rate: p.follow_up_rate_default ?? DEFAULT_COST_MODEL.follow_up_rate,
    compression_ratio_outline: p.compression_ratio_outline ?? DEFAULT_COST_MODEL.compression_ratio_outline,
    compression_ratio_outline_plus:
      p.compression_ratio_outline_plus ?? DEFAULT_COST_MODEL.compression_ratio_outline_plus,
    ...overrides,
  };
}

export function estimateUsd(savedTokens: number, modelId?: string): number {
  const pricing = loadPricing();
  const id = modelId ?? pricing.default_model;
  const model = pricing.models.find((m) => m.id === id) ?? pricing.models[0]!;
  return (savedTokens / 1_000_000) * model.input_per_million_usd;
}

/** Billed USD from session usage (fresh + cache-read + output at model rates). */
export function estimateSessionUsd(usage: SessionUsage, modelId?: string): number {
  const pricing = loadPricing();
  const id = modelId ?? pricing.default_model;
  const model = pricing.models.find((m) => m.id === id) ?? pricing.models[0]!;
  const cfg = costModelFromPricing();
  const cacheRate =
    model.cache_read_per_million_usd ?? model.input_per_million_usd * cfg.cache_read_ratio;
  const outputRate =
    model.output_per_million_usd ?? model.input_per_million_usd * cfg.output_ratio;
  return (
    (usage.fresh_input / 1_000_000) * model.input_per_million_usd +
    (usage.cache_read / 1_000_000) * cacheRate +
    (usage.output / 1_000_000) * outputRate
  );
}

export function clearPricingCache(): void {
  cached = undefined;
}
