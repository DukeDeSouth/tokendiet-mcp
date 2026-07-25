import type { AppContext } from '../context.js';
import { countTokens } from '../tokenize/counter.js';
import type { ExpandInput } from './schemas.js';

interface ExpandOneSuccess {
  ref: string;
  content: string;
  tokens: number;
}

interface ExpandOneError {
  ref: string;
  error: string;
}

type ExpandOneResult = ExpandOneSuccess | ExpandOneError;

function expandOne(ctx: AppContext, ref: string): ExpandOneResult {
  const content = ctx.refStore.get(ref);
  if (content === undefined) {
    return { ref, error: `ref not found: ${ref} (ref expired; re-read the file)` };
  }
  const tokens = countTokens(content, ctx.encoding);
  return { ref, content, tokens };
}

function normalizeExpandRefs(input: ExpandInput): string[] {
  if (input.refs?.length) return input.refs;
  if (input.ref !== undefined) return [input.ref];
  return [];
}

function recordExpandStat(ctx: AppContext, tokens: number): void {
  ctx.storage.recordStat(ctx.sessionId, 'expand', tokens, tokens, 0, { is_follow_up: true });
}

export function handleExpand(ctx: AppContext, input: ExpandInput) {
  const refs = normalizeExpandRefs(input);
  if (refs.length === 0) {
    return { error: 'ref or refs required' };
  }

  if (refs.length === 1 && input.ref !== undefined && input.refs === undefined) {
    const one = expandOne(ctx, refs[0]!);
    if ('error' in one) {
      return { error: one.error };
    }
    recordExpandStat(ctx, one.tokens);
    return { ref: one.ref, content: one.content, tokens: one.tokens };
  }

  const results = refs.map((ref) => expandOne(ctx, ref));
  const tokensTotal = results.reduce(
    (sum, r) => sum + ('tokens' in r ? r.tokens : 0),
    0,
  );
  if (tokensTotal > 0) {
    recordExpandStat(ctx, tokensTotal);
  }

  return {
    results,
    batch_compression: {
      tokens_in: tokensTotal,
      tokens_out: tokensTotal,
      saved: 0,
      saved_pct: 0,
    },
  };
}
