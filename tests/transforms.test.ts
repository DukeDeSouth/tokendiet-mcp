import { describe, it, expect } from 'vitest';
import { transformLog } from '../src/pipeline/transforms/log.js';
import { transformJson } from '../src/pipeline/transforms/json.js';
import { transformTestOutput } from '../src/pipeline/transforms/testOutput.js';
import { transformPlain } from '../src/pipeline/transforms/plain.js';

describe('transformLog', () => {
  it('collapses repeated lines with ×N marker', () => {
    const input = Array(137).fill('2026-07-11T10:00:00Z INFO heartbeat ok').join('\n');
    const { output } = transformLog(input);
    expect(output).toContain('×137');
    expect(output.split('\n')).toHaveLength(1);
  });

  it('collapses lines identical after timestamp normalization', () => {
    const input = [
      '2026-07-11T10:00:01Z INFO polling',
      '2026-07-11T10:00:02Z INFO polling',
      '2026-07-11T10:00:03Z INFO polling',
    ].join('\n');
    const { output } = transformLog(input);
    expect(output).toContain('×3');
    // first occurrence keeps its original timestamp
    expect(output).toContain('10:00:01');
  });

  it('keeps unique lines untouched', () => {
    const input = ['line one', 'line two', 'line three'].join('\n');
    expect(transformLog(input).output).toBe(input);
  });
});

describe('transformJson', () => {
  it('compacts and truncates long arrays with schema marker', () => {
    const data = { items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `n${i}` })) };
    const { output } = transformJson(JSON.stringify(data, null, 2));
    const parsed = JSON.parse(output);
    expect(parsed.items).toHaveLength(6); // 5 items + truncation marker
    expect(parsed.items[5]).toContain('+45 items');
    expect(parsed.items[5]).toContain('{id,name}');
  });

  it('handles nested arrays recursively', () => {
    const data = { outer: [{ inner: Array.from({ length: 20 }, (_, i) => i) }] };
    const { output } = transformJson(JSON.stringify(data));
    const parsed = JSON.parse(output);
    expect(parsed.outer[0].inner).toHaveLength(6);
  });

  it('short arrays pass through unchanged', () => {
    const data = { a: [1, 2, 3] };
    const { output } = transformJson(JSON.stringify(data));
    expect(JSON.parse(output)).toEqual(data);
  });

  it('returns original on invalid JSON with a note', () => {
    const res = transformJson('{broken');
    expect(res.output).toBe('{broken');
    expect(res.notes).toBeDefined();
  });
});

describe('transformTestOutput', () => {
  // Green lines adjacent to the failure stay (±2 context lines by design);
  // greens far from any failure must collapse.
  const failing = [
    ...Array.from({ length: 20 }, (_, i) => `✓ case ${i}`),
    'FAIL src/math.test.ts',
    '  ● divides numbers',
    '    Error: expected 2 but received Infinity',
    '      at Object.<anonymous> (src/math.test.ts:14:5)',
    ...Array.from({ length: 20 }, (_, i) => `✓ case ${20 + i}`),
    'Tests: 1 failed, 40 passed',
  ].join('\n');

  it('keeps failures, errors and stack frames', () => {
    const { output } = transformTestOutput(failing);
    expect(output).toContain('FAIL src/math.test.ts');
    expect(output).toContain('Error: expected 2 but received Infinity');
    expect(output).toContain('src/math.test.ts:14:5');
    expect(output).toContain('Tests: 1 failed, 40 passed');
  });

  it('collapses green noise into a counter', () => {
    const { output } = transformTestOutput(failing);
    expect(output).toMatch(/✓ \d+ passing lines? \(collapsed\)/);
    expect(output).not.toContain('✓ case 5'); // far from failure — collapsed
  });

  it('green-only run keeps summary and omitted marker', () => {
    const green = [...Array.from({ length: 30 }, (_, i) => `✓ test case ${i}`), 'Tests: 30 passed'].join('\n');
    const { output, notes, omitted_lines } = transformTestOutput(green);
    expect(output).toContain('Tests: 30 passed');
    expect(output).toContain('(collapsed)');
    expect(output).toContain('[omitted 30 non-failure lines');
    expect(omitted_lines).toBe(30);
    expect(notes).toBeDefined();
  });

  it('reports omitted count for collapsed greens and dropped noise', () => {
    const { output, omitted_lines } = transformTestOutput(failing);
    expect(omitted_lines).toBeGreaterThan(0);
    expect(output).toContain(`[omitted ${omitted_lines} non-failure lines`);
  });
});

describe('transformPlain', () => {
  it('collapses blank line runs and trims trailing whitespace', () => {
    const input = 'a   \n\n\n\nb\t\nc';
    expect(transformPlain(input).output).toBe('a\n\nb\nc');
  });
});
