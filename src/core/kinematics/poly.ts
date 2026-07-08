// src/core/kinematics/poly — real univariate polynomials in a local time
// variable `s`, with exact analytic derivatives/antiderivatives and deterministic
// real-root isolation (DESIGN.md §4.4, §4.5).
//
// This is the closed-form backbone of the kinematics/energy layer: every motion
// segment is a per-axis polynomial in `s`, so position/velocity/acceleration/jerk
// are exact coefficient operations — never numeric differentiation (CLAUDE.md
// hard rule 3). Power P = F·v is itself a polynomial, integrated in closed form;
// the W⁺/W⁻ split needs the sign-change roots of P, found by an exact
// derivative-guided monotone isolation + bisection (deterministic; not numeric
// differentiation — it differentiates the *coefficients*, not the trajectory).
//
// Pure and deterministic: no Date.now / Math.random / performance.

/** Relative threshold below which a leading coefficient is treated as zero. */
const LEADING_EPS = 1e-14;

/**
 * A polynomial c0 + c1·s + c2·s² + … stored as ascending coefficients.
 * Immutable; every operation returns a fresh polynomial.
 */
export class Polynomial {
  /** Ascending coefficients [c0, c1, …]; always length ≥ 1. */
  readonly coeffs: readonly number[];

  constructor(coeffs: readonly number[]) {
    this.coeffs = coeffs.length > 0 ? coeffs : [0];
  }

  /** Highest index with a nonzero coefficient (0 for a constant/zero poly). */
  get degree(): number {
    for (let i = this.coeffs.length - 1; i >= 0; i--) {
      if ((this.coeffs[i] ?? 0) !== 0) {
        return i;
      }
    }
    return 0;
  }

  /** Evaluate at `s` (Horner's method). */
  eval(s: number): number {
    let result = 0;
    for (let i = this.coeffs.length - 1; i >= 0; i--) {
      result = result * s + (this.coeffs[i] ?? 0);
    }
    return result;
  }

  /** Analytic derivative dP/ds (coefficient rule — not numeric). */
  derivative(): Polynomial {
    if (this.coeffs.length <= 1) {
      return new Polynomial([0]);
    }
    const out: number[] = [];
    for (let i = 1; i < this.coeffs.length; i++) {
      out.push((this.coeffs[i] ?? 0) * i);
    }
    return new Polynomial(out);
  }

  /** Antiderivative ∫P ds with integration constant 0. */
  antiderivative(): Polynomial {
    const out: number[] = [0];
    for (let i = 0; i < this.coeffs.length; i++) {
      out.push((this.coeffs[i] ?? 0) / (i + 1));
    }
    return new Polynomial(out);
  }

  /** Definite integral ∫_lo^hi P ds, exact. */
  integrate(lo: number, hi: number): number {
    const anti = this.antiderivative();
    return anti.eval(hi) - anti.eval(lo);
  }

  /** Sum of two polynomials. */
  add(other: Polynomial): Polynomial {
    const n = Math.max(this.coeffs.length, other.coeffs.length);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      out[i] = (this.coeffs[i] ?? 0) + (other.coeffs[i] ?? 0);
    }
    return new Polynomial(out);
  }

  /** Scale by a constant. */
  scale(factor: number): Polynomial {
    return new Polynomial(this.coeffs.map((c) => c * factor));
  }

  /** Add a constant to the polynomial (shifts c0 only). */
  addConstant(value: number): Polynomial {
    const out = [...this.coeffs];
    out[0] = (out[0] ?? 0) + value;
    return new Polynomial(out);
  }

  /** Polynomial product (coefficient convolution). */
  multiply(other: Polynomial): Polynomial {
    const out = new Array<number>(this.coeffs.length + other.coeffs.length - 1).fill(0);
    for (let i = 0; i < this.coeffs.length; i++) {
      const a = this.coeffs[i] ?? 0;
      for (let j = 0; j < other.coeffs.length; j++) {
        out[i + j] = (out[i + j] ?? 0) + a * (other.coeffs[j] ?? 0);
      }
    }
    return new Polynomial(out);
  }

  /**
   * A copy with negligible leading coefficients trimmed (|c| ≤ relEps·maxAbs),
   * so `degree` and root isolation are not fooled by floating-point dust left by
   * polynomial arithmetic.
   */
  trimmed(relEps = LEADING_EPS): Polynomial {
    let maxAbs = 0;
    for (const c of this.coeffs) {
      const a = Math.abs(c);
      if (a > maxAbs) {
        maxAbs = a;
      }
    }
    if (maxAbs === 0) {
      return new Polynomial([0]);
    }
    const threshold = relEps * maxAbs;
    let last = this.coeffs.length - 1;
    while (last > 0 && Math.abs(this.coeffs[last] ?? 0) <= threshold) {
      last--;
    }
    return new Polynomial(this.coeffs.slice(0, last + 1));
  }
}

