import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/tokenize/counter.js';

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('', 'cl100k_base')).toBe(0);
  });

  it('is deterministic', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(countTokens(text)).toBe(countTokens(text));
  });

  it('counts real BPE tokens, not chars/4', () => {
    // "hello world" is 2 tokens in both encodings; chars/4 would give 2.75→3
    expect(countTokens('hello world')).toBe(2);
    expect(countTokens('hello world', 'cl100k_base')).toBe(2);
  });

  it('supports both encodings and they may differ', () => {
    const text = 'функция обработки ошибок №42';
    const o200k = countTokens(text, 'o200k_base');
    const cl100k = countTokens(text, 'cl100k_base');
    expect(o200k).toBeGreaterThan(0);
    expect(cl100k).toBeGreaterThan(0);
  });

  it('scales with input size', () => {
    const small = countTokens('a line of text');
    const big = countTokens('a line of text\n'.repeat(100));
    expect(big).toBeGreaterThan(small * 50);
  });
});
