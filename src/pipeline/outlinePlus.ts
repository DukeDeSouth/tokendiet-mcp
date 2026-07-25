import { outlineBreakEvenThreshold, type CostModelConfig } from '../lib/costModel.js';
import { DEFAULT_COST_MODEL } from '../lib/costModel.js';
import type { OutlineItem } from './ast/types.js';
import { countTokens } from '../tokenize/counter.js';
import type { Encoding } from '../types.js';

/** Max BPE tokens per function body included inline in outline+. */
export function outlinePlusBodyBudget(cfg: CostModelConfig = DEFAULT_COST_MODEL): number {
  const tFull = outlineBreakEvenThreshold(cfg);
  return Math.min(200, Math.floor(tFull * 0.1));
}

export function functionBodySource(source: string, item: OutlineItem): string | null {
  if (item.kind !== 'function' && item.kind !== 'method') return null;
  const text = source.slice(item.startIndex, item.endIndex);
  const brace = text.indexOf('{');
  if (brace === -1) return null;
  return text.slice(brace).trim();
}

export function shouldIncludeBody(body: string, budget: number, encoding: Encoding): boolean {
  if (!body.trim()) return false;
  return countTokens(body, encoding) <= budget;
}
