import type { TransformOptions, TransformResult } from '../../types.js';

const DEFAULT_ARRAY_LIMIT = 5;
const TRUNCATION_KEY = '…';

function keySchema(items: unknown[]): string {
  const keys = new Set<string>();
  for (const item of items) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      for (const k of Object.keys(item as Record<string, unknown>)) keys.add(k);
    }
  }
  return keys.size > 0 ? `{${[...keys].join(',')}}` : typeof items[0];
}

function truncate(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((v) => truncate(v, limit));
    if (mapped.length > limit) {
      const omitted = mapped.length - limit;
      return [
        ...mapped.slice(0, limit),
        `${TRUNCATION_KEY}(+${omitted} items, schema: ${keySchema(value)})`,
      ];
    }
    return mapped;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncate(v, limit);
    }
    return out;
  }
  return value;
}

/**
 * JSON compression: compact stringify + truncate long arrays to the first N
 * items plus an explicit truncation marker with a key schema.
 * Invalid JSON is returned unchanged (verifier will then force a fallback).
 */
export function transformJson(content: string, options: TransformOptions = {}): TransformResult {
  const limit = options.jsonArrayLimit ?? DEFAULT_ARRAY_LIMIT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { output: content, notes: ['json parse failed; original kept'] };
  }
  return { output: JSON.stringify(truncate(parsed, limit)) };
}
