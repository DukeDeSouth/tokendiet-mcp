import type { ContentType, Encoding, VerifyFailure, VerifyResult } from '../types.js';
import type { OutlineItem } from './ast/types.js';
import { countTokens } from '../tokenize/counter.js';
import { normalizeLine } from './normalize.js';

/**
 * Safety verifier — the non-negotiable contract of every transform:
 *  1. error-preserved:   every original line mentioning an error/failure
 *                        survives (possibly deduplicated with a ×N marker);
 *                        skipped for type `code`;
 *  2. numbers-preserved: numbers inside those error lines survive;
 *                        skipped for type `code`;
 *  3. paths-preserved:   file paths inside those error lines survive;
 *                        skipped for type `code`;
 *  4. urls-preserved:    every URL in the document survives;
 *                        skipped for type `code` with active codeMode;
 *  5. token-reduction:   the BPE token count strictly decreased;
 *  Code outline/signatures (v2):
 *  6. exports-preserved: exported declaration names present in output;
 *  7. signature-preserved: each outline signature present in output;
 *  8. line-range-sanity: [start–end] ranges valid for the source file.
 */

const ERROR_LINE = /\b(error|fail(ed|ure|ing)?|exception|fatal|panic)\b/i;
const URL_RE = /https?:\/\/[^\s"')\]}>]+/g;
const PATH_RE = /(?:^|[\s"'(=])((?:\/|\.{1,2}\/)[\w@.-]+(?:\/[\w@.-]+)+|[\w@./-]+\.\w{1,4}:\d+)/g;
const NUMBER_RE = /\d+(?:\.\d+)?/g;
const LINE_RANGE_RE = /\[(\d+)[–-](\d+)\]/g;

export interface VerifyOptions {
  codeMode?: 'outline' | 'signatures' | 'symbol';
  outlineItems?: OutlineItem[];
}

function errorLines(content: string): string[] {
  return content.split('\n').filter((l) => ERROR_LINE.test(l));
}

function extractAll(re: RegExp, text: string, group = 0): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
    const v = m[group];
    if (v !== undefined) out.add(v);
  }
  return out;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function signaturePresent(compressed: string, item: OutlineItem): boolean {
  const sig = oneLine(item.signature);
  if (compressed.includes(sig)) return true;
  if (item.exported && !sig.startsWith('export ')) {
    if (compressed.includes(`export ${sig}`)) return true;
  }
  return compressed.includes(item.name) && sig.includes(item.name);
}

function verifyCodeOutline(
  original: string,
  compressed: string,
  items: OutlineItem[],
): VerifyFailure[] {
  const failures: VerifyFailure[] = [];
  const lineCount = original.split('\n').length;

  for (const item of items) {
    if (item.exported && !compressed.includes(item.name)) {
      failures.push({
        rule: 'exports-preserved',
        detail: `missing exported name: ${item.name}`,
      });
    }
  }

  for (const item of items) {
    if (!signaturePresent(compressed, item)) {
      failures.push({
        rule: 'signature-preserved',
        detail: `missing signature for: ${item.name}`,
      });
    }
  }

  for (const m of compressed.matchAll(LINE_RANGE_RE)) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (start > end) {
      failures.push({
        rule: 'line-range-sanity',
        detail: `invalid range [${start}–${end}]: start > end`,
      });
    } else if (start < 1 || end > lineCount) {
      failures.push({
        rule: 'line-range-sanity',
        detail: `range [${start}–${end}] outside file lines (1–${lineCount})`,
      });
    }
  }

  return failures;
}

export function verify(
  original: string,
  compressed: string,
  type: ContentType,
  encoding: Encoding = 'o200k_base',
  options: VerifyOptions = {},
): VerifyResult {
  const failures: VerifyFailure[] = [];
  const skipErrorRules = type === 'code';

  if (!skipErrorRules) {
    const compressedNormLines = compressed.split('\n').map(normalizeLine);
    const origErrorLines = errorLines(original);

    for (const line of origErrorLines) {
      const norm = normalizeLine(line);
      if (norm.length === 0) continue;
      const found = compressedNormLines.some((cl) => cl === norm || cl.startsWith(`${norm} ×`));
      if (!found) {
        failures.push({ rule: 'error-preserved', detail: `lost error line: "${norm.slice(0, 120)}"` });
      }
    }

    const errorContext = origErrorLines.join('\n');
    if (errorContext.length > 0) {
      for (const num of extractAll(NUMBER_RE, errorContext)) {
        if (!compressed.includes(num)) {
          failures.push({ rule: 'numbers-preserved', detail: `lost number from error context: ${num}` });
        }
      }
      for (const p of extractAll(PATH_RE, errorContext, 1)) {
        if (!compressed.includes(p)) {
          failures.push({ rule: 'paths-preserved', detail: `lost path from error context: ${p}` });
        }
      }
    }
  }

  const codeMode = options.codeMode;
  const skipUrlRules = type === 'code' && codeMode !== undefined;

  if (!skipUrlRules) {
    for (const url of extractAll(URL_RE, original)) {
      if (!compressed.includes(url)) {
        failures.push({ rule: 'urls-preserved', detail: `lost URL: ${url}` });
      }
    }
  }

  if (
    type === 'code' &&
    (codeMode === 'outline' || codeMode === 'signatures') &&
    options.outlineItems
  ) {
    failures.push(...verifyCodeOutline(original, compressed, options.outlineItems));
  }

  if (countTokens(compressed, encoding) >= countTokens(original, encoding)) {
    failures.push({ rule: 'token-reduction', detail: 'compressed output is not smaller in BPE tokens' });
  }

  return { pass: failures.length === 0, failures };
}
