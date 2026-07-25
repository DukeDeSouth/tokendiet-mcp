import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { AppContext } from '../context.js';
import { hashContent } from '../lib/fileHash.js';
import {
  estimateCodeOutlineSaved,
  estimateCodeOutlinePlusSaved,
  estimateTransformSaved,
  evaluateCompressGate,
} from '../lib/compressGate.js';
import { netEstimate } from '../lib/costModel.js';
import { buildTextDiff } from '../lib/textDiff.js';
import { resolvePathInWorkspace } from '../lib/workspace.js';
import { astLanguageForExtension } from '../pipeline/ast/lang.js';
import { extractDeclarations, renderCodeViewFromExtraction } from '../pipeline/ast/extract.js';
import {
  applyAnnotationBudget,
  countBodyUrls,
  defaultAnnotationBudget,
  extractAnnotations,
} from '../pipeline/annotations.js';
import { compress } from '../pipeline/pipeline.js';
import { verify } from '../pipeline/verify.js';
import { countTokens } from '../tokenize/counter.js';
import type { AnnotationsIncludedWire, CompressionWireExtras, ReadOmittedWire } from '../types.js';
import { toCompressionWire } from '../types.js';
import {
  aggregateBatchCompression,
  isSinglePathCompat,
  normalizeTargets,
  packIntoBudget,
  type ReadBatchResponse,
} from '../lib/readBatch.js';
import type { ReadInput, ReadTarget } from './schemas.js';
import {
  hasSufficientDetail,
  isAstReadMode,
  resolveReadMode,
  type ResolvedReadMode,
} from './readMode.js';

interface ReadStatOpts {
  is_follow_up?: boolean;
}

function markServed(
  ctx: AppContext,
  absPath: string,
  hash: string,
  ref: string,
  mode: ResolvedReadMode,
  symbol?: string,
): void {
  ctx.servedThisSession.set(absPath, {
    hash,
    ref,
    mode,
    ...(symbol !== undefined && { symbol }),
  });
}

function compressionPct(tokensIn: number, saved: number): number {
  return tokensIn ? Math.round((saved / tokensIn) * 100) : 0;
}

function recordReadStat(
  ctx: AppContext,
  tokensIn: number,
  tokensOut: number,
  saved: number,
  opts: ReadStatOpts = {},
): void {
  ctx.storage.recordStat(ctx.sessionId, 'read', tokensIn, tokensOut, saved, opts);
}

function wireExtras(
  saved: number,
  isFollowUp: boolean,
  ctx: AppContext,
  passthroughReason?: string,
): CompressionWireExtras {
  const extras: CompressionWireExtras = {
    net_estimate: netEstimate(saved, isFollowUp, ctx.costModel),
  };
  if (passthroughReason) extras.passthrough_reason = passthroughReason;
  return extras;
}

function serveFull(
  ctx: AppContext,
  absPath: string,
  content: string,
  fileHash: string,
  tokensIn: number,
  isFollowUp: boolean,
  passthroughReason?: string,
  verified = true,
  fallbackReason?: string,
) {
  const ref = ctx.refStore.put(content);
  markServed(ctx, absPath, fileHash, ref, 'full');
  recordReadStat(ctx, tokensIn, tokensIn, 0, { is_follow_up: isFollowUp });
  return {
    status: 'full' as const,
    path: absPath,
    read_mode: 'full' as const,
    content,
    verified,
    ...(fallbackReason && { fallback_reason: fallbackReason }),
    ref,
    compression: toCompressionWire(
      { tokensIn, tokensOut: tokensIn, saved: 0, savedPct: 0 },
      ref,
      wireExtras(0, isFollowUp, ctx, passthroughReason),
    ),
  };
}

