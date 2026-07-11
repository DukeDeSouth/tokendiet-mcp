import type { TransformResult } from '../../types.js';

/** Placeholder replaced with real ref in run.ts after compress. */
export const OMITTED_REF_PLACEHOLDER = '<ref>';

const omittedMarker = (n: number) =>
  `[omitted ${n} non-failure lines — expand("${OMITTED_REF_PLACEHOLDER}") for full output]`;

/** Lines that must survive: failures, errors, stack frames, summaries. */
const FAILURE_LINE = /\b(fail(ed|ure|ing)?|error|exception|fatal|panic|traceback|assert(ion)?)\b/i;
const STACK_FRAME = /^\s+at\s|^\s+File "|^\s+\S+\.\w{1,4}:\d+/;
const SUMMARY_LINE = /^\s*(Tests?:|Test Files|Test Suites:|Snapshots:|Time:|Duration|Ran \d|=+\s.*\s=+$|ok\s+\S+\s+[\d.]+m?s|---\s|\d+ (passed|failed|skipped))/m;
const GREEN_LINE = /^\s*(✓|✔|PASS(ED)?\b|ok\b)/;

const CONTEXT_LINES = 2;

/**
 * Test/build output compression: keep failures, errors, stack traces
 * (with surrounding context) and summary lines; collapse green noise
 * into a single counter line.
 */
export function transformTestOutput(content: string): TransformResult {
  const lines = content.split('\n');
  const keep = new Array<boolean>(lines.length).fill(false);
  let hasFailures = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FAILURE_LINE.test(line) || STACK_FRAME.test(line)) {
      hasFailures = hasFailures || FAILURE_LINE.test(line);
      for (let k = Math.max(0, i - CONTEXT_LINES); k <= Math.min(lines.length - 1, i + CONTEXT_LINES); k++) {
        keep[k] = true;
      }
    } else if (SUMMARY_LINE.test(line)) {
      keep[i] = true;
    }
  }

  const out: string[] = [];
  let collapsedGreen = 0;
  let totalCollapsedGreen = 0;
  let omittedOther = 0;

  const flushGreen = () => {
    if (collapsedGreen > 0) {
      totalCollapsedGreen += collapsedGreen;
      out.push(`✓ ${collapsedGreen} passing line${collapsedGreen === 1 ? '' : 's'} (collapsed)`);
      collapsedGreen = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (keep[i]) {
      flushGreen();
      out.push(line);
    } else if (GREEN_LINE.test(line)) {
      collapsedGreen++;
    } else if (line.trim().length > 0) {
      omittedOther++;
    }
  }
  flushGreen();

  const omittedLines = omittedOther + totalCollapsedGreen;
  if (omittedLines > 0) {
    out.push(omittedMarker(omittedLines));
  }

  const notes = hasFailures ? undefined : ['no failures detected; kept summary only'];
  const base: TransformResult = {
    output: out.join('\n'),
    ...(omittedLines > 0 && { omitted_lines: omittedLines }),
  };
  return notes ? { ...base, notes } : base;
}
