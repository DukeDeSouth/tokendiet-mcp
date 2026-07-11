import { describe, it, expect } from 'vitest';
import type { OutlineItem } from '../src/pipeline/ast/types.js';
import { verify } from '../src/pipeline/verify.js';

describe('verify', () => {
  it('passes an honest compression', () => {
    const original = 'some long text\n'.repeat(50) + 'Error: connection refused at /srv/app.ts:10\n';
    const compressed = 'some long text ×50\nError: connection refused at /srv/app.ts:10';
    const res = verify(original, compressed, 'log');
    expect(res.pass).toBe(true);
  });

  it('fails when an error line is lost', () => {
    const original = 'noise\n'.repeat(30) + 'Error: disk full on /dev/sda1\n' + 'noise\n'.repeat(5);
    const compressed = 'noise ×35';
    const res = verify(original, compressed, 'log');
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.rule === 'error-preserved')).toBe(true);
  });

  it('accepts deduplicated error lines with ×N suffix', () => {
    const original = Array(10).fill('ERROR timeout after 3000 ms').join('\n') + '\n' + 'filler\n'.repeat(20);
    const compressed = 'ERROR timeout after 3000 ms ×10\nfiller ×20';
    const res = verify(original, compressed, 'log');
    expect(res.pass).toBe(true);
  });

  it('fails when a path inside error context is lost', () => {
    const original =
      'padding line\n'.repeat(30) + 'Error: ENOENT at /var/log/app/server.log:42 while reading config\n';
    const compressed = 'Error: ENOENT while reading config';
    const res = verify(original, compressed, 'log');
    expect(res.failures.some((f) => f.rule === 'paths-preserved')).toBe(true);
  });

  it('fails when a number inside error context is lost', () => {
    const original = 'padding line\n'.repeat(30) + 'Error: expected 42 but got 17\n';
    const compressed = 'Error: expected but got'; // numbers dropped
    const res = verify(original, compressed, 'log');
    expect(res.failures.some((f) => f.rule === 'numbers-preserved')).toBe(true);
  });

  it('fails when a URL is lost', () => {
    const original = 'docs at https://example.com/api/v2 here\n' + 'filler\n'.repeat(30);
    const compressed = 'filler ×30';
    const res = verify(original, compressed, 'plain');
    expect(res.failures.some((f) => f.rule === 'urls-preserved')).toBe(true);
  });

  it('fails when compression did not reduce tokens (rollback case)', () => {
    const original = 'short';
    const compressed = 'short but somehow longer than the original text';
    const res = verify(original, compressed, 'plain');
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.rule === 'token-reduction')).toBe(true);
  });

  it('fails on identical output (no strict reduction)', () => {
    const text = 'unchanged content';
    const res = verify(text, text, 'plain');
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.rule === 'token-reduction')).toBe(true);
  });
});

describe('verify code v2', () => {
  const original =
    `${Array(80).fill('// comment about error failure in handler').join('\n')}\n` +
    'export function exportedFn(a: number): number {\n  return a;\n}\n';

  const outlineItems: OutlineItem[] = [
    {
      kind: 'function',
      name: 'exportedFn',
      signature: 'export function exportedFn(a: number): number',
      startLine: 81,
      endLine: 83,
      exported: true,
      startIndex: 0,
      endIndex: original.length,
    },
  ];

  const validOutline =
    'export function exportedFn(a: number): number [81–83]\n' +
    'hint: expand(ref) for full file, read(mode=symbol, symbol="Name") for a single definition';

  it('skips error-line rules for code type', () => {
    const res = verify(original, validOutline, 'code', 'o200k_base', {
      codeMode: 'outline',
      outlineItems,
    });
    expect(res.pass).toBe(true);
    expect(res.failures.some((f) => f.rule === 'error-preserved')).toBe(false);
  });

  it('passes valid code outline with exports and signatures', () => {
    const res = verify(original, validOutline, 'code', 'o200k_base', {
      codeMode: 'outline',
      outlineItems,
    });
    expect(res.pass).toBe(true);
  });

  it('fails exports-preserved when exported name is missing', () => {
    const bad = '# outline\nfunction other() [1–2]';
    const res = verify(original, bad, 'code', 'o200k_base', {
      codeMode: 'outline',
      outlineItems,
    });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.rule === 'exports-preserved')).toBe(true);
  });

  it('fails line-range-sanity when range exceeds file length', () => {
    const bad =
      'export function exportedFn(a: number): number [900–1000]\n' +
      'hint: expand(ref) for full file, read(mode=symbol, symbol="Name") for a single definition';
    const res = verify(original, bad, 'code', 'o200k_base', {
      codeMode: 'outline',
      outlineItems,
    });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.rule === 'line-range-sanity')).toBe(true);
  });

  it('does not apply outline rules for symbol mode', () => {
    const symbolBody = 'export function exportedFn(a: number): number {\n  return a;\n}';
    const res = verify(original, symbolBody, 'code', 'o200k_base', { codeMode: 'symbol' });
    expect(res.pass).toBe(true);
    expect(res.failures.some((f) => f.rule === 'exports-preserved')).toBe(false);
  });

  it('skips urls-preserved for code outline when URLs are only in function bodies', () => {
    const urlA = 'https://docs.example.com/api/v2';
    const urlB = 'https://github.com/org/repo';
    const withUrls =
      `${Array(80).fill('// padding line for token budget').join('\n')}\n` +
      'export function fetchDocs(): string {\n' +
      `  // see ${urlA} and ${urlB}\n` +
      "  return 'ok';\n" +
      '}\n';

    const items: OutlineItem[] = [
      {
        kind: 'function',
        name: 'fetchDocs',
        signature: 'export function fetchDocs(): string',
        startLine: 81,
        endLine: 85,
        exported: true,
        startIndex: 0,
        endIndex: withUrls.length,
      },
    ];

    const outline =
      'export function fetchDocs(): string [81–85]\n' +
      'hint: expand(ref) for full file, read(mode=symbol, symbol="Name") for a single definition';

    const res = verify(withUrls, outline, 'code', 'o200k_base', {
      codeMode: 'outline',
      outlineItems: items,
    });
    expect(res.pass).toBe(true);
    expect(res.failures.some((f) => f.rule === 'urls-preserved')).toBe(false);
  });

  it('still checks urls-preserved for code without codeMode', () => {
    const original = 'const x = "https://example.com";\n'.repeat(40);
    const compressed = 'const x = "removed";\n'.repeat(5);
    const res = verify(original, compressed, 'code');
    expect(res.failures.some((f) => f.rule === 'urls-preserved')).toBe(true);
  });
});
