import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext, type AppContext } from '../src/context.js';
import { RefStore } from '../src/storage/refStore.js';
import { Storage } from '../src/storage/sqlite.js';
import { handleRead, handleReadSingle } from '../src/tools/read.js';
import { handleExpand } from '../src/tools/expand.js';
import { countTokens } from '../src/tokenize/counter.js';
import {
  aggregateBatchCompression,
  normalizeTargets,
  packIntoBudget,
} from '../src/lib/readBatch.js';

const pkgRoot = join(import.meta.dirname, '..');

function makeCtx(workspace: string): AppContext {
  const base = join(workspace, '.td');
  mkdirSync(base, { recursive: true });
  return createContext({
    workspace,
    storage: new Storage(':memory:'),
    refStore: new RefStore(base),
  });
}

function isBatchResponse(
  res: Awaited<ReturnType<typeof handleRead>>,
): res is { results: unknown[]; batch_compression: { tokens_in: number } } {
  return 'results' in res && Array.isArray(res.results);
}

describe('read batch', () => {
  let dir: string;
  let ctx: AppContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-batch-'));
    ctx = makeCtx(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('normalizeTargets maps single path to one target', () => {
    const targets = normalizeTargets({ path: 'a.ts', mode: 'auto' });
    expect(targets).toEqual([{ path: 'a.ts', mode: 'auto' }]);
  });

  it('reads 12 R4 pipeline files in one batch call', async () => {
    const paths = [
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
    ];
    const batchCtx = makeCtx(pkgRoot);
    const res = await handleRead(batchCtx, {
      targets: paths.map((path) => ({ path, mode: 'auto' as const })),
    });
    expect(isBatchResponse(res)).toBe(true);
    if (!isBatchResponse(res)) return;
    expect(res.results).toHaveLength(12);
    expect(res.batch_compression.tokens_in).toBeGreaterThan(0);
    expect(res.batch_compression.tokens_out).toBeGreaterThan(0);
    for (const p of paths) {
      expect(res.results.some((r) => r.path.endsWith(p.replace(/^\//, '')))).toBe(true);
    }
  });

  it('single path keeps legacy response shape (not wrapped in results)', async () => {
    writeFileSync(join(dir, 'one.txt'), 'hello batch');
    const res = await handleRead(ctx, { path: 'one.txt', mode: 'auto' });
    expect(isBatchResponse(res)).toBe(false);
    if (isBatchResponse(res)) return;
    expect(res.status).toBe('full');
    expect(res.content).toBe('hello batch');
  });

  it('batch response includes batch_compression aggregate', async () => {
    writeFileSync(join(dir, 'a.txt'), 'aaa');
    writeFileSync(join(dir, 'b.txt'), 'bbbb');
    const res = await handleRead(ctx, {
      targets: [{ path: 'a.txt' }, { path: 'b.txt' }],
    });
    expect(isBatchResponse(res)).toBe(true);
    if (!isBatchResponse(res)) return;
    expect(res.results).toHaveLength(2);
    const agg = aggregateBatchCompression(res.results);
    expect(res.batch_compression).toEqual(agg);
  });

  it('budget_tokens degrades oversized batch and lists degraded paths', async () => {
    const body = Array.from(
      { length: 60 },
      (_, i) => `export function fn${i}(a: number, b: number): number { return a + b + ${i}; }\n`,
    ).join('');
    writeFileSync(join(dir, 'big1.ts'), body);
    writeFileSync(join(dir, 'big2.ts'), body.replace('fn0', 'fnX'));
    const ctxLoose = createContext({
      workspace: dir,
      storage: ctx.storage,
      refStore: ctx.refStore,
      sessionId: ctx.sessionId,
      servedThisSession: ctx.servedThisSession,
      codeOutlineThreshold: 50,
      smallFileTokenThreshold: 10,
    });
    const res = await handleRead(ctxLoose, {
      targets: [{ path: 'big1.ts', mode: 'full' }, { path: 'big2.ts', mode: 'full' }],
      budget_tokens: 100,
    });
    expect(isBatchResponse(res)).toBe(true);
    if (!isBatchResponse(res)) return;
    expect(res.batch_compression.tokens_out).toBeLessThanOrEqual(100);
    expect(res.degraded?.length).toBeGreaterThan(0);
  });
});

describe('expand batch', () => {
  it('single ref keeps legacy shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-expand-batch-'));
    const ctx = makeCtx(dir);
    const ref = ctx.refStore.put('payload-a');
    const res = handleExpand(ctx, { ref });
    expect('content' in res && res.content).toBe('payload-a');
    expect('results' in res).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refs[] returns batch results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-expand-batch-'));
    const ctx = makeCtx(dir);
    const a = ctx.refStore.put('alpha');
    const b = ctx.refStore.put('beta');
    const res = handleExpand(ctx, { refs: [a, b] });
    expect('results' in res && res.results).toHaveLength(2);
    if (!('results' in res)) return;
    expect(res.results[0]).toMatchObject({ content: 'alpha' });
    expect(res.results[1]).toMatchObject({ content: 'beta' });
    expect(res.batch_compression.tokens_in).toBe(
      countTokens('alpha') + countTokens('beta'),
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('readBatch helpers', () => {
  it('packIntoBudget reduces total tokens_out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-pack-'));
    const ctx = makeCtx(dir);
    const line = 'export const x = 1;\n';
    writeFileSync(join(dir, 'f1.ts'), line.repeat(200));
    writeFileSync(join(dir, 'f2.ts'), line.repeat(200));
    const targets = [{ path: 'f1.ts', mode: 'full' as const }, { path: 'f2.ts', mode: 'full' as const }];
    const r1 = await handleReadSingle(ctx, targets[0]!);
    const r2 = await handleReadSingle(ctx, targets[1]!);
    const packed = await packIntoBudget(ctx, targets, [r1, r2], 50, handleReadSingle);
    const total = packed.results.reduce((s, r) => s + r.compression.tokens_out, 0);
    expect(total).toBeLessThanOrEqual(50);
    rmSync(dir, { recursive: true, force: true });
  });
});
