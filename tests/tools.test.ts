import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext, type AppContext } from '../src/context.js';
import { RefStore } from '../src/storage/refStore.js';
import { Storage } from '../src/storage/sqlite.js';
import { handleRead } from '../src/tools/read.js';
import { handleExpand } from '../src/tools/expand.js';
import { handleStats } from '../src/tools/stats.js';
import { handleRun } from '../src/tools/run.js';
import { countTokens } from '../src/tokenize/counter.js';

function makeCtx(workspace: string): AppContext {
  const base = join(workspace, '.td');
  mkdirSync(base, { recursive: true });
  return createContext({
    workspace,
    storage: new Storage(':memory:'),
    refStore: new RefStore(base),
  });
}

describe('read tool', () => {
  let dir: string;
  let ctx: AppContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-read-'));
    ctx = makeCtx(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns full content for small files', async () => {
    writeFileSync(join(dir, 'tiny.txt'), 'hello');
    const res = await handleRead(ctx, { path: 'tiny.txt', mode: 'auto' });
    expect(res.status).toBe('full');
    if (res.status === 'full') {
      expect(res.content).toBe('hello');
      expect(res.compression.saved).toBe(0);
    }
  });

  it('compresses large repetitive logs', async () => {
    const line = '2026-07-11T10:00:00Z INFO heartbeat ok\n';
    writeFileSync(join(dir, 'app.log'), line.repeat(300));
    const res = await handleRead(ctx, { path: 'app.log', mode: 'auto' });
    expect(res.status).toBe('compressed');
    if (res.status === 'compressed') {
      expect(res.compression.saved).toBeGreaterThan(0);
      expect(res.content).toContain('×');
    }
  });

  it('returns unchanged on second read with same hash', async () => {
    writeFileSync(join(dir, 'stable.log'), 'x\n'.repeat(400));
    await handleRead(ctx, { path: 'stable.log', mode: 'auto' });
    const res = await handleRead(ctx, { path: 'stable.log', mode: 'auto' });
    expect(res.status).toBe('unchanged');
    expect(res.compression.saved).toBeGreaterThan(0);
  });

  it('returns diff when change is worthwhile vs full file', async () => {
    writeFileSync(join(dir, 'mut.log'), 'a\n'.repeat(400));
    await handleRead(ctx, { path: 'mut.log', mode: 'auto' });
    const rewritten = Array.from({ length: 400 }, (_, i) => `line ${i} completely rewritten xyz\n`).join('');
    writeFileSync(join(dir, 'mut.log'), rewritten);
    const res = await handleRead(ctx, { path: 'mut.log', mode: 'auto' });
    expect(res.status).toBe('diff');
    if (res.status === 'diff') expect(res.content).toContain('+line');
  });

  it('falls back to compressed when diff would cost more than the file', async () => {
    writeFileSync(join(dir, 'rewrite.log'), 'a\n'.repeat(400));
    await handleRead(ctx, { path: 'rewrite.log', mode: 'auto' });
    writeFileSync(join(dir, 'rewrite.log'), `${'a\n'.repeat(399)}b\n`);
    const res = await handleRead(ctx, { path: 'rewrite.log', mode: 'auto' });
    expect(res.status).toBe('compressed');
    if (res.status === 'compressed') {
      expect(res.content.length).toBeGreaterThan(0);
    }
  });

  it('records honest negative saved when diff is allowed but costs more', async () => {
    writeFileSync(join(dir, 'tiny.log'), 'short\n');
    const ctxLoose = createContext({
      workspace: dir,
      storage: ctx.storage,
      refStore: ctx.refStore,
      sessionId: ctx.sessionId,
      servedThisSession: ctx.servedThisSession,
      diffWorthwhileRatio: 3,
      smallFileTokenThreshold: 1,
    });
    await handleRead(ctxLoose, { path: 'tiny.log', mode: 'auto' });
    writeFileSync(join(dir, 'tiny.log'), 'totally different and longer replacement line\n');
    const res = await handleRead(ctxLoose, { path: 'tiny.log', mode: 'auto' });
    expect(res.status).toBe('diff');
    expect(res.compression.saved).toBeLessThan(0);
    expect(handleStats(ctxLoose).session.saved).toBeLessThan(0);
  });

  it('does not write to read_cache on read', async () => {
    writeFileSync(join(dir, 'no-cache.log'), 'z\n'.repeat(400));
    await handleRead(ctx, { path: 'no-cache.log', mode: 'auto' });
    expect(ctx.storage.getReadCache(join(dir, 'no-cache.log'))).toBeUndefined();
  });

  it('does not return unchanged when SQLite has hash but agent never saw file', async () => {
    writeFileSync(join(dir, 'cached.log'), 'y\n'.repeat(400));
    const base = join(dir, '.td');
    const storage = new Storage(':memory:');
    const refStore = new RefStore(base);
    const ctxA = createContext({ workspace: dir, storage, refStore, sessionId: 'a' });
    await handleRead(ctxA, { path: 'cached.log', mode: 'auto' });

    const ctxB = createContext({
      workspace: dir,
      storage,
      refStore,
      sessionId: 'b',
      servedThisSession: new Map(),
    });
    const res = await handleRead(ctxB, { path: 'cached.log', mode: 'auto' });
    expect(res.status).not.toBe('unchanged');
    expect('content' in res && res.content.length).toBeGreaterThan(0);
  });

  function largeTsModule(): string {
    const header = `import type { AppContext } from '../context.js';\n\n`;
    const fns = Array.from(
      { length: 60 },
      (_, i) => `export function compute${i}(a: number, b: number): number {\n  return a + b + ${i};\n}\n`,
    ).join('\n');
    return header + fns;
  }

  it('auto mode returns AST outline for large TypeScript files', async () => {
    writeFileSync(join(dir, 'big.ts'), largeTsModule());
    const ctxCode = createContext({
      workspace: dir,
      storage: ctx.storage,
      refStore: ctx.refStore,
      sessionId: ctx.sessionId,
      servedThisSession: ctx.servedThisSession,
      codeOutlineThreshold: 50,
      smallFileTokenThreshold: 10,
    });
    const res = await handleRead(ctxCode, { path: 'big.ts', mode: 'auto' });
    expect(res.status).toBe('compressed');
    if (res.status === 'compressed') {
      expect(res.read_mode).toBe('outline');
      expect(res.content).toContain('# outline');
      expect(res.content).toContain('export function compute0');
      expect(res.compression.saved).toBeGreaterThan(0);
    }
  });

  it('returns unchanged on second outline read with same hash', async () => {
    writeFileSync(join(dir, 'mod.ts'), largeTsModule());
    const ctxCode = createContext({
      workspace: dir,
      storage: ctx.storage,
      refStore: ctx.refStore,
      sessionId: ctx.sessionId,
      servedThisSession: ctx.servedThisSession,
      codeOutlineThreshold: 50,
      smallFileTokenThreshold: 10,
    });
    await handleRead(ctxCode, { path: 'mod.ts', mode: 'outline' });
    const res = await handleRead(ctxCode, { path: 'mod.ts', mode: 'outline' });
    expect(res.status).toBe('unchanged');
  });

  it('escalates from outline to full on same hash', async () => {
    writeFileSync(join(dir, 'esc.ts'), largeTsModule());
    const ctxCode = createContext({
      workspace: dir,
      storage: ctx.storage,
      refStore: ctx.refStore,
      sessionId: ctx.sessionId,
      servedThisSession: ctx.servedThisSession,
      codeOutlineThreshold: 50,
      smallFileTokenThreshold: 10,
    });
    await handleRead(ctxCode, { path: 'esc.ts', mode: 'outline' });
    const res = await handleRead(ctxCode, { path: 'esc.ts', mode: 'full' });
    expect(res.status).toBe('full');
    if (res.status === 'full') {
      expect(res.content).toContain('return a + b');
    }
  });

  it('symbol mode returns a single definition', async () => {
    writeFileSync(join(dir, 'sym.ts'), largeTsModule());
    const ctxCode = createContext({
      workspace: dir,
      storage: ctx.storage,
      refStore: ctx.refStore,
      sessionId: ctx.sessionId,
      servedThisSession: ctx.servedThisSession,
      codeOutlineThreshold: 50,
      smallFileTokenThreshold: 10,
    });
    const res = await handleRead(ctxCode, { path: 'sym.ts', mode: 'symbol', symbol: 'compute3' });
    expect(res.status).toBe('compressed');
    if (res.status === 'compressed') {
      expect(res.read_mode).toBe('symbol');
      expect(res.content).toContain('function compute3');
      expect(res.content).not.toContain('compute4');
    }
  });
});

