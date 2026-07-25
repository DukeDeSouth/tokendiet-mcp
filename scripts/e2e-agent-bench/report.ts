/**
 * Markdown report generator for E2E gate output.
 */

interface GateResult {
  version: string;
  date: string;
  cost_model: { e_turn_input_eq: number; t_full_bpe: number; calibrated_from: string };
  user_ab: {
    baseline: Record<string, unknown>;
    tokendiet_v1: Record<string, unknown> & { metrics?: Record<string, number> };
    turns_ratio: number;
    cost_ratio: number;
  };
  n_corpus_simulation: {
    files_measured: number;
    token_stats: Record<string, number>;
    policies: Record<string, unknown>;
  };
  checks: Array<{ name: string; pass: boolean; actual: number | string; threshold: string; note?: string }>;
  pass: boolean;
  release_ready: boolean;
  note: string;
}

export function generateMarkdownReport(result: GateResult): string {
  const lines: string[] = [
    '# E2E benchmark — Turn-neutral architecture (v0.7.0)',
    '',
    `**Date:** ${result.date}`,
    `**Harness version:** ${result.version}`,
    `**Release ready:** ${result.release_ready ? '✅' : '❌'}`,
    '',
    '## Cost model (calibrated)',
    '',
    `| Parameter | Value |`,
    `|-----------|-------|`,
    `| E_turn (input-eq) | ${result.cost_model.e_turn_input_eq} |`,
    `| T_full (BPE) | ${result.cost_model.t_full_bpe} |`,
    `| Calibrated from | ${result.cost_model.calibrated_from} |`,
    '',
    '## User A/B (external, real session)',
    '',
    `| Metric | Baseline | TokenDiet v1 |`,
    `|--------|----------|--------------|`,
  ];

  const b = result.user_ab.baseline as { turns: number; fresh_input: number; cache_read: number; output: number; billed_cost_usd?: number };
  const t = result.user_ab.tokendiet_v1 as typeof b;
  lines.push(`| API turns | ${b.turns} | ${t.turns} |`);
  lines.push(`| Fresh input | ${b.fresh_input.toLocaleString()} | ${t.fresh_input.toLocaleString()} |`);
  lines.push(`| Cache read | ${b.cache_read.toLocaleString()} | ${t.cache_read.toLocaleString()} |`);
  lines.push(`| Output | ${b.output.toLocaleString()} | ${t.output.toLocaleString()} |`);
  lines.push(`| Billed cost | $${b.billed_cost_usd} | $${t.billed_cost_usd} |`);
  lines.push(`| **Turns ratio** | 1.0 | **${result.user_ab.turns_ratio}** |`);
  lines.push(`| **Cost ratio** | 1.0 | **${result.user_ab.cost_ratio}** |`);
  lines.push('');
  lines.push('> v1 FAIL is **expected** and validates the harness.');
  lines.push('');

  const ts = result.n_corpus_simulation.token_stats;
  lines.push('## N-corpus offline simulation');
  lines.push('');
  lines.push(`Files measured: ${result.n_corpus_simulation.files_measured}`);
  lines.push(`Median BPE: ${ts.median} | Max: ${ts.max} | ≥800 tok: ${ts.files_gte_800} | ≥T_full: ${ts.files_gte_t_full}`);
  lines.push('');

  const policies = result.n_corpus_simulation.policies as Record<
    string,
    { estimated_turns: number; follow_up_rate: number; projected_cost_input_eq: number }
  >;
  lines.push('| Policy | Est. turns | Follow-up rate | Cost (input-eq) |');
  lines.push('|--------|------------|----------------|-----------------|');
  for (const [name, p] of Object.entries(policies)) {
    lines.push(`| ${name} | ${p.estimated_turns} | ${p.follow_up_rate} | ${Math.round(p.projected_cost_input_eq)} |`);
  }
  lines.push('');

  lines.push('## Gate checks');
  lines.push('');
  lines.push('| Check | Pass | Actual | Threshold | Note |');
  lines.push('|-------|------|--------|-----------|------|');
  for (const c of result.checks) {
    lines.push(
      `| ${c.name} | ${c.pass ? '✅' : '❌'} | ${c.actual} | ${c.threshold} | ${c.note ?? ''} |`,
    );
  }
  lines.push('');
  lines.push(`**Note:** ${result.note}`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('- User A/B: real Codex session data (external feedback 2026-07-25).');
  lines.push('- N-corpus simulation: BPE counts from exploration file manifest + policy turn model.');
  lines.push('- H-corpus: dogfood R3 payload saved % (diagnostic, not release gate for v0.6).');
  lines.push('- Release gate for 0.7.0: `sim_v2_phase2` turns/cost ≤ 1.0; shrink proxy sim ≥ 50% saved.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}
