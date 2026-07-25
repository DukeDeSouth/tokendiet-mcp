/**
 * Shrink proxy dogfood — simulates playwright-scale browser_snapshot payloads.
 * Run: npm run dogfood:shrink
 */
import { compressCallToolResult } from '../src/shrink/compressResult.js';
import { createShrinkContext } from '../src/shrink/context.js';
import { countTokens } from '../src/tokenize/counter.js';

function snapshotFixture(lines = 600): string {
  return Array.from(
    { length: lines },
    (_, i) =>
      `- button "Submit ${i}" [ref=e${i}]\n  - generic: Click me ${i} with repeated DOM text for YAML snapshot volume`,
  ).join('\n');
}

function main() {
  const ctx = createShrinkContext('playwright');
  const text = snapshotFixture();
  const baseline = countTokens(text);

  const { result, stats } = compressCallToolResult(
    { content: [{ type: 'text', text }] },
    'browser_snapshot',
    ctx,
  );

  const outText = result.content[0]?.type === 'text' ? result.content[0].text : '';
  const compressed = countTokens(outText);
  const savedPct = baseline ? Math.round(((baseline - compressed) / baseline) * 100) : 0;

  const summary = {
    scenario: 'shrink-playwright-snapshot-sim',
    baseline_tokens: baseline,
    compressed_tokens: compressed,
    saved_tokens: stats.saved,
    saved_pct: savedPct,
    blocks_compressed: stats.blocks_compressed,
    turns_added: 0,
    checks: {
      compressed: stats.blocks_compressed === 1,
      saved_gt_50pct: savedPct >= 50,
      has_ref_marker: outText.includes('[compressed by tokendiet — expand('),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.checks.saved_gt_50pct) process.exit(1);
}

main();
