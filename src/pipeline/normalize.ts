/**
 * Line normalization shared by the log transform and the verifier.
 * Keeping them identical is what lets the verifier recognize deduplicated
 * lines ("... ×137") as preserved content.
 */

const TIMESTAMP_PATTERNS: RegExp[] = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, // ISO
  /\d{2}:\d{2}:\d{2}(\.\d+)?/g,                                            // bare time
  /\d{2}\/[A-Za-z]{3}\/\d{4}(:\d{2}:\d{2}:\d{2})?( [+-]\d{4})?/g,          // CLF
];

export function normalizeTimestamps(line: string): string {
  let out = line;
  for (const re of TIMESTAMP_PATTERNS) out = out.replace(re, '<ts>');
  return out;
}

export function normalizeLine(line: string): string {
  return normalizeTimestamps(line).trim().replace(/\s+/g, ' ');
}
