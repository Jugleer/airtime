import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { clamp, greatestCommonDivisor } from './index';

describe('core/math clamp', () => {
  it('returns the value unchanged inside the interval', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('clamps to the nearer bound outside the interval', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('always lands within [lo, hi] for lo ≤ hi (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 2e6, noNaN: true }),
        (value, lo, span) => {
          const hi = lo + span;
          const result = clamp(value, lo, hi);
          expect(result).toBeGreaterThanOrEqual(lo);
          expect(result).toBeLessThanOrEqual(hi);
        },
      ),
    );
  });
});

describe('core/math greatestCommonDivisor', () => {
  it('matches known values', () => {
    expect(greatestCommonDivisor(12, 8)).toBe(4);
    expect(greatestCommonDivisor(17, 5)).toBe(1);
    expect(greatestCommonDivisor(0, 0)).toBe(0);
    expect(greatestCommonDivisor(9, 0)).toBe(9);
  });

  it('is sign-insensitive (uses magnitudes)', () => {
    expect(greatestCommonDivisor(-12, 8)).toBe(4);
    expect(greatestCommonDivisor(12, -8)).toBe(4);
    expect(greatestCommonDivisor(-12, -8)).toBe(4);
  });

  it('divides both inputs and is the largest such divisor (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (a, b) => {
          const g = greatestCommonDivisor(a, b);
          expect(a % g).toBe(0);
          expect(b % g).toBe(0);
          // No larger common divisor: gcd(a/g, b/g) is coprime.
          expect(greatestCommonDivisor(a / g, b / g)).toBe(1);
        },
      ),
    );
  });
});
