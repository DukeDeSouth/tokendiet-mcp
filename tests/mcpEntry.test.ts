import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { countTokens } from '../src/tokenize/counter.js';
import { SCHEMA_TOKEN_BUDGET, toolListPayload } from '../src/tools/descriptors.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('MCP entry (stdio)', () => {
  it('responds to tools/list with six tools', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(pkgRoot, 'dist', 'index.js')],
      env: { ...process.env, TOKENDIET_HOME: join(pkgRoot, '.test-home') },
    });
    const client = new Client({ name: 'tokendiet-test', version: '0.0.0' });
    await client.connect(transport);
    try {
      const res = await client.listTools();
      expect(res.tools.map((t) => t.name).sort()).toEqual([
        'expand',
        'fetch',
        'read',
        'run',
        'search',
        'stats',
      ]);
    } finally {
      await client.close();
    }
  });

  it('keeps tool schema overhead under 600 BPE tokens', () => {
    const payload = JSON.stringify(toolListPayload());
    expect(countTokens(payload)).toBeLessThanOrEqual(SCHEMA_TOKEN_BUDGET);
  });
});
