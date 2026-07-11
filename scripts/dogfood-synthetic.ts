/**
 * Synthetic dogfood harness: 50 read + 10 run operations with BPE accounting.
 * Run: npm run dogfood:synthetic
 */
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext } from '../src/context.js';
import { RefStore } from '../src/storage/refStore.js';
import { Storage } from '../src/storage/sqlite.js';
import { handleRead } from '../src/tools/read.js';
import { handleRun } from '../src/tools/run.js';
import { countTokens } from '../src/tokenize/counter.js';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'tokendiet-dogfood-'));
  const ctx = createContext({
    workspace: dir,
    storage: new Storage(':memory:'),
    refStore: new RefStore(join(dir, '.td')),
  });

  let baselineTokens = 0;
  let compressedTokens = 0;

  mkdirSync(join(dir, 'logs'), { recursive: true });
  for (let i = 0; i < 50; i++) {
    const content = `2026-07-11T10:00:${String(i % 60).padStart(2, '0')}Z INFO tick ${i}\n`.repeat(80);
    const rel = `logs/file-${i}.log`;
    writeFileSync(join(dir, rel), content);
    baselineTokens += countTokens(content);
    const res = await handleRead(ctx, { path: rel, mode: 'auto' });
    if ('content' in res && typeof res.content === 'string') {
      compressedTokens += countTokens(res.content);
    } else if (res.status === 'unchanged') {
      compressedTokens += 0;
    }
  }

  for (let i = 0; i < 10; i++) {
    const res = await handleRun(ctx, { command: `printf '%s' "$(yes PASS-${i} | head -n 200)"` });
    baselineTokens += res.compression.tokens_in;
    compressedTokens += res.compression.tokens_out;
  }

  const saved = baselineTokens - compressedTokens;
  const savedPct = baselineTokens ? Math.round((saved / baselineTokens) * 100) : 0;
  const stats = ctx.storage.getSessionTotals(ctx.sessionId);

  console.log(JSON.stringify({
    scenario: 'synthetic-50-read-10-run',
    baseline_tokens: baselineTokens,
    compressed_tokens: compressedTokens,
    saved_tokens: saved,
    saved_pct: savedPct,
    storage_totals: stats,
  }, null, 2));

  rmSync(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
