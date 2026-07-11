import { describe, it, expect } from 'vitest';
import { globMatch } from '../src/lib/search/glob.js';

describe('globMatch', () => {
  it('matches **/*.ts for nested and shallow paths', () => {
    expect(globMatch('src/a.ts', '**/*.ts')).toBe(true);
    expect(globMatch('src/tools/read.ts', '**/*.ts')).toBe(true);
    expect(globMatch('a.ts', '**/*.ts')).toBe(true);
  });

  it('matches src/**/*.ts when ** spans zero directories', () => {
    expect(globMatch('src/a.ts', 'src/**/*.ts')).toBe(true);
    expect(globMatch('src/tools/read.ts', 'src/**/*.ts')).toBe(true);
  });

  it('matches single-segment globs', () => {
    expect(globMatch('src/tools/read.ts', 'src/tools/*.ts')).toBe(true);
    expect(globMatch('src/a.ts', 'src/tools/*.ts')).toBe(false);
  });

  it('matches basename-only globs at any depth (rg/gitignore)', () => {
    expect(globMatch('src/tools/read.ts', '*.ts')).toBe(true);
    expect(globMatch('deep/nested/foo.ts', '*.ts')).toBe(true);
    expect(globMatch('src/tools/read.ts', '*.js')).toBe(false);
    expect(globMatch('readme.ts', '*.ts')).toBe(true);
  });
});
