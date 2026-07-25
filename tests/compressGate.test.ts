import { describe, expect, it } from 'vitest';
import {
  estimateCodeOutlineSaved,
  evaluateCompressGate,
} from '../src/lib/compressGate.js';
import { DEFAULT_COST_MODEL } from '../src/lib/costModel.js';

describe('compressGate', () => {
  it('passthrough for small file on redundant turn', () => {
    const saved = estimateCodeOutlineSaved(500, DEFAULT_COST_MODEL);
    const gate = evaluateCompressGate(500, saved, true, DEFAULT_COST_MODEL);
    expect(gate.passthrough).toBe(true);
    expect(gate.reason).toBe('redundant_turn');
    expect(gate.net_estimate).toBeLessThan(0);
  });

  it('allows compress on first read when savings exceed E_turn', () => {
    const saved = estimateCodeOutlineSaved(5000, DEFAULT_COST_MODEL);
    const gate = evaluateCompressGate(5000, saved, false, DEFAULT_COST_MODEL);
    expect(gate.passthrough).toBe(false);
    expect(gate.net_estimate).toBeGreaterThan(0);
  });
});
