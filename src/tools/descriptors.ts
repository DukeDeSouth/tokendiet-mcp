import {
  ExpandInputSchema,
  FetchInputSchema,
  ReadInputSchema,
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
      'Read a workspace file with compression. Start with mode=outline (or auto) for large code files; mode=symbol+symbol for one definition; mode=full to escalate. Returns compression.saved and ref for expand().',
    inputSchema: zodToJsonSchema(ReadInputSchema.shape),
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
      'Retrieve full uncompressed content for a ref returned by read, run, search, or fetch.',
    inputSchema: zodToJsonSchema(ExpandInputSchema.shape),
  },
  {
    name: 'stats',
    description: 'Cumulative token savings for this session and month (honest BPE) with USD estimate.',
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
