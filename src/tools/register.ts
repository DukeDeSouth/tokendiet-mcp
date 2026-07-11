import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AppContext } from '../context.js';
import { TOOL_DEFS, toolListPayload } from './descriptors.js';
import { handleExpand } from './expand.js';
import { handleFetch } from './fetch.js';
import { handleRead } from './read.js';
import { handleRun } from './run.js';
import { handleSearch } from './search.js';
import {
  ExpandInputSchema,
  FetchInputSchema,
  ReadInputSchema,
  RunInputSchema,
  SearchInputSchema,
  StatsInputSchema,
} from './schemas.js';
import { handleStats } from './stats.js';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export function registerTools(server: Server, ctx: AppContext): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolListPayload(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};
      switch (request.params.name) {
        case 'read':
          return jsonResult(await handleRead(ctx, ReadInputSchema.parse(args)));
        case 'run':
          return jsonResult(await handleRun(ctx, RunInputSchema.parse(args)));
        case 'search':
          return jsonResult(await handleSearch(ctx, SearchInputSchema.parse(args)));
        case 'fetch':
          return jsonResult(await handleFetch(ctx, FetchInputSchema.parse(args)));
        case 'expand':
          return jsonResult(handleExpand(ctx, ExpandInputSchema.parse(args)));
        case 'stats':
          return jsonResult(handleStats(ctx));
        default:
          return errorResult(`Unknown tool: ${request.params.name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  });
}

export { TOOL_DEFS, SCHEMA_TOKEN_BUDGET, toolListPayload } from './descriptors.js';
