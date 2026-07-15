import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { AppContext } from '../context.js';
import { hashContent } from '../lib/fileHash.js';
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
import type { AnnotationsIncludedWire, ReadOmittedWire } from '../types.js';
import { toCompressionWire } from '../types.js';
import type { ReadInput } from './schemas.js';
import {
  hasSufficientDetail,
  isAstReadMode,
  resolveReadMode,
  type ResolvedReadMode,
} from './readMode.js';

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

  if (mode === 'outline' || mode === 'signatures') {
    omitted.bodies = true;
    warnings.push('outline: function bodies omitted — use expand(ref) or read(mode=symbol) before editing');
  }
  if (urlCount > 0 && (mode === 'outline' || mode === 'signatures')) {
    omitted.urls = urlCount;
    warnings.push(`${urlCount} URL(s) in function bodies shown as // url: lines or only in expand(ref)`);
  }
  if (omittedAnnotations > 0) {
    omitted.annotations = omittedAnnotations;
    warnings.push(`${omittedAnnotations} annotation line(s) truncated — expand(ref) for full file`);
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
  symbol?: string,
) {
  const lang = astLanguageForExtension(ext);
  if (!lang || !isAstReadMode(mode)) return null;

  try {
    const extracted = await extractDeclarations(lang, content);
    const annotations =
      mode === 'outline' || mode === 'signatures'
        ? extractAnnotations(content, extracted.items)
        : { fileLevel: [], bySymbol: new Map(), critical: [] };

    let output = renderCodeViewFromExtraction(
      content,
      extracted,
      mode,
      symbol,
      annotations,
    );

    let partial = false;
    let omittedAnnotations = 0;
    if (annotations.critical.length > 0 && (mode === 'outline' || mode === 'signatures')) {
      const capped = capFileWarnings(output, ctx.encoding);
      output = capped.output;
      partial = capped.partial;
      omittedAnnotations = capped.omittedAnnotations;
    }

    const verifyOpts =
      mode === 'outline' || mode === 'signatures'
        ? {
            codeMode: mode,
            outlineItems: extracted.items,
            criticalAnnotations: annotations.critical,
          }
        : { codeMode: mode as 'symbol' };
    const verdict = verify(content, output, 'code', ctx.encoding, verifyOpts);
    if (!verdict.pass) {
      const ref = ctx.refStore.put(content);
      markServed(ctx, absPath, fileHash, ref, 'full');
      ctx.storage.recordStat(ctx.sessionId, 'read', tokensIn, tokensIn, 0);
      return {
        status: 'full' as const,
        path: absPath,
        read_mode: 'full' as const,
        content,
        verified: false,
        fallback_reason: verdict.failures.map((f) => `${f.rule}: ${f.detail}`).join('; '),
        ref,
        compression: toCompressionWire(
          { tokensIn, tokensOut: tokensIn, saved: 0, savedPct: 0 },
          ref,
        ),
      };
    }

    const tokensOut = countTokens(output, ctx.encoding);
    const ref = ctx.refStore.put(content);
    markServed(ctx, absPath, fileHash, ref, mode, symbol);
    ctx.storage.recordStat(ctx.sessionId, 'read', tokensIn, tokensOut, tokensIn - tokensOut);

    const meta = buildAstMetadata(inputMode, mode, annotations, partial, omittedAnnotations);

    return {
      status: 'compressed' as const,
      path: absPath,
      content_type: 'code' as const,
      read_mode: mode,
      content: output,
      verified: true,
      ...meta,
      ref,
      compression: toCompressionWire(
        {
          tokensIn,
          tokensOut,
          saved: tokensIn - tokensOut,
          savedPct: compressionPct(tokensIn, tokensIn - tokensOut),
        },
        ref,
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
  symbol?: string,
) {
  if (mode === 'full' || tokensIn < ctx.smallFileTokenThreshold) {
    const ref = ctx.refStore.put(content);
    markServed(ctx, absPath, fileHash, ref, 'full');
    ctx.storage.recordStat(ctx.sessionId, 'read', tokensIn, tokensIn, 0);
    return {
      status: 'full' as const,
      path: absPath,
      read_mode: 'full' as const,
      content,
      ref,
      compression: toCompressionWire(
        { tokensIn, tokensOut: tokensIn, saved: 0, savedPct: 0 },
        ref,
      ),
    };
  }

  const result = compress(content, {
    hint: ext,
    encoding: ctx.encoding,
    storeRef: (c) => ctx.refStore.put(c),
  });

  const ref = result.ref ?? ctx.refStore.put(content);
  markServed(ctx, absPath, fileHash, ref, 'plain');
  ctx.storage.recordStat(
    ctx.sessionId,
    'read',
    result.compression.tokensIn,
    result.compression.tokensOut,
    result.compression.saved,
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
    compression: toCompressionWire(result.compression, ref),
  };
}

export async function handleRead(ctx: AppContext, input: ReadInput) {
  const absPath = resolvePathInWorkspace(ctx.workspace, input.path);
  const content = readFileSync(absPath, 'utf8');
  const fileHash = hashContent(content);
  const tokensIn = countTokens(content, ctx.encoding);
  const ext = extname(absPath).replace(/^\./, '');
  const resolved = resolveReadMode(input, ctx, input.path, ext, tokensIn);
  const served = ctx.servedThisSession.get(absPath);

  if (served?.hash === fileHash && hasSufficientDetail(served, resolved.mode, resolved.symbol)) {
    ctx.storage.recordStat(ctx.sessionId, 'read', tokensIn, 0, tokensIn);
    return {
      status: 'unchanged' as const,
      path: absPath,
      ref: served.ref,
      compression: toCompressionWire(
        { tokensIn, tokensOut: 0, saved: tokensIn, savedPct: 100 },
        served.ref,
      ),
    };
  }

  if (served && served.hash !== fileHash) {
    const oldContent = ctx.refStore.get(served.ref) ?? '';
    const diffText = buildTextDiff(oldContent, content, input.path);
    const diffTokens = countTokens(diffText, ctx.encoding);
    const diffThreshold = tokensIn * ctx.diffWorthwhileRatio;

    if (diffTokens < diffThreshold) {
      const ref = ctx.refStore.put(content);
      const saved = tokensIn - diffTokens;
      markServed(ctx, absPath, fileHash, ref, resolved.mode, resolved.symbol);
      ctx.storage.recordStat(ctx.sessionId, 'read', tokensIn, diffTokens, saved);
      return {
        status: 'diff' as const,
        path: absPath,
        content: diffText,
        ref,
        previous_ref: served.ref,
        compression: toCompressionWire(
          { tokensIn, tokensOut: diffTokens, saved, savedPct: compressionPct(tokensIn, saved) },
          ref,
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
      input.mode ?? 'auto',
      resolved.symbol,
    );
    if (ast) return ast;
  }

  return serveNewContent(ctx, absPath, content, fileHash, tokensIn, ext, resolved.mode, resolved.symbol);
}
