import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ModelPricing {
  id: string;
  label: string;
  input_per_million_usd: number;
}

export interface PricingTable {
  models: ModelPricing[];
  default_model: string;
  context_window_tokens: number;
}

let cached: PricingTable | undefined;

export function loadPricing(): PricingTable {
  if (cached) return cached;
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const raw = readFileSync(join(pkgRoot, 'pricing.json'), 'utf8');
  cached = JSON.parse(raw) as PricingTable;
  return cached;
}

export function estimateUsd(savedTokens: number, modelId?: string): number {
  const pricing = loadPricing();
  const id = modelId ?? pricing.default_model;
  const model = pricing.models.find((m) => m.id === id) ?? pricing.models[0]!;
  return (savedTokens / 1_000_000) * model.input_per_million_usd;
}
