import { describe, it, expect } from 'vitest';
import {
  applyAnnotationBudget,
  extractAnnotations,
} from '../src/pipeline/annotations.js';
import type { OutlineItem } from '../src/pipeline/ast/types.js';

const SEND_PAYMENT_SOURCE = `// SECURITY: never call without owner approval
// TODO: leaks API key to logs
export async function sendPayment(amount: number) {
  const url = 'https://internal-broker.local/pay'; // don't use in prod
  return amount;
}
`;

function item(name: string, startLine: number, endLine: number, body: string): OutlineItem {
  const startIndex = SEND_PAYMENT_SOURCE.indexOf(body);
  return {
    kind: 'function',
    name,
    signature: `async function ${name}(amount: number)`,
    startLine,
    endLine,
    exported: true,
    startIndex,
    endIndex: startIndex + body.length,
  };
}

describe('extractAnnotations', () => {
  it('captures SECURITY and TODO for sendPayment', () => {
    const items = [
      item(
        'sendPayment',
        3,
        6,
        `export async function sendPayment(amount: number) {
  const url = 'https://internal-broker.local/pay'; // don't use in prod
  return amount;
}`,
      ),
    ];
    const ext = extractAnnotations(SEND_PAYMENT_SOURCE, items);
    expect(ext.fileLevel.length).toBeGreaterThan(0);
    expect(ext.fileLevel[0]!.tags).toContain('SECURITY');
    expect(ext.fileLevel[0]!.tags).toContain('TODO');
    const sym = ext.bySymbol.get('sendPayment');
    expect(sym?.some((b) => b.tags.includes('URL'))).toBe(true);
    expect(ext.critical.length).toBeGreaterThan(0);
  });

  it('returns empty for code without critical comments', () => {
    const src = `export function add(a: number, b: number) {\n  return a + b;\n}\n`;
    const items: OutlineItem[] = [
      {
        kind: 'function',
        name: 'add',
        signature: 'function add(a: number, b: number)',
        startLine: 1,
        endLine: 3,
        exported: true,
        startIndex: 0,
        endIndex: src.length - 1,
      },
    ];
    const ext = extractAnnotations(src, items);
    expect(ext.critical).toHaveLength(0);
  });
});

describe('applyAnnotationBudget', () => {
  it('truncates with marker when over budget', () => {
    const text = Array.from({ length: 50 }, (_, i) => `// SECURITY line ${i}`).join('\n');
    const res = applyAnnotationBudget(text, 20, 'o200k_base');
    expect(res.partial).toBe(true);
    expect(res.omittedLines).toBeGreaterThan(0);
    expect(res.text).toContain('expand(ref)');
  });
});
