import type { AppContext } from '../context.js';
import type { ServedFile } from '../context.js';
import { isSensitivePath } from '../lib/sensitivePath.js';
import { astLanguageForExtension } from '../pipeline/ast/lang.js';
import { detectType } from '../pipeline/detectType.js';
import type { ReadInput } from './schemas.js';

/** Resolved read detail level (never `auto`). `plain` = default compress path for large non-outline files. */
export type ResolvedReadMode = 'full' | 'outline' | 'signatures' | 'symbol' | 'plain';

const MODE_RANK: Record<ResolvedReadMode, number> = {
  outline: 0,
  signatures: 1,
  symbol: 2,
  plain: 3,
  full: 3,
};

export function modeRank(mode: ResolvedReadMode): number {
  return MODE_RANK[mode];
}

export function isAstReadMode(mode: ResolvedReadMode): mode is 'outline' | 'signatures' | 'symbol' {
  return mode === 'outline' || mode === 'signatures' || mode === 'symbol';
}

/** Resolve `auto` to a concrete mode from file extension and token count. */
export function resolveReadMode(
  input: ReadInput,
  ctx: AppContext,
  relPath: string,
  ext: string,
  tokensIn: number,
): { mode: ResolvedReadMode; symbol?: string } {
  if (input.mode === 'symbol') {
    const symbol = input.symbol?.trim();
    if (!symbol) throw new Error('symbol is required for mode=symbol');
    return { mode: 'symbol', symbol };
  }
  if (input.mode === 'full') return { mode: 'full' };
  if (input.mode === 'outline') return { mode: 'outline' };
  if (input.mode === 'signatures') return { mode: 'signatures' };

  // auto
  if (detectType('x', ext) === 'code' && tokensIn >= ctx.codeOutlineThreshold) {
    if (astLanguageForExtension(ext)) {
      if (isSensitivePath(relPath)) return { mode: 'signatures' };
      return { mode: 'outline' };
    }
  }
  if (tokensIn < ctx.smallFileTokenThreshold) return { mode: 'full' };
  return { mode: 'plain' };
}

/** True when the agent already has enough detail for this request. */
export function hasSufficientDetail(
  served: ServedFile,
  resolved: ResolvedReadMode,
  symbol?: string,
): boolean {
  if (resolved === 'symbol') {
    if (served.mode === 'symbol') return served.symbol === symbol;
    return modeRank(served.mode) >= modeRank('full');
  }
  if (served.mode === 'symbol') return false;
  return modeRank(served.mode) >= modeRank(resolved);
}
