import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** Always skipped even without a .gitignore (rg defaults + runtime dirs). */
const DEFAULT_IGNORED = [
  'node_modules/',
  '.git/',
  'dist/',
  'wasm/',
  '.tokendiet/',
  '.dogfood-td/',
  '.test-home/',
  '.data/',
  '.cursor/',
  '.m7/',
  'coverage/',
];

export function loadWorkspaceIgnore(root: string): Ignore {
  const ig = ignore();
  ig.add(DEFAULT_IGNORED);

  const gitignorePath = join(root, '.gitignore');
  if (existsSync(gitignorePath)) {
    ig.add(readFileSync(gitignorePath, 'utf8'));
  }

  return ig;
}

/** True if this relative path should be excluded from fallback search. */
export function isIgnoredPath(ig: Ignore, relPath: string, isDir: boolean): boolean {
  const norm = relPath.replace(/\\/g, '/');
  const probe = isDir && !norm.endsWith('/') ? `${norm}/` : norm;
  return ig.ignores(probe);
}
