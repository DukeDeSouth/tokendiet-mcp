import type { AppContext } from '../context.js';
import { estimateUsd, loadPricing } from '../lib/pricing.js';

function withSavedPct(totals: {
  tokens_in: number;
  tokens_out: number;
  saved: number;
  calls: number;
}) {
  return {
    ...totals,
    saved_pct: totals.tokens_in > 0 ? Math.round((totals.saved / totals.tokens_in) * 100) : 0,
    estimated_usd_saved: estimateUsd(totals.saved),
  };
}

export function handleStats(ctx: AppContext) {
  const session = ctx.storage.getSessionTotals(ctx.sessionId);
  const month = ctx.storage.getMonthTotals();
  const allTime = ctx.storage.getAllTimeTotals();
  const pricing = loadPricing();
  const model = pricing.models.find((m) => m.id === pricing.default_model)!;

  const windowUsedPct =
    pricing.context_window_tokens > 0
      ? Math.round((session.tokens_out / pricing.context_window_tokens) * 100)
      : 0;

  return {
    session: withSavedPct(session),
    month: withSavedPct(month),
    all_time: withSavedPct(allTime),
    pricing_model: model.label,
    context_window_tokens: pricing.context_window_tokens,
    context_window_used_pct: windowUsedPct,
  };
}
