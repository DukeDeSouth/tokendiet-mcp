import { z } from 'zod';
import type { ZodRawShape } from 'zod';

export const ReadInputSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path'),
  mode: z
    .enum(['auto', 'full', 'outline', 'signatures', 'symbol'])
    .optional()
    .default('auto')
    .describe('auto/outline for large code; symbol requires symbol'),
  symbol: z.string().optional().describe('Function or Class.method when mode=symbol'),
});

export const RunInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});

export const ExpandInputSchema = z.object({
  ref: z.string().min(1),
});

export const StatsInputSchema = z.object({});

export const SearchInputSchema = z.object({
  query: z.string().min(1).describe('Regex pattern (ripgrep syntax)'),
  glob: z.string().optional().describe('Optional glob filter, e.g. **/*.ts'),
  maxResults: z.number().int().positive().optional().default(50),
});

export const FetchInputSchema = z.object({
  url: z.string().url().describe('http or https URL only'),
  mode: z.enum(['auto', 'raw']).optional().default('auto').describe('auto compresses; raw returns full body'),
});

export type ReadInput = z.infer<typeof ReadInputSchema>;
export type RunInput = z.infer<typeof RunInputSchema>;
export type ExpandInput = z.infer<typeof ExpandInputSchema>;
export type SearchInput = z.infer<typeof SearchInputSchema>;
export type FetchInput = z.infer<typeof FetchInputSchema>;

/** Convert a Zod object schema to JSON Schema for MCP tool registration. */
export function zodToJsonSchema(shape: ZodRawShape): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    const s = schema as z.ZodTypeAny;
    if (s instanceof z.ZodDefault) {
      properties[key] = schemaMeta(s);
    } else {
      properties[key] = schemaMeta(s);
      if (!(s instanceof z.ZodOptional)) required.push(key);
    }
  }
  return { type: 'object', properties, ...(required.length > 0 && { required }) };
}

function schemaMeta(s: z.ZodTypeAny): Record<string, unknown> {
  const desc = s.description;
  let meta: Record<string, unknown>;
  if (s instanceof z.ZodString) meta = { type: 'string' };
  else if (s instanceof z.ZodNumber) meta = { type: 'number' };
  else if (s instanceof z.ZodEnum) meta = { type: 'string', enum: s._def.values };
  else if (s instanceof z.ZodOptional) return schemaMeta(s._def.innerType);
  else if (s instanceof z.ZodDefault) {
    const inner = schemaMeta(s._def.innerType);
    return desc ? { ...inner, description: desc } : inner;
  }
  else meta = { type: 'string' };

  return desc ? { ...meta, description: desc } : meta;
}
