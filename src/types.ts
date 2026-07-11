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
}

export function toCompressionWire(c: Compression, ref?: string): CompressionWire {
  const wire: CompressionWire = {
    tokens_in: c.tokensIn,
    tokens_out: c.tokensOut,
    saved: c.saved,
    saved_pct: c.savedPct,
  };
  if (ref !== undefined) wire.ref = ref;
  return wire;
}
