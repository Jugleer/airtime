import { describe, expect, it } from 'vitest';
import { negativePart, positivePart } from './index';

describe('core/energy placeholder', () => {
  it('splits power into throw work (W+) and catch absorption (W-)', () => {
    expect(positivePart(2)).toBe(2);
    expect(positivePart(-2)).toBe(0);
    expect(negativePart(-2)).toBe(-2);
    expect(negativePart(2)).toBe(0);
  });

  it('sums the split back to the original power', () => {
    for (const power of [-3, -0.5, 0, 1.25, 4]) {
      expect(positivePart(power) + negativePart(power)).toBeCloseTo(power, 12);
    }
  });
});
