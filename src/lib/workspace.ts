import { realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export function resolveWorkspaceRoot(workspace: string): string {
  return realpathSync(resolve(workspace));
}

export function resolvePathInWorkspace(workspace: string, inputPath: string): string {
  const root = resolveWorkspaceRoot(workspace);
  const target = isAbsolute(inputPath) ? normalize(inputPath) : normalize(join(root, inputPath));
  const real = realpathSync(target);
  const rel = relative(root, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new WorkspaceError(`Path escapes workspace: ${inputPath}`);
  }
  return real;
}

export function assertCwdInWorkspace(workspace: string, cwd: string): string {
  return resolvePathInWorkspace(workspace, cwd);
}
