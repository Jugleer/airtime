import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { averageThrow, periodLength } from './index';

describe('core/siteswap placeholder', () => {
  it('reports the period length', () => {
    expect(periodLength([5, 3, 1])).toBe(3);
    expect(periodLength([])).toBe(0);
  });

  it('computes b as the mean throw value (average theorem)', () => {
    expect(averageThrow([5, 3, 1])).toBe(3);
    expect(averageThrow([])).toBe(0);
  });

  // Exercises fast-check now so the property-testing toolchain (PLAN.md P1/P2)
  // is proven wired in Phase 0.
  it('averageThrow equals total / length for any non-empty pattern (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 35 }), { minLength: 1, maxLength: 16 }),
        (pattern) => {
          const total = pattern.reduce((sum, value) => sum + value, 0);
          expect(averageThrow(pattern)).toBeCloseTo(total / pattern.length, 9);
        },
      ),
    );
  });
});