function capFileWarnings(
  output: string,
  encoding: AppContext['encoding'],
): { output: string; partial: boolean; omittedAnnotations: number } {
  if (!output.includes('# file-warnings')) {
    return { output, partial: false, omittedAnnotations: 0 };
  }
  const idx = output.indexOf('\n# ');
  const nextSection = output.indexOf('\n# ', output.indexOf('# file-warnings') + 1);
  if (nextSection === -1) {
    return { output, partial: false, omittedAnnotations: 0 };
  }
  const header = output.slice(0, nextSection);
  const rest = output.slice(nextSection + 1);
  const body = header.replace(/^# file-warnings\n?/, '').trimEnd();
  const capped = applyAnnotationBudget(body, defaultAnnotationBudget(), encoding);
  return {
    output: `# file-warnings\n${capped.text}\n\n${rest}`,
    partial: capped.partial,
    omittedAnnotations: capped.omittedLines,
  };
}

function buildAstMetadata(
  inputMode: ReadInput['mode'],
  mode: ResolvedReadMode,
  extraction: ReturnType<typeof extractAnnotations>,
  partial: boolean,
  omittedAnnotations: number,
): {
  warnings: string[];
  omitted: ReadOmittedWire;
  annotations_included: AnnotationsIncludedWire;
  resolved_from?: 'auto';
} {
  const urlCount = countBodyUrls(extraction);
  const warnings: string[] = [];
  const omitted: ReadOmittedWire = {};

  if (mode === 'outline' || mode === 'signatures' || mode === 'outline_plus') {
    omitted.bodies = mode !== 'outline_plus';
    if (mode === 'outline_plus') {
      warnings.push(
        'outline+: large function bodies omitted — use read(mode=full) or read(mode=symbol) before editing',
      );
    } else {
      warnings.push(
        'outline: function bodies omitted — use read(mode=full) or read(mode=symbol) before editing',
      );
    }
  }
  if (urlCount > 0 && (mode === 'outline' || mode === 'signatures' || mode === 'outline_plus')) {
    omitted.urls = urlCount;
    warnings.push(`${urlCount} URL(s) in function bodies omitted — read(mode=full) for URLs in bodies`);
  }
  if (omittedAnnotations > 0) {
    omitted.annotations = omittedAnnotations;
    warnings.push(`${omittedAnnotations} annotation line(s) truncated — read(mode=full) for full file`);
  }

  let annotations_included: AnnotationsIncludedWire = true;
  if (extraction.critical.length === 0) {
    annotations_included = true;
  } else if (partial) {
    annotations_included = 'partial';
  }

  return {
    warnings,
    omitted,
    annotations_included,
    ...(inputMode === 'auto' && { resolved_from: 'auto' as const }),
  };
}

async function tryServeAst(
  ctx: AppContext,
  absPath: string,
  content: string,
  fileHash: string,
  tokensIn: number,
  ext: string,
  mode: ResolvedReadMode,
  inputMode: ReadInput['mode'],
  isFollowUp: boolean,
  symbol?: string,
) {
  const lang = astLanguageForExtension(ext);
  if (!lang || !isAstReadMode(mode)) return null;

  const estimatedSaved =
    mode === 'outline_plus'
      ? estimateCodeOutlinePlusSaved(tokensIn, ctx.costModel)
      : estimateCodeOutlineSaved(tokensIn, ctx.costModel);
  const gate = evaluateCompressGate(tokensIn, estimatedSaved, isFollowUp, ctx.costModel);
  if (gate.passthrough) {
    return serveFull(ctx, absPath, content, fileHash, tokensIn, isFollowUp, gate.reason);
  }

  try {
    const extracted = await extractDeclarations(lang, content);
    const annotations =
      mode === 'outline' || mode === 'signatures' || mode === 'outline_plus'
        ? extractAnnotations(content, extracted.items)
        : { fileLevel: [], bySymbol: new Map(), critical: [] };

    let output = renderCodeViewFromExtraction(
      content,
      extracted,
      mode,
      symbol,
      annotations,
      { costModel: ctx.costModel, encoding: ctx.encoding },
    );

    let partial = false;
    let omittedAnnotations = 0;
    if (annotations.critical.length > 0 && (mode === 'outline' || mode === 'signatures' || mode === 'outline_plus')) {
      const capped = capFileWarnings(output, ctx.encoding);
      output = capped.output;
      partial = capped.partial;
      omittedAnnotations = capped.omittedAnnotations;
    }

    let effectiveMode: ResolvedReadMode = mode;
    let verifyOpts =
      effectiveMode === 'outline' || effectiveMode === 'signatures' || effectiveMode === 'outline_plus'
        ? {
            codeMode: effectiveMode as 'outline' | 'signatures' | 'outline_plus',
            outlineItems: extracted.items,
            ...(effectiveMode === 'outline_plus' && {
              topLevelBindings: extracted.topLevelBindings,
            }),
            criticalAnnotations: annotations.critical,
          }
        : { codeMode: effectiveMode as 'symbol' };
    let verdict = verify(content, output, 'code', ctx.encoding, verifyOpts);

    if (!verdict.pass && mode === 'outline_plus') {
      const tokenOnlyFail =
        verdict.failures.length === 1 && verdict.failures[0]?.rule === 'token-reduction';
      if (tokenOnlyFail) {
        effectiveMode = 'outline';
        output = renderCodeViewFromExtraction(
          content,
          extracted,
          'outline',
          symbol,
          annotations,
          { costModel: ctx.costModel, encoding: ctx.encoding },
        );
        if (annotations.critical.length > 0) {
          const capped = capFileWarnings(output, ctx.encoding);
          output = capped.output;
          partial = capped.partial;
          omittedAnnotations = capped.omittedAnnotations;
        }
        verifyOpts = {
          codeMode: 'outline',
          outlineItems: extracted.items,
          criticalAnnotations: annotations.critical,
        };
        verdict = verify(content, output, 'code', ctx.encoding, verifyOpts);
      }
    }

    if (!verdict.pass) {
      return serveFull(
        ctx,
        absPath,
        content,
        fileHash,
        tokensIn,
        isFollowUp,
        undefined,
        false,
        verdict.failures.map((f) => `${f.rule}: ${f.detail}`).join('; '),
      );
    }

    const tokensOut = countTokens(output, ctx.encoding);
    const saved = tokensIn - tokensOut;
    const ref = ctx.refStore.put(content);
    markServed(ctx, absPath, fileHash, ref, effectiveMode, symbol);
    recordReadStat(ctx, tokensIn, tokensOut, saved, { is_follow_up: isFollowUp });

    const meta = buildAstMetadata(inputMode, effectiveMode, annotations, partial, omittedAnnotations);

    return {
      status: 'compressed' as const,
      path: absPath,
      content_type: 'code' as const,
      read_mode: effectiveMode,
      content: output,
      verified: true,
      ...meta,
      ref,
      compression: toCompressionWire(
        {
          tokensIn,
          tokensOut,
          saved,
          savedPct: compressionPct(tokensIn, saved),
        },
        ref,
        wireExtras(saved, isFollowUp, ctx),
      ),
    };
  } catch {
    return null;
  }
}

function serveNewContent(
  ctx: AppContext,
  absPath: string,
  content: string,
  fileHash: string,
  tokensIn: number,
  ext: string,
  mode: ResolvedReadMode,
  isFollowUp: boolean,
  symbol?: string,
) {
  if (mode === 'full' || tokensIn < ctx.smallFileTokenThreshold) {
    return serveFull(ctx, absPath, content, fileHash, tokensIn, isFollowUp, 'explicit_full');
  }

  const estimatedSaved = estimateTransformSaved(tokensIn, 'plain');
  const gate = evaluateCompressGate(tokensIn, estimatedSaved, isFollowUp, ctx.costModel);
  if (gate.passthrough) {
    return serveFull(ctx, absPath, content, fileHash, tokensIn, isFollowUp, gate.reason);
  }

  const result = compress(content, {
    hint: ext,
    encoding: ctx.encoding,
    storeRef: (c) => ctx.refStore.put(c),
  });

  const ref = result.ref ?? ctx.refStore.put(content);
  markServed(ctx, absPath, fileHash, ref, 'plain');
  recordReadStat(
    ctx,
    result.compression.tokensIn,
    result.compression.tokensOut,
    result.compression.saved,
    { is_follow_up: isFollowUp },
  );

  return {
    status: 'compressed' as const,
    path: absPath,
    read_mode: 'plain' as const,
    content_type: result.type,
    content: result.output,
    verified: result.verified,
    ...(result.fallbackReason && { fallback_reason: result.fallbackReason }),
    ref,
    compression: toCompressionWire(
      result.compression,
      ref,
      wireExtras(result.compression.saved, isFollowUp, ctx),
    ),
  };
}

export async function handleReadSingle(ctx: AppContext, target: ReadTarget) {
  const absPath = resolvePathInWorkspace(ctx.workspace, target.path);
  const content = readFileSync(absPath, 'utf8');
  const fileHash = hashContent(content);
  const tokensIn = countTokens(content, ctx.encoding);
  const ext = extname(absPath).replace(/^\./, '');
  const modeInput: ReadInput = {
    path: target.path,
    mode: target.mode ?? 'auto',
    ...(target.symbol !== undefined && { symbol: target.symbol }),
  };
  const resolved = resolveReadMode(modeInput, ctx, target.path, ext, tokensIn);
  const served = ctx.servedThisSession.get(absPath);
  const isFollowUp = served !== undefined;

  if (served?.hash === fileHash && hasSufficientDetail(served, resolved.mode, resolved.symbol)) {
    recordReadStat(ctx, tokensIn, 0, tokensIn);
    return {
      status: 'unchanged' as const,
      path: absPath,
      ref: served.ref,
      compression: toCompressionWire(
        { tokensIn, tokensOut: 0, saved: tokensIn, savedPct: 100 },
        served.ref,
        { net_estimate: tokensIn },
      ),
    };
  }

  if (served && served.hash !== fileHash) {
    const oldContent = ctx.refStore.get(served.ref) ?? '';
    const diffText = buildTextDiff(oldContent, content, target.path);
    const diffTokens = countTokens(diffText, ctx.encoding);
    const diffThreshold = tokensIn * ctx.diffWorthwhileRatio;

    if (diffTokens < diffThreshold) {
      const ref = ctx.refStore.put(content);
      const saved = tokensIn - diffTokens;
      markServed(ctx, absPath, fileHash, ref, resolved.mode, resolved.symbol);
      recordReadStat(ctx, tokensIn, diffTokens, saved, { is_follow_up: isFollowUp });
      return {
        status: 'diff' as const,
        path: absPath,
        content: diffText,
        ref,
        previous_ref: served.ref,
        compression: toCompressionWire(
          { tokensIn, tokensOut: diffTokens, saved, savedPct: compressionPct(tokensIn, saved) },
          ref,
          wireExtras(saved, isFollowUp, ctx),
        ),
      };
    }
  }

  if (isAstReadMode(resolved.mode)) {
    const ast = await tryServeAst(
      ctx,
      absPath,
      content,
      fileHash,
      tokensIn,
      ext,
      resolved.mode,
      target.mode ?? 'auto',
      isFollowUp,
      resolved.symbol,
    );
    if (ast) return ast;
  }

  return serveNewContent(
    ctx,
    absPath,
    content,
    fileHash,
    tokensIn,
    ext,
    resolved.mode,
    isFollowUp,
    resolved.symbol,
  );
}

export type ReadSingleResult = Awaited<ReturnType<typeof handleReadSingle>>;

export async function handleRead(
  ctx: AppContext,
  input: ReadInput,
): Promise<ReadSingleResult | ReadBatchResponse<ReadSingleResult>> {
  const targets = normalizeTargets(input);
  const results: ReadSingleResult[] = [];
  for (const target of targets) {
    results.push(await handleReadSingle(ctx, target));
  }

  let packed = results;
  let degraded: string[] = [];
  if (input.budget_tokens !== undefined) {
    const budgeted = await packIntoBudget(ctx, targets, results, input.budget_tokens, handleReadSingle);
    packed = budgeted.results;
    degraded = budgeted.degraded;
  }

  if (isSinglePathCompat(input)) {
    return packed[0]!;
  }

  const response: ReadBatchResponse<ReadSingleResult> = {
    results: packed,
    batch_compression: aggregateBatchCompression(packed),
  };
  if (degraded.length > 0) response.degraded = degraded;
  return response;
}
