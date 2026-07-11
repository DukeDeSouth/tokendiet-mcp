import type { SearchMatch } from './types.js';

const MAX_SNIPPETS_PER_FILE = 3;

export function compressSearchMatches(
  matches: SearchMatch[],
  maxResults: number,
): {
  content: string;
  shownMatches: number;
  hiddenMatches: number;
  hiddenFiles: number;
  pathsInOutput: string[];
} {
  const byFile = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const list = byFile.get(m.path) ?? [];
    list.push(m);
    byFile.set(m.path, list);
  }

  const lines: string[] = [];
  const pathsInOutput = new Set<string>();
  let shown = 0;

  for (const [path, fileMatches] of byFile) {
    if (shown >= maxResults) break;
    const take = Math.min(MAX_SNIPPETS_PER_FILE, fileMatches.length, maxResults - shown);
    for (let i = 0; i < take; i++) {
      const m = fileMatches[i]!;
      lines.push(`${m.path}:${m.line}:${m.text}`);
      pathsInOutput.add(path);
      shown++;
    }
  }

  const hiddenMatches = Math.max(0, matches.length - shown);
  let hiddenFiles = 0;
  for (const [path, fileMatches] of byFile) {
    const shownCount = lines.filter((l) => l.startsWith(`${path}:`)).length;
    if (shownCount < fileMatches.length) hiddenFiles++;
  }

  if (hiddenMatches > 0) {
    lines.push(`[+${hiddenMatches} more matches in ${hiddenFiles} files]`);
    lines.push('');
    lines.push('hint: expand(ref) for full search results');
  }

  return {
    content: lines.join('\n'),
    shownMatches: shown,
    hiddenMatches,
    hiddenFiles,
    pathsInOutput: [...pathsInOutput],
  };
}
