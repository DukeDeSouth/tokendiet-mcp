import { describe, it, expect } from 'vitest';
import { outlinePlusBodyBudget, functionBodySource } from '../src/pipeline/outlinePlus.js';
import { extractDeclarations, renderCodeViewFromExtraction } from '../src/pipeline/ast/extract.js';
import { countTokens } from '../src/tokenize/counter.js';
import { DEFAULT_COST_MODEL } from '../src/lib/costModel.js';
import { verify } from '../src/pipeline/verify.js';

function largeConfigFixture(extraFns = 0): string {
  const extras = Array.from(
    { length: extraFns },
    (_, i) => `export function extra${i}(a: number, b: number): number {\n  return a + b + ${i};\n}\n`,
  ).join('');
  return `export const API_URL = 'https://api.example.com/v1';
export const MAX_RETRIES = 3;

export function tiny(): number {
  return 1;
}

export function medium(a: number, b: number): number {
  return a + b + 1;
}

export function large(x: number): number {
  let sum = 0;
${Array.from({ length: 80 }, (_, i) => `  sum += x * ${i};`).join('\n')}
  return sum;
}
${extras}`;
}

describe('outlinePlus', () => {
  it('body budget derives from T_full (min 200, 10% of threshold)', () => {
    const budget = outlinePlusBodyBudget(DEFAULT_COST_MODEL);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(200);
  });

  it('includes top-level exports and small function bodies', async () => {
    const source = largeConfigFixture(30);
    const extracted = await extractDeclarations('typescript', source);
    expect(extracted.topLevelBindings.map((b) => b.name)).toEqual(
      expect.arrayContaining(['API_URL', 'MAX_RETRIES']),
    );

    const output = renderCodeViewFromExtraction(
      source,
      extracted,
      'outline_plus',
      undefined,
      undefined,
      { costModel: DEFAULT_COST_MODEL },
    );

    expect(output).toContain('# top-level');
    expect(output).toContain("export const API_URL = 'https://api.example.com/v1'");
    expect(output).toContain('# outline_plus');
    expect(output).toContain('function tiny()');
    expect(output).not.toContain('hint: expand(ref)');
    expect(output).toContain('read(mode=full)');
  });

  it('omits large function bodies beyond per-file budget', async () => {
    const source = largeConfigFixture(30);
    const extracted = await extractDeclarations('typescript', source);
    const large = extracted.items.find((i) => i.name === 'large');
    expect(large).toBeDefined();
    const body = functionBodySource(source, large!);
    expect(body).toBeTruthy();
    expect(countTokens(body!, 'o200k_base')).toBeGreaterThan(outlinePlusBodyBudget());

    const output = renderCodeViewFromExtraction(
      source,
      extracted,
      'outline_plus',
      undefined,
      undefined,
      { costModel: DEFAULT_COST_MODEL },
    );
    expect(output).toContain('function large(x: number)');
    expect(output).not.toContain('sum += x * 79');
  });

  it('passes verifier on sufficiently large modules', async () => {
    const source = largeConfigFixture(40);
    const extracted = await extractDeclarations('typescript', source);
    const output = renderCodeViewFromExtraction(
      source,
      extracted,
      'outline_plus',
      undefined,
      undefined,
      { costModel: DEFAULT_COST_MODEL },
    );
    const res = verify(source, output, 'code', 'o200k_base', {
      codeMode: 'outline_plus',
      outlineItems: extracted.items,
      topLevelBindings: extracted.topLevelBindings,
    });
    expect(res.pass).toBe(true);
  });

  it('outline_plus is smaller than full source for large modules', async () => {
    const source = largeConfigFixture(60);
    const extracted = await extractDeclarations('typescript', source);
    const output = renderCodeViewFromExtraction(
      source,
      extracted,
      'outline_plus',
      undefined,
      undefined,
      { costModel: DEFAULT_COST_MODEL },
    );
    expect(countTokens(output)).toBeLessThan(countTokens(source));
  });
});
