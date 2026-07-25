import type { AppContext } from '../context.js';
import { estimateTurnCostInputEq } from '../lib/costModel.js';
import { costModelFromPricing, estimateUsd, loadPricing } from '../lib/pricing.js';

function withSavedPct(totals: {
  tokens_in: number;
  tokens_out: number;
  saved: number;
  calls: number;
  follow_up_calls?: number;
}) {
  return {
    ...totals,
    saved_pct: totals.tokens_in > 0 ? Math.round((totals.saved / totals.tokens_in) * 100) : 0,
    estimated_usd_saved: estimateUsd(totals.saved),
  };
}

function withEconomics(
  totals: ReturnType<typeof withSavedPct>,
  followUpCalls: number,
  cfg: ReturnType<typeof costModelFromPricing>,
) {
  const eTurn = estimateTurnCostInputEq(cfg);
  const turnsAddedEstimate = followUpCalls;
  const netTokensEstimate = totals.saved - turnsAddedEstimate * eTurn;
  return {
    ...totals,
    follow_up_calls: followUpCalls,
    follow_up_rate: totals.calls > 0 ? Math.round((followUpCalls / totals.calls) * 1000) / 1000 : 0,
    turns_added_estimate: turnsAddedEstimate,
    net_tokens_estimate: Math.round(netTokensEstimate),
    net_usd_estimate: Math.round(estimateUsd(netTokensEstimate) * 10000) / 10000,
  };
}

export function handleStats(ctx: AppContext) {
  const session = ctx.storage.getSessionTotals(ctx.sessionId);
  const month = ctx.storage.getMonthTotals();
  const allTime = ctx.storage.getAllTimeTotals();
  const pricing = loadPricing();
  const model = pricing.models.find((m) => m.id === pricing.default_model)!;
  const cfg = ctx.costModel;

  const sessionFollowUps = session.follow_up_calls ?? ctx.storage.getSessionFollowUpCount(ctx.sessionId);

  const windowUsedPct =
    pricing.context_window_tokens > 0
      ? Math.round((session.tokens_out / pricing.context_window_tokens) * 100)
      : 0;

  return {
    session: withEconomics(withSavedPct(session), sessionFollowUps, cfg),
    month: withSavedPct(month),
    all_time: withSavedPct(allTime),
    pricing_model: model.label,
    context_window_tokens: pricing.context_window_tokens,
    context_window_used_pct: windowUsedPct,
    cost_model: {
      e_turn_input_eq: Math.round(estimateTurnCostInputEq(cfg)),
      t_full_bpe: ctx.codeOutlineThreshold,
      cache_read_ratio: cfg.cache_read_ratio,
      output_ratio: cfg.output_ratio,
    },
    note: 'net_* fields subtract estimated turn cost (E_turn) for follow-up MCP calls; payload saved alone can mislead in cached agent loops',
  };
}
