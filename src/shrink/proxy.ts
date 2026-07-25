import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { compressToolDescription } from './compressDescription.js';
import { compressCallToolResult } from './compressResult.js';
import { createShrinkContext } from './context.js';

const DEBUG = process.env.TOKENDIET_DEBUG === 'true';
const log = DEBUG ? (msg: string) => process.stderr.write(`[tokendiet-shrink] ${msg}\n`) : () => {};

export interface ShrinkProxyOptions {
  serverProfile?: string;
}

/**
 * Stdio MCP proxy: shrink upstream tools/list descriptions and tools/call text results.
 * Usage: tokendiet-mcp shrink -- <upstream-command> [args...]
 */
export async function runShrinkProxy(
  upstreamArgv: string[],
  options: ShrinkProxyOptions = {},
): Promise<void> {
  if (upstreamArgv.length === 0) {
    throw new Error('upstream command required after --');
  }

  const [command, ...args] = upstreamArgv;
  const ctx = createShrinkContext(options.serverProfile);
  const gc = ctx.refStore.gc();
  if (DEBUG && gc.removed > 0) {
    log(`ref gc: removed ${gc.removed}`);
  }

  const client = new Client({ name: 'tokendiet-shrink', version: '0.7.0' });
  const upstreamTransport = new StdioClientTransport({ command: command!, args });
  await client.connect(upstreamTransport);
  log(`connected upstream: ${command} ${args.join(' ')}`);

  const server = new Server(
    { name: 'tokendiet-shrink', version: '0.7.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const listed = await client.listTools();
    if (!ctx.config.compress_tool_descriptions) {
      return listed;
    }
    return {
      tools: listed.tools.map((tool) => ({
        ...tool,
        description: compressToolDescription(tool.description ?? '', ctx),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const raw = (await client.callTool(request.params)) as CallToolResult;
    const { result, stats } = compressCallToolResult(raw, request.params.name, ctx);
    if (DEBUG && stats.saved > 0) {
      log(
        `shrunk ${request.params.name}: ${stats.tokens_in}→${stats.tokens_out} tok (${stats.saved} saved)`,
      );
    }
    return result;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`shrink proxy ready (profile=${ctx.serverName})`);
}
