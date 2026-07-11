import { formatSearchBaseline } from '../lib/search/baseline.js';
import { compressSearchMatches } from '../lib/search/compress.js';
import { searchFallback } from '../lib/search/fallback.js';
import { shouldPassthroughSearchBaseline } from '../lib/search/passthrough.js';
import { searchWithRg } from '../lib/search/rg.js';
import { verifySearch } from '../lib/search/verifySearch.js';
import { resolveWorkspaceRoot } from '../lib/workspace.js';
import { countTokens } from '../tokenize/counter.js';
import { toCompressionWire } from '../types.js';
import type { AppContext } from '../context.js';
import type { SearchInput } from './schemas.js';

function uniqueFiles(matches: { path: string }[]): number {
  return new Set(matches.map((m) => m.path)).size;
}

export async function handleSearch(ctx: AppContext, input: SearchInput) {
  const workspace = resolveWorkspaceRoot(ctx.workspace);
  const maxResults = input.maxResults ?? 50;

  let collected = await searchWithRg(workspace, input.query, input.glob);
  if (!collected) {
    collected = searchFallback(workspace, input.query, input.glob);
  }

  const { matches, backend, truncated } = collected;
  const baseline = formatSearchBaseline(matches);
  const tokensIn = countTokens(baseline, ctx.encoding);

  if (matches.length === 0) {
    const ref = ctx.refStore.put('');
    ctx.storage.recordStat(ctx.sessionId, 'search', 0, 0, 0);
    return {
      query: input.query,
      backend,
      match_count: 0,
      file_count: 0,
      content: '',
      ref,
      verified: true,
      compression: toCompressionWire({ tokensIn: 0, tokensOut: 0, saved: 0, savedPct: 0 }, ref),
    };
  }

  if (shouldPassthroughSearchBaseline(tokensIn)) {
    const ref = ctx.refStore.put(baseline);
    ctx.storage.recordStat(ctx.sessionId, 'search', tokensIn, tokensIn, 0);
    return {
      query: input.query,
      ...(input.glob && { glob: input.glob }),
      backend: 'raw-passthrough',
      match_count: matches.length,
      file_count: uniqueFiles(matches),
      shown_matches: matches.length,
      ...(truncated && { truncated: true }),
      content: baseline,
      verified: true,
      ref,
      compression: toCompressionWire(
        { tokensIn, tokensOut: tokensIn, saved: 0, savedPct: 0 },
        ref,
      ),
    };
  }

  const compressed = compressSearchMatches(matches, maxResults);
  let content = compressed.content;
  let verified = true;
  let fallbackReason: string | undefined;

  const meta = {
    totalMatches: matches.length,
    shownMatches: compressed.shownMatches,
    hiddenMatches: compressed.hiddenMatches,
    hiddenFiles: compressed.hiddenFiles,
    pathsInOutput: compressed.pathsInOutput,
  };

  const verdict = verifySearch(baseline, content, meta, ctx.encoding);
  if (!verdict.pass) {
    content = baseline;
    verified = false;
    fallbackReason = verdict.failures.map((f) => `${f.rule}: ${f.detail}`).join('; ');
  }

  const ref = ctx.refStore.put(baseline);
  const tokensOut = countTokens(content, ctx.encoding);
  const saved = tokensIn - tokensOut;

  ctx.storage.recordStat(ctx.sessionId, 'search', tokensIn, tokensOut, saved);

  return {
    query: input.query,
    ...(input.glob && { glob: input.glob }),
    backend,
    match_count: matches.length,
    file_count: uniqueFiles(matches),
    shown_matches: compressed.shownMatches,
    ...(truncated && { truncated: true }),
    content,
    verified,
    ...(fallbackReason && { fallback_reason: fallbackReason }),
    ref,
    compression: toCompressionWire(
      {
        tokensIn,
        tokensOut,
        saved,
        savedPct: tokensIn ? Math.round((saved / tokensIn) * 100) : 0,
      },
      ref,
    ),
  };
}
