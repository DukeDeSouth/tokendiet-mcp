import { describe, it, expect } from 'vitest';
import { hasTestRunnerMarkers } from '../src/pipeline/detectType.js';
import { detectType } from '../src/pipeline/detectType.js';

describe('detectType', () => {
  it('detects valid JSON', () => {
    expect(detectType('{"a": 1, "b": [1,2,3]}')).toBe('json');
    expect(detectType('  [1, 2, 3]')).toBe('json');
  });

  it('rejects invalid JSON-looking content', () => {
    expect(detectType('{not json at all')).toBe('plain');
  });

  it('detects jest/vitest output', () => {
    const out = ['PASS src/foo.test.ts', 'FAIL src/bar.test.ts', 'Tests: 1 failed, 3 passed'].join('\n');
    expect(detectType(out)).toBe('test_output');
  });

  it('detects pytest output', () => {
    const out = ['tests/test_api.py::test_login FAILED', '==== 1 failed, 12 passed in 3.42s ===='].join('\n');
    expect(detectType(out)).toBe('test_output');
  });

  it('detects go test output', () => {
    const out = ['--- FAIL: TestParse (0.00s)', 'ok   example.com/pkg  0.123s'].join('\n');
    expect(detectType(out)).toBe('test_output');
  });

  it('detects logs by timestamp/level density', () => {
    const line = '2026-07-11T10:00:00Z INFO server started';
    expect(detectType(Array(10).fill(line).join('\n'))).toBe('log');
  });

  it('detects html', () => {
    expect(detectType('<!DOCTYPE html><html><body>x</body></html>')).toBe('html');
  });

  it('respects hint over heuristics', () => {
    expect(detectType('some content', 'ts')).toBe('code');
    expect(detectType('some content', '.json')).toBe('json');
    expect(detectType('some content', 'log')).toBe('log');
    expect(detectType('{"a":1}', 'plain')).toBe('plain');
  });

  it('falls back to plain (conservative default)', () => {
    expect(detectType('Just a paragraph of ordinary text.')).toBe('plain');
  });

  it('NDJSON is not detected as json', () => {
    const ndjson = ['{"a":1}', '{"a":2}', '{"a":3}'].join('\n');
    expect(detectType(ndjson)).not.toBe('json');
  });

  it('hasTestRunnerMarkers rejects git-log style failed commits', () => {
    const gitLog = ['abc123 failed to merge feature-x', 'def456 normal commit message'].join('\n');
    expect(hasTestRunnerMarkers(gitLog)).toBe(false);
    expect(detectType(gitLog, 'log')).toBe('log');
  });

  it('hasTestRunnerMarkers accepts vitest output', () => {
    const vitest = [' Test Files  2 passed (2)', '      Tests  10 passed (10)'].join('\n');
    expect(hasTestRunnerMarkers(vitest)).toBe(true);
  });
});