describe('run tool', () => {
  it('compresses large command output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-run-'));
    const ctx = makeCtx(dir);
    const res = await handleRun(ctx, { command: 'printf "%s" "$(yes line | head -n 500)"' });
    expect(res.compression.saved).toBeGreaterThanOrEqual(0);
    expect(res.ref).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not classify git-log output as test_output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-run-'));
    const ctx = makeCtx(dir);
    const res = await handleRun(ctx, {
      command: 'printf "abc123 failed to deploy\\nline about error handling\\n"',
    });
    expect(res.content_type).toBe('log');
    expect(res.content).toContain('failed to deploy');
    expect(res.content).toContain('error handling');
    expect(res.omitted_lines).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies vitest output and reports omitted lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-run-'));
    const ctx = makeCtx(dir);
    const lines = [
      ...Array.from({ length: 15 }, (_, i) => ` ✓ tests/a.test.ts > case ${i} 1ms`),
      ' Test Files  1 passed (1)',
      '      Tests  15 passed (15)',
    ].join('\n');
    writeFileSync(join(dir, 'vitest-out.txt'), lines);
    const res = await handleRun(ctx, { command: 'cat vitest-out.txt' });
    expect(res.content_type).toBe('test_output');
    expect(res.omitted_lines).toBeGreaterThanOrEqual(15);
    expect(res.content).toContain(`[omitted ${res.omitted_lines} non-failure lines`);
    expect(res.content).toContain(`expand("${res.ref}")`);
    expect(res.compression.tokens_out).toBe(countTokens(res.content));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('expand tool', () => {
  it('retrieves stored content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-expand-'));
    const ctx = makeCtx(dir);
    const ref = ctx.refStore.put('full payload');
    const res = handleExpand(ctx, { ref });
    expect('content' in res && res.content).toBe('full payload');
    rmSync(dir, { recursive: true, force: true });
  });

  it('hints to re-read when ref is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-expand-'));
    const ctx = makeCtx(dir);
    const res = handleExpand(ctx, { ref: 'missing1' });
    expect('error' in res && res.error).toContain('ref expired; re-read the file');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('stats tool', () => {
  it('aggregates recorded stats for current session only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-stats-'));
    const ctx = makeCtx(dir);
    ctx.storage.recordStat(ctx.sessionId, 'read', 1000, 200, 800);
    const res = handleStats(ctx);
    expect(res.session.saved).toBe(800);
    expect(res.all_time.saved).toBe(800);
    expect(res.session.estimated_usd_saved).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not mix stats from another session on same database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokendiet-stats-'));
    const base = join(dir, '.td');
    mkdirSync(base, { recursive: true });
    const storage = new Storage(':memory:');
    const refStore = new RefStore(base);
    const ctxA = createContext({ workspace: dir, storage, refStore, sessionId: 'sess-a' });
    const ctxB = createContext({ workspace: dir, storage, refStore, sessionId: 'sess-b' });
    ctxA.storage.recordStat('sess-a', 'read', 1000, 100, 900);
    ctxB.storage.recordStat('sess-b', 'read', 200, 50, 150);
    expect(handleStats(ctxA).session.saved).toBe(900);
    expect(handleStats(ctxB).session.saved).toBe(150);
    expect(handleStats(ctxA).all_time.saved).toBe(1050);
    rmSync(dir, { recursive: true, force: true });
  });
});
