import type { AppContext } from '../context.js';
import { runCommand } from '../lib/runCommand.js';
import { assertCwdInWorkspace } from '../lib/workspace.js';
import { hasTestRunnerMarkers } from '../pipeline/detectType.js';
import { compress } from '../pipeline/pipeline.js';
import { OMITTED_REF_PLACEHOLDER } from '../pipeline/transforms/testOutput.js';
import { countTokens } from '../tokenize/counter.js';
import type { Compression } from '../types.js';
import { toCompressionWire } from '../types.js';
import type { RunInput } from './schemas.js';

function injectOmittedRef(output: string, ref: string): string {
  return output.replace(`expand("${OMITTED_REF_PLACEHOLDER}")`, `expand("${ref}")`);
}

function compressionForContent(tokensIn: number, content: string, encoding: AppContext['encoding']): Compression {
  const tokensOut = countTokens(content, encoding);
  const saved = tokensIn - tokensOut;
  return {
    tokensIn,
    tokensOut,
    saved,
    savedPct: tokensIn ? Math.round((saved / tokensIn) * 100) : 0,
  };
}

export async function handleRun(ctx: AppContext, input: RunInput) {
  const cwd = assertCwdInWorkspace(ctx.workspace, input.cwd ?? ctx.workspace);
  const run = await runCommand(input.command, cwd);
  const combined = [
    run.stdout,
    run.stderr ? `--- stderr ---\n${run.stderr}` : '',
    run.timedOut ? '\n[timeout: command exceeded 120s]' : '',
    run.truncated ? '\n[output truncated at 10MB]' : '',
    run.exitCode !== null ? `\n[exit code: ${run.exitCode}]` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const hint = hasTestRunnerMarkers(combined) ? 'test_output' : 'log';
  const result = compress(combined, {
    hint,
    encoding: ctx.encoding,
    storeRef: (c) => ctx.refStore.put(c),
  });

  const ref = result.ref ?? ctx.refStore.put(combined);
  const content =
    result.omitted_lines !== undefined ? injectOmittedRef(result.output, ref) : result.output;
  const compression = compressionForContent(result.compression.tokensIn, content, ctx.encoding);

  ctx.storage.recordStat(
    ctx.sessionId,
    'run',
    compression.tokensIn,
    compression.tokensOut,
    compression.saved,
  );

  return {
    command: input.command,
    cwd,
    exit_code: run.exitCode,
    timed_out: run.timedOut,
    truncated: run.truncated,
    content_type: result.type,
    content,
    verified: result.verified,
    ...(result.omitted_lines !== undefined && { omitted_lines: result.omitted_lines }),
    ...(result.fallbackReason && { fallback_reason: result.fallbackReason }),
    ref,
    compression: toCompressionWire(compression, ref),
  };
}
