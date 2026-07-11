import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatSearchBaseline } from '../src/lib/search/baseline.js';
import { compressSearchMatches } from '../src/lib/search/compress.js';
import { searchFallback } from '../src/lib/search/fallback.js';
import { verifySearch } from '../src/lib/search/verifySearch.js';
import { createContext } from '../src/context.js';
import { RefStore } from '../src/storage/refStore.js';
import { Storage } from '../src/storage/sqlite.js';
import { handleSearch } from '../src/tools/search.js';
import { countTokens } from '../src/tokenize/counter.js';

describe('compressSearchMatches', () => {
  it('limits to 3 snippets per file and adds footer', () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({
      path: 'src/a.ts',
      line: i + 1,
      text: `line ${i}`,
    }));
    const out = compressSearchMatches(matches, 50);
    expect(out.shownMatches).toBe(3);
    expect(out.hiddenMatches).toBe(7);
    expect(out.content).toContain('src/a.ts:1:line 0');
    expect(out.content).toContain('[+7 more matches in 1 files]');
  });
});

describe('verifySearch', () => {
  it('passes honest compressed search output', () => {
    const matches = Array.from({ length: 20 }, (_, i) => ({
      path: `src/f${i % 3}.ts`,
      line: i + 1,
      text: `match ${i}`,
    }));
    const baseline = formatSearchBaseline(matches);
    const compressed = compressSearchMatches(matches, 6);
    const verdict = verifySearch(baseline, compressed.content, {
      totalMatches: matches.length,
      shownMatches: compressed.shownMatches,
      hiddenMatches: compressed.hiddenMatches,
      hiddenFiles: compressed.hiddenFiles,
      pathsInOutput: compressed.pathsInOutput,
    });
    expect(verdict.pass).toBe(true);
  });

  it('fails paths-preserved when path is missing from baseline', () => {
    const baseline = 'a.ts:1:foo';
    const compressed = 'missing.ts:1:foo';
    const verdict = verifySearch(baseline, compressed, {
      totalMatches: 1,
      shownMatches: 1,
      hiddenMatches: 0,
      hiddenFiles: 0,
      pathsInOutput: ['missing.ts'],
    });
    expect(verdict.failures.some((f) => f.rule === 'paths-preserved')).toBe(true);
  });
});

describe('searchFallback', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-search-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds regex matches in workspace files', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export function handleRead() {}\n');
    writeFileSync(join(dir, 'src', 'b.ts'), 'const x = 1;\n');
    const res = searchFallback(dir, 'handleRead');
    expect(res.backend).toBe('fallback');
    expect(res.matches.some((m) => m.path === 'src/a.ts')).toBe(true);
    expect(res.matches.every((m) => m.path !== 'node_modules')).toBe(true);
  });

  it('does not false-zero when glob uses ** over shallow paths', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const needle = 1;\n');
    const res = searchFallback(dir, 'needle', 'src/**/*.ts');
    expect(res.matches.some((m) => m.path === 'src/a.ts')).toBe(true);
  });

  it('respects .gitignore and skips ignored directories', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'scratch'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const visibleNeedle = 1;\n');
    writeFileSync(join(dir, 'scratch', 'b.ts'), 'export const visibleNeedle = 2;\n');
    writeFileSync(join(dir, '.gitignore'), 'scratch/\n');
    const res = searchFallback(dir, 'visibleNeedle');
    expect(res.matches.some((m) => m.path === 'src/a.ts')).toBe(true);
    expect(res.matches.some((m) => m.path.startsWith('scratch/'))).toBe(false);
  });

  it('finds nested files with basename-only glob *.ts', () => {
    mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
    writeFileSync(join(dir, 'src', 'tools', 'read.ts'), 'export const globBasenameMarker = 1;\n');
    writeFileSync(join(dir, 'src', 'other.js'), 'const globBasenameMarker = 2;\n');
    const res = searchFallback(dir, 'globBasenameMarker', '*.ts');
    expect(res.matches.some((m) => m.path === 'src/tools/read.ts')).toBe(true);
    expect(res.matches.every((m) => m.path.endsWith('.ts'))).toBe(true);
  });
});

describe('handleSearch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokendiet-search-tool-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function makeCtx() {
    const base = join(dir, '.td');
    return createContext({
      workspace: dir,
      storage: new Storage(':memory:'),
      refStore: new RefStore(base),
    });
  }

  it('passthroughs small result sets under the BPE threshold', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'const handleRead = 1;\n');
    writeFileSync(join(dir, 'src', 'b.ts'), 'const handleRead = 2;\n');
    writeFileSync(join(dir, 'src', 'c.ts'), 'const handleRead = 3;\n');
    const ctx = makeCtx();
    const res = await handleSearch(ctx, { query: 'handleRead', glob: '**/*.ts' });
    expect(res.match_count).toBe(3);
    expect(res.backend).toBe('raw-passthrough');
    expect(res.compression.saved).toBe(0);
    expect(res.compression.tokens_in).toBe(res.compression.tokens_out);
    expect(res.content).toBe(ctx.refStore.get(res.ref));
    expect(res.content).not.toContain('[+');
  });

  it('finds nested ts files with basename glob *.ts', async () => {
    mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
    writeFileSync(join(dir, 'src', 'tools', 'read.ts'), 'export const liveGlobMarker = 1;\n');
    writeFileSync(join(dir, 'src', 'other.js'), 'const liveGlobMarker = 2;\n');
    const ctx = makeCtx();
    const res = await handleSearch(ctx, { query: 'liveGlobMarker', glob: '*.ts' });
    expect(res.match_count).toBeGreaterThan(0);
    expect(res.match_count).toBe(1);
    expect(res.content).toContain('src/tools/read.ts');
  });

  it('compresses large result sets above the BPE threshold', async () => {
    for (let i = 0; i < 50; i++) {
      const lines = Array.from(
        { length: 5 },
        (_, j) => `export const marker${j} = ${j}; // handleRead token padding line`,
      );
      writeFileSync(join(dir, 'src', `f${i}.ts`), lines.join('\n'));
    }
    const ctx = makeCtx();
    const res = await handleSearch(ctx, { query: 'handleRead', glob: '**/*.ts' });
    expect(res.match_count).toBeGreaterThan(100);
    expect(res.backend).not.toBe('raw-passthrough');
    expect(res.verified).toBe(true);
    expect(res.compression.saved).toBeGreaterThan(0);
    expect(res.content).toContain('[+');
  });

  it('returns compressed snippets with ref and savings', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i}; // handleRead marker`);
    writeFileSync(join(dir, 'src', 'big.ts'), lines.join('\n'));
    const ctx = makeCtx();
    const res = await handleSearch(ctx, { query: 'handleRead', glob: '**/*.ts' });
    expect(res.match_count).toBeGreaterThan(0);
    expect(res.ref).toBeDefined();
    expect(res.verified).toBe(true);
    expect(res.compression.saved).toBeGreaterThanOrEqual(0);
    if (res.match_count > (res.shown_matches ?? 0)) {
      expect(res.content).toContain('[+');
    }
    const baseline = ctx.refStore.get(res.ref);
    expect(baseline).toContain('src/big.ts');
    expect(countTokens(res.content)).toBeLessThanOrEqual(countTokens(baseline ?? ''));
  });
});
