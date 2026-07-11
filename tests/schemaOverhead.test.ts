import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/tokenize/counter.js';
import { SCHEMA_TOKEN_BUDGET, toolListPayload } from '../src/tools/descriptors.js';

describe('tool schema overhead', () => {
  it('six tools fit within the BPE token budget', () => {
    const payload = JSON.stringify(toolListPayload());
    const tokens = countTokens(payload);
    expect(tokens).toBeLessThanOrEqual(SCHEMA_TOKEN_BUDGET);
  });

  it('includes all six tool names', () => {
    expect(toolListPayload().map((t) => t.name).sort()).toEqual([
      'expand',
      'fetch',
      'read',
      'run',
      'search',
      'stats',
    ]);
  });

  it('read schema documents outline and symbol modes', () => {
    const read = toolListPayload().find((t) => t.name === 'read');
    const schema = read?.inputSchema as { properties?: Record<string, { description?: string }> };
    expect(read?.description).toContain('outline');
    expect(schema?.properties?.mode?.description).toContain('symbol');
  });
});
