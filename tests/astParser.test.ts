import { describe, it, expect, afterEach } from 'vitest';
import { astLanguageForExtension } from '../src/pipeline/ast/lang.js';
import { parseSource, resetAstParserForTests } from '../src/pipeline/ast/parser.js';

describe('astLanguageForExtension', () => {
  it('maps ts/js to typescript and tsx/jsx to tsx', () => {
    expect(astLanguageForExtension('ts')).toBe('typescript');
    expect(astLanguageForExtension('.js')).toBe('typescript');
    expect(astLanguageForExtension('tsx')).toBe('tsx');
    expect(astLanguageForExtension('py')).toBe('python');
    expect(astLanguageForExtension('go')).toBeUndefined();
  });
});

describe('ast parser (web-tree-sitter WASM)', () => {
  afterEach(() => {
    resetAstParserForTests();
  });

  it('initializes and parses TypeScript', async () => {
    const res = await parseSource('typescript', 'export function add(a: number, b: number) { return a + b; }');
    expect(res.language).toBe('typescript');
    expect(res.rootType).toBe('program');
    expect(res.namedChildCount).toBeGreaterThan(0);
    expect(res.hasError).toBe(false);
  });

  it('initializes and parses Python', async () => {
    const res = await parseSource('python', 'def greet(name):\n    return f"hi {name}"\n');
    expect(res.language).toBe('python');
    expect(res.rootType).toBe('module');
    expect(res.namedChildCount).toBeGreaterThan(0);
    expect(res.hasError).toBe(false);
  });

  it('reuses parser cache on second parse (lazy per language)', async () => {
    const a = await parseSource('typescript', 'const x = 1;');
    const b = await parseSource('typescript', 'const y = 2;');
    expect(a.rootType).toBe('program');
    expect(b.rootType).toBe('program');
  });
});
