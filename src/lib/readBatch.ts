import type { AppContext } from '../context.js';
import type { CompressionWire } from '../types.js';
import type { ReadInput, ReadTarget } from '../tools/schemas.js';
import type { ResolvedReadMode } from '../tools/readMode.js';

export interface BatchCompressionWire {
  tokens_in: number;
  tokens_out: number;
  saved: number;
  saved_pct: number;
}

export interface ReadBatchResponse<T> {
  results: T[];
  batch_compression: BatchCompressionWire;
  degraded?: string[];
}

type ResultWithCompression = { path?: string; compression: CompressionWire; read_mode?: string };

/** Normalize path-only or targets[] input into per-file targets. */
export function normalizeTargets(input: ReadInput): ReadTarget[] {
  const defaultMode = input.mode ?? 'auto';
  if (input.targets?.length) {
    return input.targets.map((t) => ({
      path: t.path,
      mode: t.mode ?? defaultMode,
      ...(t.symbol !== undefined
        ? { symbol: t.symbol }
        : t.mode === 'symbol' && input.symbol !== undefined
          ? { symbol: input.symbol }
          : {}),
    }));
  }
  return [
    {
      path: input.path!,
      mode: defaultMode,
      ...(input.symbol !== undefined && { symbol: input.symbol }),
    },
  ];
}

/** True when caller used legacy single `path` (unwrap batch response). */
export function isSinglePathCompat(input: ReadInput): boolean {
  return input.path !== undefined && !input.targets?.length;
}

export function aggregateBatchCompression(results: ResultWithCompression[]): BatchCompressionWire {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const r of results) {
    tokensIn += r.compression.tokens_in;
    tokensOut += r.compression.tokens_out;
  }
  const saved = tokensIn - tokensOut;
  return {
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    saved,
    saved_pct: tokensIn ? Math.round((saved / tokensIn) * 100) : 0,
  };
}

function usefulnessDensity(r: ResultWithCompression): number {
  const out = r.compression.tokens_out || 1;
  return r.compression.saved / out;
}

function readModeFromResult(r: ResultWithCompression): ResolvedReadMode {
  const mode = r.read_mode;
  if (
    mode === 'full' ||
    mode === 'outline' ||
    mode === 'outline_plus' ||
    mode === 'signatures' ||
    mode === 'symbol' ||
    mode === 'plain'
  ) {
    return mode;
  }
  return 'full';
}

function nextDegradedMode(mode: ResolvedReadMode): 'outline_plus' | 'signatures' | null {
  if (mode === 'full' || mode === 'plain') return 'outline_plus';
  if (mode === 'outline_plus' || mode === 'outline') return 'signatures';
  return null;
}

/**
 * When total tokens_out exceeds budget, degrade lowest-density targets and re-read.
 */
export async function packIntoBudget<T extends ResultWithCompression>(
  ctx: AppContext,
  targets: ReadTarget[],
  results: T[],
  budgetTokens: number,
  reread: (ctx: AppContext, target: ReadTarget) => Promise<T>,
): Promise<{ results: T[]; degraded: string[] }> {
  const current = [...results];
  const degraded: string[] = [];

  const totalOut = () => current.reduce((sum, r) => sum + r.compression.tokens_out, 0);
  if (totalOut() <= budgetTokens) {
    return { results: current, degraded };
  }

  const order = current
    .map((r, i) => ({ i, density: usefulnessDensity(r) }))
    .sort((a, b) => a.density - b.density);

  let guard = targets.length * 4;
  while (totalOut() > budgetTokens && guard-- > 0) {
    let progressed = false;
    for (const { i } of order) {
      if (totalOut() <= budgetTokens) break;
      const row = current[i];
      const targetRow = targets[i];
      if (!row || !targetRow) continue;
      const mode = readModeFromResult(row);
      const next = nextDegradedMode(mode);
      if (!next) continue;

      const target: ReadTarget = { ...targetRow, mode: next };
      current[i] = await reread(ctx, target);
      if (!degraded.includes(targetRow.path)) degraded.push(targetRow.path);
      progressed = true;
    }
    if (!progressed) break;
  }

  return { results: current, degraded };
}
