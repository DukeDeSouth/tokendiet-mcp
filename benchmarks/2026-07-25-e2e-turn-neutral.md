# E2E benchmark — Turn-neutral architecture (v0.7.0)

**Date:** 2026-07-25
**Harness version:** e2e-v1
**Release ready:** ✅

## Cost model (calibrated)

| Parameter | Value |
|-----------|-------|
| E_turn (input-eq) | 8449.396226415094 |
| T_full (BPE) | 2983 |
| Calibrated from | user A/B session |

## User A/B (external, real session)

| Metric | Baseline | TokenDiet v1 |
|--------|----------|--------------|
| API turns | 48 | 212 |
| Fresh input | 407,955 | 334,165 |
| Cache read | 2,591,232 | 11,644,672 |
| Output | 21,006 | 41,961 |
| Billed cost | $26.7976 | $60.7324 |
| **Turns ratio** | 1.0 | **4.416666666666667** |
| **Cost ratio** | 1.0 | **2.3618407235414325** |

> v1 FAIL is **expected** and validates the harness.

## N-corpus offline simulation

Files measured: 26
Median BPE: 802 | Max: 4182 | ≥800 tok: 13 | ≥T_full: 2

| Policy | Est. turns | Follow-up rate | Cost (input-eq) |
|--------|------------|----------------|-----------------|
| baseline | 36 | 0 | 674934 |
| tokendiet_v1 | 52.5 | 0.25 | 913147 |
| tokendiet_v2_phase1 | 20 | 0 | 369962 |
| tokendiet_v2_phase2 | 18.2 | 0 | 325245 |

## Gate checks

| Check | Pass | Actual | Threshold | Note |
|-------|------|--------|-----------|------|
| user_ab_turns_ratio | ❌ | 4.42 | ≤ 1 | Expected FAIL on v1 — documents the problem |
| user_ab_cost_ratio | ❌ | 2.36 | ≤ 1 | Expected FAIL on v1 (+126.6% billed) |
| harness_validity_v1_documented_fail | ✅ | v1 fails as expected | v1 must FAIL |  |
| sim_v2_phase1_turns_ratio | ✅ | 0.42 | ≤ 1 |  |
| sim_v2_phase1_cost_ratio | ✅ | 0.41 | ≤ 1 |  |
| sim_v2_phase1_follow_up_rate | ✅ | 0 | < 0.1 |  |
| sim_v2_phase2_turns_ratio | ✅ | 0.38 | ≤ 1 |  |
| sim_v2_phase2_cost_ratio | ✅ | 0.36 | ≤ 1 |  |
| sim_v2_phase2_follow_up_rate | ✅ | 0 | < 0.1 |  |
| H_test_logs_payload_saved | ✅ | 56 | ≥ 30% | Payload diagnostic — run compression still valuable |
| shrink_playwright_sim_saved | ✅ | 100 | ≥ 50% | Shrink proxy — 0 extra agent turns |

**Note:** E2E gate PASS — turn-neutral v0.7.0

## Methodology

- User A/B: real Codex session data (external feedback 2026-07-25).
- N-corpus simulation: BPE counts from exploration file manifest + policy turn model.
- H-corpus: dogfood R3 payload saved % (diagnostic, not release gate for v0.6).
- Release gate for 0.7.0: `sim_v2_phase2` turns/cost ≤ 1.0; shrink proxy sim ≥ 50% saved.

