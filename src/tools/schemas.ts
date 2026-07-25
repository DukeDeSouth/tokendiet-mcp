import { z } from 'zod';
import type { ZodRawShape } from 'zod';

const readModeEnum = z.enum(['auto', 'full', 'outline', 'outline_plus', 'signatures', 'symbol']);

export const ReadTargetSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path'),
  mode: readModeEnum.optional().describe('Per-target mode; defaults to top-level mode or auto'),
  symbol: z.string().optional().describe('When mode=symbol for this target'),
});

const ReadInputBaseSchema = z.object({
  path: z.string().min(1).optional().describe('Single file (backward compat); use targets[] for batch'),
  targets: z
    .array(ReadTargetSchema)
    .min(1)
    .max(16)
    .optional()
    .describe('Read up to 16 files in one call — preferred over repeated single-path reads'),
  budget_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional cap on total tokens_out across batch; degrades modes if exceeded'),
  mode: readModeEnum.optional().default('auto').describe('Default mode for targets without mode'),
  symbol: z.string().optional().describe('Default symbol when mode=symbol'),
});

export const ReadInputSchema = ReadInputBaseSchema.refine(
  (d) => d.path !== undefined || (d.targets !== undefined && d.targets.length > 0),
  { message: 'path or targets required' },
);

/** Base shape for MCP JSON Schema (no Zod refine wrapper). */
export const ReadInputJsonSchema = ReadInputBaseSchema;

export const RunInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});

const ExpandInputBaseSchema = z.object({
  ref: z.string().min(1).optional().describe('Single ref (backward compat)'),
  refs: z
    .array(z.string().min(1))
    .min(1)
    .max(16)
    .optional()
    .describe('Expand up to 16 refs in one call'),
});

export const ExpandInputSchema = ExpandInputBaseSchema.refine(
  (d) => d.ref !== undefined || (d.refs !== undefined && d.refs.length > 0),
  { message: 'ref or refs required' },
);

/** Base shape for MCP JSON Schema (no Zod refine wrapper). */
export const ExpandInputJsonSchema = ExpandInputBaseSchema;

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

export type ReadTarget = z.infer<typeof ReadTargetSchema>;
export type ReadInput = z.infer<typeof ReadInputSchema>;
export type RunInput = z.infer<typeof RunInputSchema>;
export type ExpandInput = z.infer<typeof ExpandInputSchema>;
export type SearchInput = z.infer<typeof SearchInputSchema>;
export type FetchInput = z.infer<typeof FetchInputSchema>;

function zodObjectToJsonSchema(shape: ZodRawShape): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    const s = schema as z.ZodTypeAny;
    properties[key] = schemaMeta(s);
    if (!(s instanceof z.ZodOptional) && !(s instanceof z.ZodDefault)) {
      required.push(key);
    }
  }
  return { type: 'object', properties, ...(required.length > 0 && { required }) };
}

/** Convert a Zod object schema to JSON Schema for MCP tool registration. */
export function zodToJsonSchema(shape: ZodRawShape): Record<string, unknown> {
  return zodObjectToJsonSchema(shape);
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
  } else if (s instanceof z.ZodArray) {
    const items = schemaMeta(s._def.type);
    meta = { type: 'array', items };
    const max = s._def.maxLength;
    const min = s._def.minLength;
    if (max?.value !== undefined) meta.maxItems = max.value;
    if (min?.value !== undefined) meta.minItems = min.value;
  } else if (s instanceof z.ZodObject) {
    return zodObjectToJsonSchema(s.shape);
  } else meta = { type: 'string' };

  return desc ? { ...meta, description: desc } : meta;
}
