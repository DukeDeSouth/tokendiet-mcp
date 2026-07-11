/**
 * Gitignore-style glob matching (ripgrep-compatible subset).
 * Double-star segments may match zero directories (src/.../*.ts matches src/a.ts).
 */

function escapeRegex(ch: string): string {
  if ('.+^${}()|[]\\'.includes(ch)) return `\\${ch}`;
  return ch;
}

export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/');
  let re = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        i += 2;
        if (g[i] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else if (i >= g.length) {
          re += '.*';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += escapeRegex(c);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function globMatch(relPath: string, glob?: string): boolean {
  if (!glob) return true;
  const norm = relPath.replace(/\\/g, '/');
  const g = glob.replace(/\\/g, '/');
  // gitignore/rg: pattern without '/' matches basename at any depth
  const target = g.includes('/') ? norm : norm.slice(norm.lastIndexOf('/') + 1);
  return globToRegExp(g).test(target);
}
