import type { AppContext } from '../context.js';
import { countTokens } from '../tokenize/counter.js';
import type { ExpandInput } from './schemas.js';

export function handleExpand(ctx: AppContext, input: ExpandInput) {
  const content = ctx.refStore.get(input.ref);
  if (content === undefined) {
    return { error: `ref not found: ${input.ref} (ref expired; re-read the file)` };
  }
  const tokens = countTokens(content, ctx.encoding);
  return {
    ref: input.ref,
    content,
    tokens,
  };
}
