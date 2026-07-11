import { delimiter, dirname } from 'node:path';

/**
 * Child processes spawned by the MCP server must use the same Node binary as the
 * server itself — otherwise native addons (e.g. better-sqlite3) compiled for the
 * server's NODE_MODULE_VERSION fail when Cursor's PATH prefers Electron's Node.
 */
export function envForSubprocess(): NodeJS.ProcessEnv {
  const nodeDir = dirname(process.execPath);
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const base = process.env[pathKey] ?? '';
  return {
    ...process.env,
    [pathKey]: base ? `${nodeDir}${delimiter}${base}` : nodeDir,
  };
}
