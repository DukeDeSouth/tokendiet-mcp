import { contentTypeForFetch, isBinaryContentType } from '../lib/fetch/contentType.js';
import { safeFetch } from '../lib/fetch/http.js';
import { compress } from '../pipeline/pipeline.js';
import { transformHtml } from '../pipeline/transforms/html.js';
import { verifyHtml } from '../pipeline/verifyHtml.js';
import { countTokens } from '../tokenize/counter.js';
import { toCompressionWire } from '../types.js';
import type { AppContext } from '../context.js';
import type { FetchInput } from './schemas.js';

export async function handleFetch(ctx: AppContext, input: FetchInput) {
  const fetched = await safeFetch(input.url);
  if (fetched.status >= 400) {
    throw new Error(`HTTP ${fetched.status} for ${fetched.url}`);
  }

  const ref = ctx.refStore.put(fetched.body);
  const tokensIn = countTokens(fetched.body, ctx.encoding);

  if (input.mode === 'raw') {
    ctx.storage.recordStat(ctx.sessionId, 'fetch', tokensIn, tokensIn, 0);
    return {
      url: fetched.url,
      status: fetched.status,
      content_type: fetched.contentType,
      mode: 'raw' as const,
      content: fetched.body,
      ref,
      verified: true,
      compression: toCompressionWire({ tokensIn, tokensOut: tokensIn, saved: 0, savedPct: 0 }, ref),
    };
  }

  if (isBinaryContentType(fetched.contentType)) {
    throw new Error(
      `binary content type not supported (${fetched.contentType}); use expand(ref) after raw fetch if needed`,
    );
  }

  const type = contentTypeForFetch(fetched.contentType, fetched.body);

  if (type === 'html') {
    const transformed = transformHtml(fetched.body);
    let content = transformed.output;
    let verified = true;
    let fallbackReason: string | undefined;

    const verdict = verifyHtml(fetched.body, content, transformed.htmlMeta, ctx.encoding);
    if (!verdict.pass) {
      content = fetched.body;
      verified = false;
      fallbackReason = verdict.failures.map((f) => `${f.rule}: ${f.detail}`).join('; ');
    }

    const tokensOut = countTokens(content, ctx.encoding);
    const saved = tokensIn - tokensOut;
    ctx.storage.recordStat(ctx.sessionId, 'fetch', tokensIn, tokensOut, saved);

    return {
      url: fetched.url,
      status: fetched.status,
      content_type: 'html',
      mode: 'auto' as const,
      content,
      verified,
      ...(fallbackReason && { fallback_reason: fallbackReason }),
      ref,
      compression: toCompressionWire(
        {
          tokensIn,
          tokensOut,
          saved,
          savedPct: tokensIn ? Math.round((saved / tokensIn) * 100) : 0,
        },
        ref,
      ),
    };
  }

  const result = compress(fetched.body, {
    hint: type,
    encoding: ctx.encoding,
    storeRef: () => ref,
  });

  const content = result.verified ? result.output : fetched.body;
  const tokensOut = countTokens(content, ctx.encoding);
  const saved = tokensIn - tokensOut;

  ctx.storage.recordStat(ctx.sessionId, 'fetch', tokensIn, tokensOut, saved);

  return {
    url: fetched.url,
    status: fetched.status,
    content_type: result.type,
    mode: 'auto' as const,
    content,
    verified: result.verified,
    ...(result.fallbackReason && { fallback_reason: result.fallbackReason }),
    ref: result.ref ?? ref,
    compression: toCompressionWire(
      {
        tokensIn,
        tokensOut,
        saved,
        savedPct: tokensIn ? Math.round((saved / tokensIn) * 100) : 0,
      },
      result.ref ?? ref,
    ),
  };
}
