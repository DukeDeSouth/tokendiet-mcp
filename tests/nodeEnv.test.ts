import { describe, it, expect } from 'vitest';
import { delimiter, dirname } from 'node:path';
import { envForSubprocess } from '../src/lib/nodeEnv.js';

describe('envForSubprocess', () => {
  it('prepends the MCP server node directory to PATH', () => {
    const env = envForSubprocess();
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    const pathValue = env[pathKey] ?? '';
    const nodeDir = dirname(process.execPath);
    expect(pathValue.startsWith(`${nodeDir}${delimiter}`) || pathValue === nodeDir).toBe(true);
  });

  it('preserves existing env keys', () => {
    const env = envForSubprocess();
    expect(env).toHaveProperty('HOME');
  });
});
