import type { ContentType } from '../types.js';

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h',
  'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'scala', 'sh', 'bash', 'zsh', 'sql',
]);

const CONTENT_TYPES: ReadonlySet<string> = new Set([
  'code', 'test_output', 'log', 'json', 'html', 'plain',
]);

/** Skip full JSON.parse on very large inputs; prefix check only. */
const JSON_PARSE_SIZE_CAP = 1_000_000;

const TEST_RUNNER_MARKERS: RegExp[] = [
  /^\s*(PASS|FAIL)\s+\S+/m,                          // jest/vitest suite lines
  /^\s*Tests:\s+\d+/m,                               // jest summary
  /^\s*Test Files\s+\d+/m,                           // vitest summary
  /^=+\s.*\b(passed|failed|error|skipped)\b.*\s=+$/m, // pytest summary bar
  /^(FAILED|PASSED|ERROR)\s+\S+::/m,                  // pytest verbose lines
  /^\S+::\S+\s+(FAILED|PASSED|ERROR)/m,               // pytest verbose lines (name first)
  /^--- (FAIL|PASS):\s/m,                             // go test
  /^ok\s+\S+\s+[\d.]+m?s/m,                           // go test package ok
];

/** True when output contains a real test-runner signature (jest/vitest/pytest/go test). */
export function hasTestRunnerMarkers(content: string): boolean {
  return TEST_RUNNER_MARKERS.some((re) => re.test(content));
}

export { TEST_RUNNER_MARKERS };

const LOG_LINE = /^(\d{4}-\d{2}-\d{2}[T ]|\[\d{4}-\d{2}-\d{2}|\[?(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\]?[ :])/;

function looksLikeJson(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  if (content.length > JSON_PARSE_SIZE_CAP) return true; // prefix heuristic only
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function looksLikeLog(content: string): boolean {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 5) return false;
  const logLike = lines.filter((l) => LOG_LINE.test(l)).length;
  return logLike / lines.length >= 0.3;
}

/**
 * Detect content type. Hint (a ContentType name or a file extension) wins over
 * heuristics. Unknown content falls back to 'plain' — the conservative default.
 */
export function detectType(content: string, hint?: string): ContentType {
  if (hint) {
    const h = hint.toLowerCase().replace(/^\./, '');
    if (CONTENT_TYPES.has(h)) return h as ContentType;
    if (h === 'json') return 'json';
    if (h === 'html' || h === 'htm') return 'html';
    if (h === 'log') return 'log';
    if (CODE_EXTENSIONS.has(h)) return 'code';
  }

  if (looksLikeJson(content)) return 'json';
  if (hasTestRunnerMarkers(content)) return 'test_output';
  if (looksLikeLog(content)) return 'log';

  const head = content.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';

  return 'plain';
}
