// src/render3d/useBallColors — the 3D-side ball-color resolver.
//
// Both the spheres (<Balls>) and their tracers (<Tracers>) color balls the same
// way: each physical ball keeps its own palette color (keyed by its stable
// ballId) when the coloring toggle is on, or the single configurable color when
// it is off. The color rule itself is `resolveBallColor` in state/ballColors —
// the SAME function the ladder uses — so a ball's 3D color always matches its
// ladder arcs (owner decision superseding DESIGN.md §6 per-orbit coloring).

import { useMemo } from 'react';
import { useAppStore } from '../state';
import { resolveBallColor } from '../state/ballColors';

/**
 * Returns `(ballId) => cssColor`, reactive to the per-ball-coloring toggle and
 * the single-color setting. The returned function is stable until those inputs
 * change, so callers may memoize material updates against it.
 */
export function useBallColorResolver(): (ballId: number) => string {
  const orbitColoring = useAppStore((state) => state.orbitColoring);
  const ballColor = useAppStore((state) => state.ballColor);

  return useMemo(
    () => (ballId: number) => resolveBallColor(orbitColoring, ballColor, ballId),
    [orbitColoring, ballColor],
  );
}
