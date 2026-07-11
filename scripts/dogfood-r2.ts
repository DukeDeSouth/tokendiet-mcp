/**
 * R2 replay: audit pipeline verify scenario (post P0/P1 fixes).
 * Run: npm run dogfood:r2
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertWorkspaceFile,
  benchRead,
  benchRun,
  makeBenchContext,
  summarize,
  workspaceRoot,
  type BenchOp,
} from './dogfood-lib.js';

const ROOT = workspaceRoot();

const READS = [
  'package-lock.json',
  'src/pipeline/verify.ts',
  'tests/verify.test.ts',
  'src/pipeline/pipeline.ts',
  'src/pipeline/transforms/log.ts',
  'src/tools/read.ts',
  'tests/pipeline.test.ts',
] as const;

function assertR2Files(): void {
  for (const p of READS) assertWorkspaceFile(ROOT, p);
}

async function runColdPass(ctx: ReturnType<typeof makeBenchContext>): Promise<BenchOp[]> {
  const ops: BenchOp[] = [];
  for (const path of READS) {
    ops.push(await benchRead(ctx, path));
  }

  const testPath = 'tests/verify.test.ts';
  const original = readFileSync(join(ROOT, testPath), 'utf8');
  try {
    writeFileSync(join(ROOT, testPath), `${original}\n// dogfood-r2 touch\n`);
    ops.push(await benchRead(ctx, testPath, 'read verify.test.ts (changed)'));
  } finally {
    writeFileSync(join(ROOT, testPath), original);
  }

  ops.push(await benchRun(ctx, 'wc -l src/pipeline/*.ts', 'run wc pipeline'));
  ops.push(await benchRun(ctx, 'npm test -- --reporter=verbose 2>&1 | tail -n 80', 'run npm test verbose'));
  ops.push(await benchRun(ctx, 'npm run build && ls -la dist/index.js', 'run build+ls'));
  ops.push(
    await benchRun(
      ctx,
      `node -e "for(let i=0;i<80;i++) console.log('2026-07-11T10:00:'+String(i).padStart(2,'0')+'Z INFO unique-'+i+' ok')"`,
      'run log varying ×80',
    ),
  );
  ops.push(
    await benchRun(
      ctx,
      `node -e "for(let i=0;i<100;i++) console.log('2026-07-11T10:00:00Z INFO heartbeat ok')"`,
      'run log identical ×100',
    ),
  );
  return ops;
}

async function main() {
  assertR2Files();

  const coldCtx = makeBenchContext(ROOT);
  const coldOps = await runColdPass(coldCtx);
  const cold = summarize('R2-cold-v2', coldOps, coldCtx);

  const warmCtx = makeBenchContext(ROOT);
  const warmOps: BenchOp[] = [];
  for (const path of READS) {
    warmOps.push(await benchRead(warmCtx, path));
  }
  warmOps.push(await benchRead(warmCtx, 'package-lock.json', 're-read package-lock.json'));
  warmOps.push(await benchRead(warmCtx, 'src/pipeline/verify.ts', 're-read verify.ts'));
  warmOps.push(await benchRun(warmCtx, 'npm test -- --reporter=verbose 2>&1 | tail -n 80', 'run npm test verbose'));
  warmOps.push(
    await benchRun(
      warmCtx,
      `node -e "for(let i=0;i<100;i++) console.log('2026-07-11T10:00:00Z INFO heartbeat ok')"`,
      'run log identical ×100',
    ),
  );
  const intra = summarize('R2-intra-session-v2', warmOps, warmCtx);

  console.log(JSON.stringify({ cold, intra }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
