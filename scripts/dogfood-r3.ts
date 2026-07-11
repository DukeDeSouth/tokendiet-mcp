/**
 * R3 replay: test/build-heavy session.
 * Run: npm run dogfood:r3
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
  'tests/tools.test.ts',
  'tests/storage.test.ts',
  'tests/pipeline.test.ts',
  'tests/verify.test.ts',
  'src/tools/run.ts',
] as const;

async function main() {
  for (const p of READS) assertWorkspaceFile(ROOT, p);

  const ctx = makeBenchContext(ROOT);
  const ops = [];
  for (const path of READS) {
    ops.push(await benchRead(ctx, path));
  }
  ops.push(await benchRun(ctx, 'npm test -- --reporter=verbose 2>&1', 'run npm test verbose'));
  ops.push(await benchRun(ctx, 'npm run build 2>&1', 'run npm run build'));
  ops.push(await benchRead(ctx, 'tests/tools.test.ts', 're-read tools.test.ts'));

  const result = summarize('R3-test-build-v2', ops, ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
