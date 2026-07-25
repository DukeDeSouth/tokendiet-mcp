#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext } from './context.js';
import { runSetup } from './setup/cursor.js';
import { registerTools } from './tools/register.js';

const DEBUG = process.env.TOKENDIET_DEBUG === 'true';
const log = DEBUG ? (msg: string) => process.stderr.write(`[tokendiet] ${msg}\n`) : () => {};

if (process.argv[2] === 'setup') {
  runSetup(process.argv.slice(3));
  process.exit(0);
}

if (process.argv[2] === 'shrink') {
  const sep = process.argv.indexOf('--');
  const upstream = sep >= 0 ? process.argv.slice(sep + 1) : process.argv.slice(3);
  if (upstream.length === 0) {
    process.stderr.write(
      'Usage: tokendiet-mcp shrink [--] -- <upstream-command> [args...]\n' +
        'Example: tokendiet-mcp shrink -- npx @playwright/mcp@latest\n' +
        'Set TOKENDIET_SHRINK_SERVER=playwright for per-upstream shrink.config.json profile.\n',
    );
    process.exit(1);
  }
  const { runShrinkProxy } = await import('./shrink/proxy.js');
  await runShrinkProxy(upstream, {
    ...(process.env.TOKENDIET_SHRINK_SERVER !== undefined && {
      serverProfile: process.env.TOKENDIET_SHRINK_SERVER,
    }),
  });
  process.exit(0);
}

let shuttingDown = false;
function gracefulExit(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exit(0);
}

process.on('SIGPIPE', () => {});
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') gracefulExit();
});
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    gracefulExit();
    return;
  }
  log(`uncaught: ${err.message}`);
  process.exit(1);
});

const ctx = createContext();
const gcResult = ctx.refStore.gc();
if (DEBUG && gcResult.removed > 0) {
  log(`ref gc: removed ${gcResult.removed}, freed ${gcResult.freedBytes} bytes`);
}

const server = new Server(
  { name: 'tokendiet', version: '0.7.0' },
  { capabilities: { tools: {} } },
);

registerTools(server, ctx);

const transport = new StdioServerTransport();
await server.connect(transport);
log('server started (stdio)');
