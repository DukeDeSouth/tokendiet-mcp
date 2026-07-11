import { describe, it, expect, afterEach } from 'vitest';
import { extractCodeView, extractDeclarations } from '../src/pipeline/ast/extract.js';
import { resetAstParserForTests } from '../src/pipeline/ast/parser.js';
import { countTokens } from '../src/tokenize/counter.js';

const FIXTURE = `"""Sample service module."""
import os
from pathlib import Path

def helper(x: int) -> int:
    """Double a value."""
    return x * 2

@dataclass
class Foo:
    """Widget store."""

    def bar(self, n: int) -> str:
        """Format n."""
        return str(n)

async def main() -> None:
    pass
`;

describe('Python AST extractors', () => {
  afterEach(() => {
    resetAstParserForTests();
  });

  it('extracts declarations from fixture', async () => {
    const { imports, items } = await extractDeclarations('python', FIXTURE);
    expect(imports).toEqual(['os', 'pathlib']);
    expect(items.map((i) => i.name)).toEqual(['helper', 'Foo', 'bar', 'main']);
    expect(items.find((i) => i.name === 'Foo')?.kind).toBe('class');
    expect(items.find((i) => i.name === 'bar')?.kind).toBe('method');
  });

  it('outline snapshot', async () => {
    const outline = await extractCodeView('python', FIXTURE, 'outline');
    expect(outline).toMatchSnapshot();
    expect(outline).toContain('def helper(x: int) -> int:');
    expect(outline).toContain('@dataclass');
    expect(outline).toContain('def bar(self, n: int) -> str:');
  });

  it('signatures mode includes docstrings', async () => {
    const sigs = await extractCodeView('python', FIXTURE, 'signatures');
    expect(sigs).toContain('"""Double a value."""');
    expect(sigs).toContain('"""Widget store."""');
    expect(sigs).toContain('# signatures');
  });

  it('symbol mode for class method', async () => {
    const body = await extractCodeView('python', FIXTURE, 'symbol', 'Foo.bar');
    expect(body).toContain('def bar(self, n: int) -> str:');
    expect(body).toContain('return str(n)');
    expect(body).not.toContain('class Foo');
  });

  it('symbol mode for decorated class includes decorators', async () => {
    const body = await extractCodeView('python', FIXTURE, 'symbol', 'Foo');
    expect(body).toContain('@dataclass');
    expect(body).toContain('class Foo:');
  });

  it('outline is smaller than full source in tokens for larger module', async () => {
    const large = FIXTURE + '\n' + Array.from({ length: 80 }, (_, i) =>
      `def fn_${i}(a: int, b: int, c: int) -> int:\n    """Compute ${i}."""\n    x = a + b\n    y = x + c\n    z = y + ${i}\n    return z\n`,
    ).join('\n');
    const outline = await extractCodeView('python', large, 'outline');
    const full = countTokens(large);
    const out = countTokens(outline);
    expect(out).toBeLessThan(full);
    expect(out / full).toBeLessThan(0.5);
  });
});
