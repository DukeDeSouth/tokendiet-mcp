import type { Encoding, VerifyFailure, VerifyResult } from '../types.js';
import { countTokens } from '../tokenize/counter.js';
import type { HtmlTransformMeta } from './transforms/html.js';

export function verifyHtml(
  original: string,
  compressed: string,
  meta: HtmlTransformMeta,
  encoding: Encoding = 'o200k_base',
): VerifyResult {
  const failures: VerifyFailure[] = [];

  for (const block of meta.preCodeBlocks) {
    if (!compressed.includes(block)) {
      failures.push({
        rule: 'pre-code-preserved',
        detail: `lost pre/code block: "${block.slice(0, 80)}"`,
      });
    }
  }

  for (const url of meta.contentUrls) {
    if (!compressed.includes(url)) {
      failures.push({
        rule: 'content-url-preserved',
        detail: `lost content URL: ${url}`,
      });
    }
  }

  if (countTokens(compressed, encoding) >= countTokens(original, encoding)) {
    failures.push({
      rule: 'token-reduction',
      detail: 'compressed HTML output is not smaller in BPE tokens',
    });
  }

  return { pass: failures.length === 0, failures };
}
