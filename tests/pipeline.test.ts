import { describe, it, expect } from 'vitest';
import { compress } from '../src/pipeline/pipeline.js';

describe('compress (end-to-end pipeline)', () => {
  it('compresses a repetitive log and reports honest savings', () => {
    const input = Array(200).fill('2026-07-11T10:00:00Z INFO heartbeat ok').join('\n');
    const res = compress(input);
    expect(res.type).toBe('log');
    expect(res.verified).toBe(true);
    expect(res.compression.saved).toBeGreaterThan(0);
    expect(res.compression.saved).toBe(res.compression.tokensIn - res.compression.tokensOut);
    expect(res.compression.savedPct).toBeGreaterThan(90);
  });

  it('compresses JSON arrays', () => {
    const input = JSON.stringify(
      { users: Array.from({ length: 100 }, (_, i) => ({ id: i, email: `u${i}@x.io` })) },
      null,
      2,
    );
    const res = compress(input);
    expect(res.type).toBe('json');
    expect(res.verified).toBe(true);
    expect(res.compression.savedPct).toBeGreaterThan(50);
  });

  it('falls back to original when nothing can be compressed', () => {
    const input = 'Tiny.';
    const res = compress(input);
    expect(res.verified).toBe(false);
    expect(res.output).toBe(input);
    expect(res.compression.saved).toBe(0);
    expect(res.fallbackReason).toContain('token-reduction');
  });

  it('empty input falls back safely', () => {
    const res = compress('');
    expect(res.output).toBe('');
    expect(res.compression.saved).toBe(0);
    expect(res.verified).toBe(false);
  });

  it('never loses error lines from test output', () => {
    const input = [
      ...Array.from({ length: 100 }, (_, i) => `✓ case ${i}`),
      'FAIL src/core.test.ts',
      'Error: snapshot mismatch at src/core.test.ts:88:3',
      'Tests: 1 failed, 100 passed',
    ].join('\n');
    const res = compress(input);
    expect(res.type).toBe('test_output');
    expect(res.verified).toBe(true);
    expect(res.output).toContain('Error: snapshot mismatch at src/core.test.ts:88:3');
    expect(res.compression.savedPct).toBeGreaterThan(70);
  });

  it('stores a ref when storeRef is provided', () => {
    const store = new Map<string, string>();
    const input = Array(50).fill('2026-07-11T10:00:00Z INFO x').join('\n');
    const res = compress(input, {
      storeRef: (content) => {
        store.set('r1', content);
        return 'r1';
      },
    });
    expect(res.ref).toBe('r1');
    expect(store.get('r1')).toBe(input);
  });

  it('respects encoding option consistently for in and out counts', () => {
    const input = Array(50).fill('log line repeated').join('\n');
    const res = compress(input, { hint: 'log', encoding: 'cl100k_base' });
    expect(res.compression.saved).toBe(res.compression.tokensIn - res.compression.tokensOut);
  });
});
