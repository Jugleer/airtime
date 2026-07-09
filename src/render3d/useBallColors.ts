// src/render3d/useBallColors — the shared ball-color resolver (DESIGN.md §6, §7).
//
// Both the spheres (<Balls>) and their tracers (<Tracers>) color balls the same
// way: a single configurable color by default, or a per-orbit palette color when
// orbit coloring is on. Factored here so the two views never drift. Pure below
// the React seam — the mapping comes from core's `orbits()` via `buildBallOrbits`
// (see ./coloring), which needs no core change (DESIGN.md §2 dependency direction).

import { useMemo } from 'react';
import { useAppStore } from '../state';
import type { Simulation } from '../state/simulation';
import { buildBallOrbits, orbitColor } from './coloring';

/**
 * Returns `(ballId) => cssColor` for the given simulation, reactive to the orbit-
 * coloring toggle and single-color setting. The returned function is stable until
 * those inputs change, so callers may memoize material updates against it.
 */
export function useBallColorResolver(sim: Simulation): (ballId: number) => string {
  const orbitColoring = useAppStore((state) => state.orbitColoring);
  const ballColor = useAppStore((state) => state.ballColor);
  const kinematics = sim.kinematics;

  const orbitOfBall = useMemo(
    () =>
      buildBallOrbits(
        sim.values,
        sim.timeline.flights,
        kinematics.staticHolds(),
        kinematics.handCount,
      ),
    [sim, kinematics],
  );

  return useMemo(
    () => (ballId: number) =>
      orbitColoring ? orbitColor(orbitOfBall.get(ballId) ?? 0) : ballColor,
    [orbitColoring, ballColor, orbitOfBall],
  );
}
