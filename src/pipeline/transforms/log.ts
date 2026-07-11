import type { TransformResult } from '../../types.js';
import { normalizeLine } from '../normalize.js';

/**
 * Log compression: collapse consecutive runs of lines that are identical
 * after timestamp/whitespace normalization into "<line> ×N".
 * The first occurrence keeps its original text (with real timestamp).
 */
export function transformLog(content: string): TransformResult {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i]!;
    const norm = normalizeLine(current);
    let run = 1;
    while (i + run < lines.length && normalizeLine(lines[i + run]!) === norm) run++;
    if (run > 1 && norm.length > 0) {
      out.push(`${current} ×${run}`);
    } else {
      for (let k = 0; k < run; k++) out.push(lines[i + k]!);
    }
    i += run;
  }

  return { output: out.join('\n') };
}
