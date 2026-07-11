/**
 * Shared helpers for dogfood benchmark harnesses.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createContext, type AppContext } from '../src/context.js';
import { RefStore } from '../src/storage/refStore.js';
import { Storage } from '../src/storage/sqlite.js';
import { handleRead } from '../src/tools/read.js';
import { handleRun } from '../src/tools/run.js';
import { handleSearch } from '../src/tools/search.js';
import { handleFetch } from '../src/tools/fetch.js';
import type { ReadInput } from '../src/tools/schemas.js';
import { countTokens } from '../src/tokenize/counter.js';

export interface BenchOp {
  name: string;
  baseline: number;
  compressed: number;
  saved: number;
  saved_pct: number;
  mode: string;
}

export interface BenchSummary {
  scenario: string;
  baseline_tokens: number;
  compressed_tokens: number;
  saved_tokens: number;
  saved_pct: number;
  operations: BenchOp[];
  session_stats: ReturnType<Storage['getSessionTotals']>;
}

export function makeBenchContext(workspace: string): AppContext {
  const base = join(workspace, '.dogfood-td');
  return createContext({
    workspace,
    sessionId: `bench-${randomUUID()}`,
    storage: new Storage(':memory:'),
    refStore: new RefStore(base),
  });
}

function pct(baseline: number, saved: number): number {
  return baseline ? Math.round((saved / baseline) * 100) : 0;
}

export async function benchRead(ctx: AppContext, relPath: string, label?: string): Promise<BenchOp> {
  return benchReadMode(ctx, relPath, 'auto', label);
}

export async function benchReadMode(
  ctx: AppContext,
  relPath: string,
  mode: ReadInput['mode'],
  label?: string,
  symbol?: string,
): Promise<BenchOp> {
  const abs = join(ctx.workspace, relPath);
  const raw = readFileSync(abs, 'utf8');
  const baseline = countTokens(raw);
  const res = await handleRead(ctx, {
    path: relPath,
    mode,
    ...(symbol !== undefined && { symbol }),
  });
  let compressed = 0;
  let modeLabel = res.status;
  if ('read_mode' in res && res.read_mode) {
    modeLabel = `${res.status}/${res.read_mode}`;
  }
  if (res.status === 'unchanged') {
    compressed = 0;
  } else if ('content' in res && typeof res.content === 'string') {
    compressed = countTokens(res.content);
  }
  const saved = baseline - compressed;
  return {
    name: label ?? `read ${relPath} (${mode})`,
    baseline,
    compressed,
    saved,
    saved_pct: pct(baseline, saved),
    mode: modeLabel,
  };
}

export async function benchSearch(
  ctx: AppContext,
  query: string,
  label?: string,
  glob?: string,
): Promise<BenchOp> {
  const res = await handleSearch(ctx, { query, ...(glob && { glob }) });
  const baseline = res.compression.tokens_in;
  const compressed = res.compression.tokens_out;
  const saved = baseline - compressed;
  return {
    name: label ?? `search ${query.slice(0, 40)}`,
    baseline,
    compressed,
    saved,
    saved_pct: pct(baseline, saved),
    mode: `search/${res.backend}`,
  };
}

export async function benchFetch(ctx: AppContext, url: string, label?: string): Promise<BenchOp> {
  const res = await handleFetch(ctx, { url, mode: 'auto' });
  const baseline = res.compression.tokens_in;
  const compressed = res.compression.tokens_out;
  const saved = baseline - compressed;
  return {
    name: label ?? `fetch ${url.slice(0, 50)}`,
    baseline,
    compressed,
    saved,
    saved_pct: pct(baseline, saved),
    mode: `fetch/${res.content_type ?? 'unknown'}`,
  };
}

export async function benchRun(ctx: AppContext, command: string, label?: string): Promise<BenchOp> {
  const res = await handleRun(ctx, { command });
  const baseline = res.compression.tokens_in;
  const compressed = res.compression.tokens_out;
  const saved = baseline - compressed;
  return {
    name: label ?? `run ${command.slice(0, 40)}`,
    baseline,
    compressed,
    saved,
    saved_pct: pct(baseline, saved),
    mode: res.content_type ?? 'run',
  };
}

export function summarize(scenario: string, ops: BenchOp[], ctx: AppContext): BenchSummary {
  const baseline_tokens = ops.reduce((s, o) => s + o.baseline, 0);
  const compressed_tokens = ops.reduce((s, o) => s + o.compressed, 0);
  const saved_tokens = baseline_tokens - compressed_tokens;
  return {
    scenario,
    baseline_tokens,
    compressed_tokens,
    saved_tokens,
    saved_pct: pct(baseline_tokens, saved_tokens),
    operations: ops,
    session_stats: ctx.storage.getSessionTotals(ctx.sessionId),
  };
}

export function assertWorkspaceFile(workspace: string, relPath: string): void {
  const abs = join(workspace, relPath);
  if (!existsSync(abs)) {
    throw new Error(`benchmark file missing: ${relPath} (cwd=${workspace})`);
  }
}

export function workspaceRoot(): string {
  return process.cwd();
}

export function rel(workspace: string, absPath: string): string {
  return relative(workspace, absPath);
}
