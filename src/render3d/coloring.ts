// src/render3d/coloring — ball color resolution for the 3D scene (DESIGN.md §6).
//
// Two modes (DESIGN.md §6, §7): a single configurable color (default), or a
// per-orbit palette color. An orbit (NOTATION.md) is the cycle a physical ball
// traverses through the pattern's throws; core/siteswap `orbits()` returns those
// cycles as lists of beat indices (mod L). Physical ball ids are threaded by the
// timeline, so we map ballId → orbit by looking at where each ball is thrown:
// a flight's `throwBeat mod L` is a pattern index, and that index lands in exactly
// one orbit. This needs no core change — it is derived from existing exports
// (`orbits()` + the timeline's flights + the kinematics' static holds).
//
// This layer may import core (DESIGN.md §2 dependency direction); it is pure.

import { orbits } from '../core/siteswap';

/** Minimal flight shape needed for orbit mapping (a subset of core's Flight). */
export interface FlightLike {
  readonly ballId: number;
  readonly throwBeat: number;
}

/** Minimal static-hold shape (a subset of core's StaticHold). */
export interface StaticHoldLike {
  readonly ballId: number;
  readonly hand: number;
}

/**
 * A readable, high-contrast categorical palette for orbit coloring. Distinct
 * hues so neighboring orbits separate clearly; wraps if a pattern somehow has
 * more orbits than entries (rare — orbit count ≤ b).
 */
export const ORBIT_PALETTE: readonly string[] = [
  '#2f6fed', // blue
  '#e8710a', // orange
  '#12a150', // green
  '#d4306c', // magenta
  '#8b5cf6', // violet
  '#0aa5c4', // cyan
  '#b58900', // amber
  '#dc2626', // red
];

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** The palette color for an orbit index (wraps by palette length). */
export function orbitColor(orbitIndex: number): string {
  const n = ORBIT_PALETTE.length;
  return ORBIT_PALETTE[floorMod(orbitIndex, n)] ?? '#666666';
}

/**
 * Map every physical ball id (dynamic flights + static holds) to its orbit index
 * for `values`. Derived purely from `orbits(values)` plus the timeline's flights:
 * a ball's `throwBeat mod L` is the pattern index it is thrown from, which lies in
 * exactly one orbit cycle. Static-hold balls (all-2 hands, which never fly) are
 * mapped by the pattern index of the beat their hand holds (`hand mod L`).
 *
 * Balls whose index falls outside any kept orbit (only possible for a value-0
 * slot, which carries no ball) fall back to orbit 0. `values` must be a valid,
 * collision-free pattern (so `orbits()` is well defined).
 */
export function buildBallOrbits(
  values: readonly number[],
  flights: readonly FlightLike[],
  staticHolds: readonly StaticHoldLike[],
  handCount: number,
): Map<number, number> {
  const length = values.length;
  const map = new Map<number, number>();
  if (length === 0) {
    return map;
  }
  // index (mod L) → orbit index.
  const indexToOrbit = new Array<number>(length).fill(-1);
  orbits(values).forEach((cycle, orbitIndex) => {
    for (const index of cycle) {
      indexToOrbit[index] = orbitIndex;
    }
  });
  const orbitOfIndex = (index: number): number => {
    const orbit = indexToOrbit[floorMod(index, length)] ?? -1;
    return orbit >= 0 ? orbit : 0;
  };
  for (const flight of flights) {
    if (!map.has(flight.ballId)) {
      map.set(flight.ballId, orbitOfIndex(flight.throwBeat));
    }
  }
  for (const hold of staticHolds) {
    // The hand holds beats ≡ hand (mod n_h); beat `hand` is one of them, so its
    // pattern index is `hand mod L` (guarded against a zero hand count).
    const index = handCount > 0 ? hold.hand : 0;
    map.set(hold.ballId, orbitOfIndex(index));
  }
  return map;
}
