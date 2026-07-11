/**
 * R1 replay: agent planning session (reads + one test run).
 * Run: npm run dogfood:r1
 */
import {
  assertWorkspaceFile,
  benchRead,
  benchRun,
  makeBenchContext,
  summarize,
  workspaceRoot,
} from './dogfood-lib.js';

const ROOT = workspaceRoot();

const READS = [
  'docs/FIX_PLAN.md',
  'src/context.ts',
  'src/tools/read.ts',
  'src/tools/stats.ts',
  'src/storage/sqlite.ts',
  'benchmarks/2026-07-11-dogfood.md',
] as const;

async function main() {
  for (const p of READS) assertWorkspaceFile(ROOT, p);

  const ctx = makeBenchContext(ROOT);
  const ops = [];
  for (const path of READS) {
    ops.push(await benchRead(ctx, path));
  }
  ops.push(await benchRun(ctx, 'npm test 2>&1 | tail -n 30', 'run npm test'));
  ops.push(await benchRead(ctx, 'docs/FIX_PLAN.md', 're-read FIX_PLAN.md'));

  const result = summarize('R1-agent-planning-v2', ops, ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
