import type { SearchMatch } from './types.js';

/** Ripgrep-style lines: `path:line:text` */
export function formatSearchBaseline(matches: SearchMatch[]): string {
  return matches.map((m) => `${m.path}:${m.line}:${m.text}`).join('\n');
}

const SNIPPET_LINE_RE = /^([^:]+):(\d+):/;

export function parseSnippetLine(line: string): { path: string; line: number } | undefined {
  const m = line.match(SNIPPET_LINE_RE);
  if (!m) return undefined;
  return { path: m[1]!, line: Number(m[2]) };
}

const MORE_MATCHES_RE = /^\[\+(\d+) more matches in (\d+) files\]$/;

export function parseMoreMatchesLine(line: string): { hidden: number; files: number } | undefined {
  const m = line.trim().match(MORE_MATCHES_RE);
  if (!m) return undefined;
  return { hidden: Number(m[1]), files: Number(m[2]) };
}