/** Refine a bracketed root [lo, hi] (opposite signs at ends) by bisection. */
function bisectRoot(poly: Polynomial, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  let fa = poly.eval(a);
  if (fa === 0) {
    return a;
  }
  // ~60 halvings takes a double-precision bracket to the rounding floor.
  for (let iter = 0; iter < 80; iter++) {
    const mid = 0.5 * (a + b);
    const fm = poly.eval(mid);
    if (fm === 0) {
      return mid;
    }
    if (fa < 0 !== fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

/**
 * All real roots of `poly` in [lo, hi], isolated exactly by recursion on the
 * derivative: the derivative's roots split [lo, hi] into monotone sub-intervals,
 * each of which contains at most one root, found by a sign-change bracket +
 * bisection. Deterministic and closed-form-guided (no numeric differentiation of
 * any trajectory — only of the polynomial's own coefficients). Roots within
 * `tol` of one another are merged.
 */
export function realRootsInInterval(
  poly: Polynomial,
  lo: number,
  hi: number,
  tol = 1e-12,
): number[] {
  const p = poly.trimmed();
  const deg = p.degree;
  if (deg <= 0) {
    return [];
  }
  if (deg === 1) {
    const c0 = p.coeffs[0] ?? 0;
    const c1 = p.coeffs[1] ?? 0;
    const root = -c0 / c1;
    return root >= lo - tol && root <= hi + tol
      ? [Math.min(hi, Math.max(lo, root))]
      : [];
  }

  const critical = realRootsInInterval(p.derivative(), lo, hi, tol);
  const breakpoints = [lo, ...critical, hi].sort((a, b) => a - b);

  const roots: number[] = [];
  const pushUnique = (value: number): void => {
    if (roots.every((existing) => Math.abs(existing - value) > tol)) {
      roots.push(value);
    }
  };

  for (let i = 0; i + 1 < breakpoints.length; i++) {
    const a = breakpoints[i] as number;
    const b = breakpoints[i + 1] as number;
    if (b - a <= tol) {
      continue;
    }
    const fa = p.eval(a);
    const fb = p.eval(b);
    if (fa === 0) {
      pushUnique(a);
    }
    if (fa < 0 !== fb < 0) {
      pushUnique(bisectRoot(p, a, b));
    }
  }
  if (p.eval(hi) === 0) {
    pushUnique(hi);
  }
  roots.sort((a, b) => a - b);
  return roots;
}

/**
 * Split ∫_lo^hi P ds into its positive and negative parts by integrating P
 * across each maximal constant-sign sub-interval (bounded by P's sign-change
 * roots). Exact within each piece; `positive` ≥ 0, `negative` ≤ 0, and
 * `positive + negative` equals the plain definite integral.
 */
export function signedIntegral(
  poly: Polynomial,
  lo: number,
  hi: number,
): { positive: number; negative: number } {
  if (hi <= lo) {
    return { positive: 0, negative: 0 };
  }
  const interior = realRootsInInterval(poly, lo, hi).filter((r) => r > lo && r < hi);
  const bounds = [lo, ...interior, hi];
  let positive = 0;
  let negative = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i] as number;
    const b = bounds[i + 1] as number;
    const piece = poly.integrate(a, b);
    if (piece >= 0) {
      positive += piece;
    } else {
      negative += piece;
    }
  }
  return { positive, negative };
}
