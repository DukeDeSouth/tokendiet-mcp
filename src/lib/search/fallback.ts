import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Ignore } from 'ignore';
import { resolveWorkspaceRoot } from '../workspace.js';
import { globMatch } from './glob.js';
import { isIgnoredPath, loadWorkspaceIgnore } from './ignoreFilter.js';
import { SEARCH_MATCH_CAP } from './rg.js';
import type { SearchCollectResult, SearchMatch } from './types.js';

const MAX_FILES = 5000;
const BINARY_SAMPLE = 8192;

function isBinaryFile(absPath: string): boolean {
  try {
    const buf = readFileSync(absPath).subarray(0, BINARY_SAMPLE);
    return buf.includes(0);
  } catch {
    return true;
  }
}

function walkFiles(
  root: string,
  dir: string,
  ig: Ignore,
  out: string[],
  limit: { n: number },
): void {
  if (limit.n >= MAX_FILES) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (limit.n >= MAX_FILES) return;
    const abs = join(dir, ent.name);
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      if (isIgnoredPath(ig, rel, true)) continue;
      walkFiles(root, abs, ig, out, limit);
    } else if (ent.isFile()) {
      if (isIgnoredPath(ig, rel, false)) continue;
      out.push(rel);
      limit.n++;
    }
  }
}

export function searchFallback(
  workspace: string,
  query: string,
  glob?: string,
): SearchCollectResult {
  const root = resolveWorkspaceRoot(workspace);
  const ig = loadWorkspaceIgnore(root);
  const files: string[] = [];
  walkFiles(root, root, ig, files, { n: 0 });

  let regex: RegExp;
  try {
    regex = new RegExp(query);
  } catch (err) {
    throw new Error(`invalid regex: ${err instanceof Error ? err.message : String(err)}`);
  }

  const matches: SearchMatch[] = [];
  let truncated = false;

  for (const rel of files) {
    if (!globMatch(rel, glob)) continue;
    const abs = join(root, rel);
    if (isBinaryFile(abs)) continue;
    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i]!)) {
        matches.push({ path: rel, line: i + 1, text: lines[i]! });
        if (matches.length >= SEARCH_MATCH_CAP) {
          truncated = true;
          return { matches, backend: 'fallback', truncated };
        }
      }
    }
  }

  return { matches, backend: 'fallback', truncated };
}
