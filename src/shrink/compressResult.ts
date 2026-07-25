import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { compress } from '../pipeline/pipeline.js';
import { countTokens } from '../tokenize/counter.js';
import type { ShrinkContext } from './context.js';
import { shouldShrinkTool } from './config.js';

export interface ShrinkBlockStats {
  blocks_in: number;
  blocks_compressed: number;
  tokens_in: number;
  tokens_out: number;
  saved: number;
}

const SHRINK_MARKER = (ref: string) =>
  `\n\n[compressed by tokendiet — expand(${ref}) for full]`;

function isTextBlock(
  block: CallToolResult['content'][number],
): block is { type: 'text'; text: string } {
  return block.type === 'text' && typeof block.text === 'string';
}

function minTokensForTool(ctx: ShrinkContext): number {
  return ctx.profile.min_text_tokens ?? ctx.config.min_text_tokens;
}

function compressTextBlock(
  text: string,
  ctx: ShrinkContext,
): { text: string; saved: number; compressed: boolean } {
  const tokensIn = countTokens(text, ctx.encoding);
  if (tokensIn < minTokensForTool(ctx)) {
    return { text, saved: 0, compressed: false };
  }

  const result = compress(text, {
    hint: ctx.profile.content_hint ?? 'plain',
    encoding: ctx.encoding,
    storeRef: (content) => ctx.refStore.put(content),
  });

  if (!result.verified || result.compression.saved < ctx.config.min_saved_tokens) {
    return { text, saved: 0, compressed: false };
  }

  const ref = result.ref;
  if (!ref) {
    return { text: result.output, saved: result.compression.saved, compressed: true };
  }

  return {
    text: result.output + SHRINK_MARKER(ref),
    saved: result.compression.saved,
    compressed: true,
  };
}

/** Compress text blocks inside an upstream tools/call response (turn-neutral). */
export function compressCallToolResult(
  result: CallToolResult,
  toolName: string,
  ctx: ShrinkContext,
): { result: CallToolResult; stats: ShrinkBlockStats } {
  const stats: ShrinkBlockStats = {
    blocks_in: 0,
    blocks_compressed: 0,
    tokens_in: 0,
    tokens_out: 0,
    saved: 0,
  };

  if (!ctx.config.compress_call_results || result.isError) {
    return { result, stats };
  }
  if (!shouldShrinkTool(toolName, ctx.profile)) {
    return { result, stats };
  }

  const content = result.content.map((block) => {
    if (!isTextBlock(block)) return block;

    stats.blocks_in += 1;
    const tokensIn = countTokens(block.text, ctx.encoding);
    stats.tokens_in += tokensIn;

    const shrunk = compressTextBlock(block.text, ctx);
    const tokensOut = countTokens(shrunk.text, ctx.encoding);
    stats.tokens_out += tokensOut;

    if (shrunk.compressed) {
      stats.blocks_compressed += 1;
      stats.saved += shrunk.saved;
    }

    return { type: 'text' as const, text: shrunk.text };
  });

  if (stats.saved > 0) {
    ctx.storage.recordStat(
      ctx.sessionId,
      'shrink',
      stats.tokens_in,
      stats.tokens_out,
      stats.saved,
    );
  }

  return { result: { ...result, content }, stats };
}
