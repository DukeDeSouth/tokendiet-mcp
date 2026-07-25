import {
  ExpandInputJsonSchema,
  FetchInputSchema,
  ReadInputJsonSchema,
  RunInputSchema,
  SearchInputSchema,
  StatsInputSchema,
  zodToJsonSchema,
} from './schemas.js';

/** Max BPE tokens for all tool descriptors (name + description + inputSchema). */
export const SCHEMA_TOKEN_BUDGET = 600;

export const TOOL_DEFS = [
  {
    name: 'read',
    description:
      'Read workspace file(s). Pass targets[] (up to 16 paths) in one call. mode=auto uses outline+ for large code when net-positive; full below ~3K tokens.',
    inputSchema: zodToJsonSchema(ReadInputJsonSchema.shape),
  },
  {
    name: 'run',
    description:
      'Run a shell command; compress stdout/stderr. Prefer over Bash for tests, builds, and logs. Full output in ref for expand(). Timeout 120s, 10MB cap.',
    inputSchema: zodToJsonSchema(RunInputSchema.shape),
  },
  {
    name: 'search',
    description:
      'Regex search the workspace (ripgrep or fallback). Returns compressed snippets (max 3 per file) plus ref for full results. Prefer over grep when output is large.',
    inputSchema: zodToJsonSchema(SearchInputSchema.shape),
  },
  {
    name: 'fetch',
    description:
      'Fetch an http(s) URL with SSRF protection. Auto-compresses HTML, JSON, and text; mode=raw for full body. Full response in ref for expand(). Timeout 30s, 5MB cap.',
    inputSchema: zodToJsonSchema(FetchInputSchema.shape),
  },
  {
    name: 'expand',
    description:
      'Retrieve full uncompressed content for ref(s) from read, run, search, or fetch. Pass refs[] for batch expand.',
    inputSchema: zodToJsonSchema(ExpandInputJsonSchema.shape),
  },
  {
    name: 'stats',
    description:
      'Session token economics: saved tokens, follow_up_rate, net_tokens_estimate (saved minus turn cost), and USD. Call at end of session only.',
    inputSchema: zodToJsonSchema(StatsInputSchema.shape),
  },
] as const;

export function toolListPayload(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}
