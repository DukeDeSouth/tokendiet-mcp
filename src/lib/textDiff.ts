import { diffLines } from 'diff';

const MAX_DIFF_LINES = 500;

/**
 * Compact unified diff between two text blobs. Capped to keep token cost bounded.
 */
export function buildTextDiff(oldText: string, newText: string, label = 'file'): string {
  const parts = diffLines(oldText, newText);
  const lines: string[] = [`--- ${label} (cached)`, `+++ ${label} (current)`];
  let emitted = 0;

  for (const part of parts) {
    if (emitted >= MAX_DIFF_LINES) break;
    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    const chunkLines = part.value.split('\n');
    if (chunkLines[chunkLines.length - 1] === '') chunkLines.pop();
    for (const line of chunkLines) {
      if (emitted >= MAX_DIFF_LINES) break;
      lines.push(`${prefix}${line}`);
      emitted++;
    }
  }

  if (emitted >= MAX_DIFF_LINES) {
    lines.push(`… (diff truncated at ${MAX_DIFF_LINES} lines)`);
  }

  return lines.join('\n');
}
