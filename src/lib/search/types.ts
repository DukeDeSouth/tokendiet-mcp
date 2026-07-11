export interface SearchMatch {
  /** Path relative to workspace root. */
  path: string;
  line: number;
  text: string;
}

export interface SearchCollectResult {
  matches: SearchMatch[];
  backend: 'rg' | 'fallback';
  truncated: boolean;
}

export interface CompressedSearch {
  content: string;
  shownMatches: number;
  hiddenMatches: number;
  hiddenFiles: number;
  pathsInOutput: string[];
}
