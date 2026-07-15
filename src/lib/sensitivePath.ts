import { globMatch } from './search/glob.js';

const DEFAULT_SENSITIVE_GLOBS = [
  '**/auth/**',
  '**/security/**',
  '**/payments/**',
  '**/*secret*',
];

export function sensitiveGlobs(): string[] {
  const raw = process.env.TOKENDIET_SENSITIVE_GLOBS;
  if (!raw?.trim()) return DEFAULT_SENSITIVE_GLOBS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSensitivePath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  return sensitiveGlobs().some((g) => globMatch(norm, g));
}
