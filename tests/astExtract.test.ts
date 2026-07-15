import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { extractCodeView, extractDeclarations } from '../src/pipeline/ast/extract.js';
import { resetAstParserForTests } from '../src/pipeline/ast/parser.js';
import { countTokens } from '../src/tokenize/counter.js';

const READ_TS = join(process.cwd(), 'src/tools/read.ts');

describe('TypeScript AST extractors', () => {
  afterEach(() => {
    resetAstParserForTests();
  });

  it('extracts declarations from read.ts', async () => {
    const source = readFileSync(READ_TS, 'utf8');
    const { imports, items } = await extractDeclarations('typescript', source);
    expect(imports.length).toBeGreaterThanOrEqual(8);
    expect(items.map((i) => i.name)).toContain('handleRead');
    expect(items.map((i) => i.name)).toContain('serveNewContent');
    expect(items.find((i) => i.name === 'handleRead')?.exported).toBe(true);
  });

  it('outline snapshot for read.ts', async () => {
    const source = readFileSync(READ_TS, 'utf8');
    const outline = await extractCodeView('typescript', source, 'outline');
    expect(outline).toMatchSnapshot();
    expect(outline).toContain('export async function handleRead');
    expect(outline).toContain('[268–');
    expect(outline).toContain('hint: expand(ref)');
  });

  it('signatures mode includes full signature text', async () => {
    const source = readFileSync(READ_TS, 'utf8');
    const sigs = await extractCodeView('typescript', source, 'signatures');
    expect(sigs).toContain('function handleRead(ctx: AppContext, input: ReadInput)');
    expect(sigs).toContain('# signatures');
  });

  it('symbol mode returns full node source', async () => {
    const source = readFileSync(READ_TS, 'utf8');
    const body = await extractCodeView('typescript', source, 'symbol', 'compressionPct');
    expect(body).toContain('function compressionPct');
    expect(body).toContain('return tokensIn');
    expect(body).not.toContain('function handleRead');
  });

  it('outline is smaller than full file in tokens', async () => {
    const source = readFileSync(READ_TS, 'utf8');
    const outline = await extractCodeView('typescript', source, 'outline');
    const full = countTokens(source);
    const out = countTokens(outline);
    expect(out).toBeLessThan(full);
    expect(out / full).toBeLessThan(0.5);
  });
});
