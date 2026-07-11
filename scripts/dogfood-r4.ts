/**
 * R4 v3: cold-first code navigation — outline reads on pipeline/tools sources.
 * Run: npm run dogfood:r4
 */
import {
  assertWorkspaceFile,
  benchReadMode,
  makeBenchContext,
  summarize,
  workspaceRoot,
} from './dogfood-lib.js';

const ROOT = workspaceRoot();

const OUTLINE_READS = [
  'src/pipeline/pipeline.ts',
  'src/pipeline/verify.ts',
  'src/pipeline/verifyHtml.ts',
  'src/pipeline/transforms/html.ts',
  'src/pipeline/ast/extract.ts',
  'src/pipeline/ast/lang/typescript.ts',
  'src/pipeline/ast/lang/python.ts',
  'src/tools/read.ts',
  'src/tools/search.ts',
  'src/tools/fetch.ts',
  'src/lib/search/compress.ts',
  'tests/tools.test.ts',
] as const;

async function main() {
  for (const p of OUTLINE_READS) assertWorkspaceFile(ROOT, p);

  const ctx = makeBenchContext(ROOT);
  const ops = [];
  for (const path of OUTLINE_READS) {
    ops.push(await benchReadMode(ctx, path, 'outline', `outline ${path}`));
  }

  const result = summarize('R4-code-cold-v3', ops, ctx);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
