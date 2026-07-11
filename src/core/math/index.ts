// src/core/math — tiny, dependency-free numeric helpers shared across the pure core
// and the view layers (ui / render3d / export). Consolidates helpers that had drifted
// into near-identical copies: `clamp` (was triplicated in ui/panels, state, and
// render3d/camera), `greatestCommonDivisor` (was triplicated in core/siteswap,
// core/siteswap/notation, and core/kinematics), and the `Vec3Tuple` alias (was
// defined twice, in render3d/displayFrame and export/schedule).
//
// A leaf module: it imports nothing, so every dependent can pull from it without a
// cycle, and it satisfies the core-purity boundary trivially (no React/three/zustand,
// no Date.now / Math.random / performance — CLAUDE.md hard rule 1).

/** Clamp `value` into the closed interval [lo, hi] (assumes lo ≤ hi). */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Greatest common divisor of |a| and |b| by the Euclidean algorithm.
 * gcd(0, 0) = 0; the result is always non-negative.
 */
export function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** A 3-vector as an immutable [x, y, z] tuple (frame-agnostic; callers carry meaning). */
export type Vec3Tuple = readonly [number, number, number];
