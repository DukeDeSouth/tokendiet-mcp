/**
 * R5 v3: intra-session code navigation — outline, symbol drill-down, re-reads.
 * Run: npm run dogfood:r5
 */
import {
  assertWorkspaceFile,
  benchReadMode,
  benchRun,
  makeBenchContext,
  summarize,
  workspaceRoot,
} from './dogfood-lib.js';

const ROOT = workspaceRoot();

const READS = [
  'src/tools/read.ts',
  'src/pipeline/ast/extract.ts',
  'src/pipeline/transforms/html.ts',
  'src/tools/search.ts',
] as const;

async function main() {
  for (const p of READS) assertWorkspaceFile(ROOT, p);

  const ctx = makeBenchContext(ROOT);
  const ops = [];

  for (const path of READS) {
    ops.push(await benchReadMode(ctx, path, 'outline', `outline ${path}`));
  }
  ops.push(await benchReadMode(ctx, 'src/tools/read.ts', 'symbol', 'symbol handleRead', 'handleRead'));
  ops.push(await benchReadMode(ctx, 'src/pipeline/ast/extract.ts', 'symbol', 'symbol extractCodeView', 'extractCodeView'));
  ops.push(await benchReadMode(ctx, 'src/tools/read.ts', 'outline', 're-read read.ts outline'));
  ops.push(await benchRun(ctx, 'npm test -- --reporter=dot 2>&1 | tail -n 20', 'run npm test tail'));

  const result = summarize('R5-code-intra-v3', ops, ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
