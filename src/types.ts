export type ContentType = 'code' | 'test_output' | 'log' | 'json' | 'html' | 'plain';

export type Encoding = 'o200k_base' | 'cl100k_base';

export interface TransformOptions {
  /** Max array items kept verbatim in JSON transform. */
  jsonArrayLimit?: number;
}

export interface TransformResult {
  output: string;
  notes?: string[];
  /** Lines dropped by test_output transform (visible via omitted marker). */
  omitted_lines?: number;
}

export interface VerifyFailure {
  rule: string;
  detail: string;
}

export interface VerifyResult {
  pass: boolean;
  failures: VerifyFailure[];
}

export interface Compression {
  tokensIn: number;
  tokensOut: number;
  saved: number;
  savedPct: number;
}

export interface CompressOptions extends TransformOptions {
  /** Hint about the content source: file extension ("ts", ".json") or a ContentType. */
  hint?: string;
  encoding?: Encoding;
  /** Store the original content and return a ref for later expansion. */
  storeRef?: (content: string) => string;
}

export interface PipelineResult {
  output: string;
  type: ContentType;
  ref?: string;
  compression: Compression;
  verified: boolean;
  fallbackReason?: string;
  omitted_lines?: number;
}

/** Wire-format compression block returned by MCP tools (snake_case). */
export interface CompressionWire {
  tokens_in: number;
  tokens_out: number;
  saved: number;
  saved_pct: number;
  ref?: string;
  /** Net session economics in input-token equivalents (saved minus turn cost if redundant). */
  net_estimate?: number;
  /** Set when server returns raw content because compression would not pay for the turn. */
  passthrough_reason?: string;
}

export interface CompressionWireExtras {
  net_estimate?: number;
  passthrough_reason?: string;
}

export function toCompressionWire(
  c: Compression,
  ref?: string,
  extras?: CompressionWireExtras,
): CompressionWire {
  const wire: CompressionWire = {
    tokens_in: c.tokensIn,
    tokens_out: c.tokensOut,
    saved: c.saved,
    saved_pct: c.savedPct,
  };
  if (ref !== undefined) wire.ref = ref;
  if (extras?.net_estimate !== undefined) wire.net_estimate = extras.net_estimate;
  if (extras?.passthrough_reason !== undefined) wire.passthrough_reason = extras.passthrough_reason;
  return wire;
}

/** Omitted payload details on compressed read responses. */
export interface ReadOmittedWire {
  bodies?: boolean;
  annotations?: number;
  urls?: number;
}

export type AnnotationsIncludedWire = boolean | 'partial';
