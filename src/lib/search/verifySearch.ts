import type { Encoding, VerifyFailure, VerifyResult } from '../../types.js';
import { countTokens } from '../../tokenize/counter.js';
import { parseMoreMatchesLine, parseSnippetLine } from './baseline.js';

export interface SearchVerifyMeta {
  totalMatches: number;
  shownMatches: number;
  hiddenMatches: number;
  hiddenFiles: number;
  pathsInOutput: string[];
}

export function verifySearch(
  baseline: string,
  compressed: string,
  meta: SearchVerifyMeta,
  encoding: Encoding = 'o200k_base',
): VerifyResult {
  const failures: VerifyFailure[] = [];

  for (const path of meta.pathsInOutput) {
    if (!baseline.includes(`${path}:`)) {
      failures.push({ rule: 'paths-preserved', detail: `path missing from baseline: ${path}` });
    }
  }

  for (const line of compressed.split('\n')) {
    const snippet = parseSnippetLine(line);
    if (!snippet) continue;
    const needle = `${snippet.path}:${snippet.line}:`;
    if (!baseline.includes(needle)) {
      failures.push({
        rule: 'line-preserved',
        detail: `snippet not in baseline: ${snippet.path}:${snippet.line}`,
      });
    }
  }

  const expectedHidden = meta.totalMatches - meta.shownMatches;
  if (meta.hiddenMatches !== expectedHidden) {
    failures.push({
      rule: 'match-count',
      detail: `hidden match count ${meta.hiddenMatches} != ${expectedHidden}`,
    });
  }

  for (const line of compressed.split('\n')) {
    const more = parseMoreMatchesLine(line);
    if (!more) continue;
    if (more.hidden !== meta.hiddenMatches) {
      failures.push({
        rule: 'match-count',
        detail: `footer hidden ${more.hidden} != ${meta.hiddenMatches}`,
      });
    }
    if (more.files !== meta.hiddenFiles) {
      failures.push({
        rule: 'match-count',
        detail: `footer files ${more.files} != ${meta.hiddenFiles}`,
      });
    }
  }

  if (meta.totalMatches > 0 && meta.hiddenMatches > 0) {
    if (countTokens(compressed, encoding) >= countTokens(baseline, encoding)) {
      failures.push({
        rule: 'token-reduction',
        detail: 'compressed search output is not smaller in BPE tokens',
      });
    }
  }

  return { pass: failures.length === 0, failures };
}
