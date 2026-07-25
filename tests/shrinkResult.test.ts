import { describe, it, expect, beforeEach } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { compressCallToolResult } from '../src/shrink/compressResult.js';
import { compressToolDescription } from '../src/shrink/compressDescription.js';
import { createShrinkContext } from '../src/shrink/context.js';
import { clearShrinkConfigCache } from '../src/shrink/config.js';
import { countTokens } from '../src/tokenize/counter.js';

function makeSnapshotYaml(lines = 400): string {
  const rows = Array.from(
    { length: lines },
    (_, i) =>
      `  - role: generic\n    ref: ref-${i}\n    name: Button ${i}\n    children:\n      - role: text\n        name: "Item ${i} repeated content for snapshot padding"`,
  );
  return `page:\n${rows.join('\n')}\n`;
}

describe('shrink compressResult', () => {
  beforeEach(() => {
    clearShrinkConfigCache();
  });

  it('compresses large text blocks and adds ref marker', () => {
    const ctx = createShrinkContext('playwright');
    const text = makeSnapshotYaml(500);
    const input: CallToolResult = { content: [{ type: 'text', text }] };
    const { result, stats } = compressCallToolResult(input, 'browser_snapshot', ctx);

    expect(stats.blocks_compressed).toBe(1);
    expect(stats.saved).toBeGreaterThan(0);
    const out = result.content[0];
    expect(out?.type).toBe('text');
    if (out?.type === 'text') {
      expect(out.text).toContain('[compressed by tokendiet — expand(');
      expect(countTokens(out.text)).toBeLessThan(countTokens(text));
    }
  });

  it('passthroughs small text blocks', () => {
    const ctx = createShrinkContext('default');
    const text = 'short ok';
    const input: CallToolResult = { content: [{ type: 'text', text }] };
    const { result, stats } = compressCallToolResult(input, 'any_tool', ctx);
    expect(stats.blocks_compressed).toBe(0);
    expect(result.content[0]).toEqual({ type: 'text', text });
  });

  it('passthroughs non-text blocks unchanged', () => {
    const ctx = createShrinkContext('default');
    const input: CallToolResult = {
      content: [
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        { type: 'text', text: 'x'.repeat(20) },
      ],
    };
    const { result } = compressCallToolResult(input, 'screenshot', ctx);
    expect(result.content[0]?.type).toBe('image');
  });

  it('respects denylist tools', () => {
    const ctx = createShrinkContext('playwright');
    const text = makeSnapshotYaml(300);
    const input: CallToolResult = { content: [{ type: 'text', text }] };
    const { stats } = compressCallToolResult(input, 'browser_close', ctx);
    expect(stats.blocks_compressed).toBe(0);
  });

  it('skips compression on isError results', () => {
    const ctx = createShrinkContext('default');
    const text = makeSnapshotYaml(500);
    const input: CallToolResult = { content: [{ type: 'text', text }], isError: true };
    const { stats } = compressCallToolResult(input, 'browser_snapshot', ctx);
    expect(stats.blocks_compressed).toBe(0);
  });
});

describe('shrink compressDescription', () => {
  beforeEach(() => {
    clearShrinkConfigCache();
  });

  it('shortens long repetitive tool descriptions when savings pay off', () => {
    const ctx = createShrinkContext('default');
    const long = Array.from(
      { length: 200 },
      () => 'Always verify the selector before clicking the element.',
    ).join('\n');
    const out = compressToolDescription(long, ctx);
    expect(countTokens(out)).toBeLessThan(countTokens(long));
  });

  it('leaves short descriptions unchanged', () => {
    const ctx = createShrinkContext('default');
    const short = 'Take a browser snapshot.';
    expect(compressToolDescription(short, ctx)).toBe(short);
  });
});
