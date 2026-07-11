import type { CompressOptions, PipelineResult } from '../types.js';
import { countTokens, DEFAULT_ENCODING } from '../tokenize/counter.js';
import { detectType } from './detectType.js';
import { applyTransform } from './transform.js';
import { verify } from './verify.js';

/**
 * Core pipeline: detectType → transform → verify → honest BPE accounting.
 * On any verifier failure the original content is returned (saved = 0).
 */
export function compress(content: string, opts: CompressOptions = {}): PipelineResult {
  const encoding = opts.encoding ?? DEFAULT_ENCODING;
  const tokensIn = countTokens(content, encoding);
  const type = detectType(content, opts.hint);
  const transformed = applyTransform(type, content, opts);
  const ref = opts.storeRef ? opts.storeRef(content) : undefined;

  const verdict = verify(content, transformed.output, type, encoding);
  if (!verdict.pass) {
    return {
      output: content,
      type,
      ...(ref !== undefined && { ref }),
      compression: { tokensIn, tokensOut: tokensIn, saved: 0, savedPct: 0 },
      verified: false,
      fallbackReason: verdict.failures.map((f) => `${f.rule}: ${f.detail}`).join('; '),
    };
  }

  const tokensOut = countTokens(transformed.output, encoding);
  return {
    output: transformed.output,
    type,
    ...(ref !== undefined && { ref }),
    ...(transformed.omitted_lines !== undefined && { omitted_lines: transformed.omitted_lines }),
    compression: {
      tokensIn,
      tokensOut,
      saved: tokensIn - tokensOut,
      savedPct: tokensIn === 0 ? 0 : Math.round((1 - tokensOut / tokensIn) * 100),
    },
    verified: true,
  };
}
