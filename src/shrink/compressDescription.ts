import { compress } from '../pipeline/pipeline.js';
import { countTokens } from '../tokenize/counter.js';
import type { ShrinkContext } from './context.js';

const MIN_DESCRIPTION_TOKENS = 80;

/** Shrink a tool description for tools/list (schema overhead reduction). */
export function compressToolDescription(description: string, ctx: ShrinkContext): string {
  const text = description?.trim() ?? '';
  if (!text) return description;
  if (countTokens(text, ctx.encoding) < MIN_DESCRIPTION_TOKENS) return description;

  const result = compress(text, {
    hint: text.includes('\n') ? 'log' : 'plain',
    encoding: ctx.encoding,
    storeRef: (content) => ctx.refStore.put(content),
  });

  if (!result.verified || result.compression.saved < ctx.config.min_saved_tokens) {
    return description;
  }

  return result.output;
}
