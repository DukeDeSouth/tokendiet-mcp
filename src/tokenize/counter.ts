import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import type { Encoding } from '../types.js';

export const DEFAULT_ENCODING: Encoding = 'o200k_base';

/**
 * Honest BPE token count. Never approximated (no chars/4 anywhere).
 * See docs/TOKENIZER.md for supported encodings and their limitations.
 */
export function countTokens(text: string, encoding: Encoding = DEFAULT_ENCODING): number {
  if (text.length === 0) return 0;
  return encoding === 'cl100k_base' ? encodeCl100k(text).length : encodeO200k(text).length;
}
