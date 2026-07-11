import type { TransformResult } from '../../types.js';

/**
 * Conservative default: collapse runs of blank lines (>1 → 1) and strip
 * trailing whitespace. Nothing else.
 */
export function transformPlain(content: string): TransformResult {
  const lines = content.split('\n').map((l) => l.replace(/[ \t]+$/g, ''));
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === '') {
      blankRun++;
      if (blankRun <= 1) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return { output: out.join('\n') };
}
