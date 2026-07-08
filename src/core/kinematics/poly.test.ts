import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Polynomial, realRootsInInterval, signedIntegral } from './poly';

describe('Polynomial — evaluation and algebra', () => {
  it('evaluates via Horner', () => {
    const p = new Polynomial([1, -2, 3]); // 1 - 2s + 3s²
    expect(p.eval(0)).toBe(1);
    expect(p.eval(2)).toBe(1 - 4 + 12);
  });

  it('reports the degree ignoring trailing zeros', () => {
    expect(new Polynomial([1, 2, 0, 0]).degree).toBe(1);
    expect(new Polynomial([0]).degree).toBe(0);
    expect(new Polynomial([]).degree).toBe(0);
  });

  it('adds, scales, adds a constant, and multiplies', () => {
    const a = new Polynomial([1, 2]);
    const b = new Polynomial([0, 0, 3]);
    expect(a.add(b).coeffs).toEqual([1, 2, 3]);
    expect(a.scale(2).coeffs).toEqual([2, 4]);
    expect(a.addConstant(5).coeffs).toEqual([6, 2]);
    // (1 + 2s)(3s²) = 3s² + 6s³
    expect(a.multiply(b).coeffs).toEqual([0, 0, 3, 6]);
  });

  it('differentiates and integrates as exact inverses (FTC)', () => {
    const p = new Polynomial([2, -1, 4, 6]); // 2 - s + 4s² + 6s³
    const d = p.derivative();
    expect(d.coeffs).toEqual([-1, 8, 18]);
    // ∫ derivative over [a,b] = p(b) - p(a)
    expect(d.integrate(0.3, 1.7)).toBeCloseTo(p.eval(1.7) - p.eval(0.3), 12);
    // derivative of a constant is zero
    expect(new Polynomial([5]).derivative().coeffs).toEqual([0]);
  });

  it('trims floating-point leading dust', () => {
    const p = new Polynomial([1, 2, 1e-18]);
    expect(p.trimmed().degree).toBe(1);
    expect(new Polynomial([0, 0, 0]).trimmed().coeffs).toEqual([0]);
  });
});

describe('realRootsInInterval — deterministic real-root isolation', () => {
  it('finds the root of a line', () => {
    const roots = realRootsInInterval(new Polynomial([-1, 2]), -5, 5); // 2s - 1
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBeCloseTo(0.5, 10);
  });

  it('finds both roots of a quadratic and none outside the interval', () => {
    // (s-1)(s-3) = s² - 4s + 3
    const p = new Polynomial([3, -4, 1]);
    const roots = realRootsInInterval(p, 0, 5);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(1, 9);
    expect(roots[1]).toBeCloseTo(3, 9);
    expect(realRootsInInterval(p, 1.5, 2.5)).toHaveLength(0);
  });

  it('isolates all three roots of a cubic', () => {
    // (s+2)(s)(s-2) = s³ - 4s
    const p = new Polynomial([0, -4, 0, 1]);
    const roots = realRootsInInterval(p, -3, 3);
    expect(roots.map((r) => Math.round(r))).toEqual([-2, 0, 2]);
  });

  it('returns no roots for a constant or strictly-positive polynomial', () => {
    expect(realRootsInInterval(new Polynomial([7]), -1, 1)).toEqual([]);
    // s² + 1 has no real roots
    expect(realRootsInInterval(new Polynomial([1, 0, 1]), -5, 5)).toEqual([]);
  });

  it('recovers random simple roots from a factored polynomial', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -4, max: 4, noNaN: true }), { minLength: 1, maxLength: 5 }),
        (rawRoots) => {
          // Build ∏(s - r) with well-separated roots so all are simple.
          const sorted = [...new Set(rawRoots.map((r) => Math.round(r * 2) / 2))].sort(
            (a, b) => a - b,
          );
          const separated = sorted.filter(
            (r, i) => i === 0 || r - (sorted[i - 1] as number) >= 0.5,
          );
          let poly = new Polynomial([1]);
          for (const r of separated) {
            poly = poly.multiply(new Polynomial([-r, 1]));
          }
          const found = realRootsInInterval(poly, -6, 6);
          expect(found).toHaveLength(separated.length);
          for (let i = 0; i < separated.length; i++) {
            expect(found[i]).toBeCloseTo(separated[i] as number, 6);
          }
        },
      ),
    );
  });
});

describe('signedIntegral — exact positive/negative split', () => {
  it('splits a sign-changing polynomial at its root', () => {
    // P(s) = s - 1 on [0, 2]: negative on [0,1], positive on [1,2].
    const p = new Polynomial([-1, 1]);
    const { positive, negative } = signedIntegral(p, 0, 2);
    expect(positive).toBeCloseTo(0.5, 12); // ∫_1^2 (s-1) ds
    expect(negative).toBeCloseTo(-0.5, 12); // ∫_0^1 (s-1) ds
    expect(positive + negative).toBeCloseTo(p.integrate(0, 2), 12);
  });

  it('handles a wholly-positive interval', () => {
    const p = new Polynomial([1, 0, 1]); // s² + 1 > 0
    const { positive, negative } = signedIntegral(p, -1, 1);
    expect(negative).toBe(0);
    expect(positive).toBeCloseTo(p.integrate(-1, 1), 12);
  });

  it('sums back to the plain integral for a random cubic', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -3, max: 3, noNaN: true }), { minLength: 4, maxLength: 4 }),
        ([c0, c1, c2, c3]) => {
          const p = new Polynomial([c0 as number, c1 as number, c2 as number, c3 as number]);
          const { positive, negative } = signedIntegral(p, -2, 2);
          expect(positive).toBeGreaterThanOrEqual(-1e-9);
          expect(negative).toBeLessThanOrEqual(1e-9);
          expect(positive + negative).toBeCloseTo(p.integrate(-2, 2), 9);
        },
      ),
    );
  });

  it('returns zero for a degenerate interval', () => {
    expect(signedIntegral(new Polynomial([1, 1]), 1, 1)).toEqual({ positive: 0, negative: 0 });
  });
});
