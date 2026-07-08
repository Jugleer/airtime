import { describe, expect, it } from 'vitest';
import { effectiveDwell } from './index';

describe('core/timing placeholder', () => {
  it('returns the full dwell when it is not clamped', () => {
    // beta * h * tau_b = 0.75 * 3 * 0.25 = 0.5625 > 0.3
    expect(effectiveDwell(0.3, 3, 0.25)).toBeCloseTo(0.3, 12);
  });

  it('clamps dwell on small throws so air time stays positive', () => {
    // h = 1: beta * h * tau_b = 0.75 * 1 * 0.25 = 0.1875 < 0.3
    expect(effectiveDwell(0.3, 1, 0.25)).toBeCloseTo(0.1875, 12);
  });
});
