// src/state/ballColors — the shared per-ball color palette (owner decision
// 2026-07-10, superseding the per-orbit coloring of DESIGN.md §6): when the
// coloring toggle is on, every physical ball keeps one palette color keyed by
// its stable ballId — identical in the ladder and the 3D scene (balls + tracers)
// so a ball can be cross-referenced between views by color alone. Pure module
// (no React/zustand): it lives in state so both ui and render3d (peers in the
// DESIGN.md §2 dependency direction) can import it without importing each other.
//
// Color stability: ballIds are anchored to the beat-0 state and are bit-stable
// across horizon extension and pattern-transition splices (core/timeline ball-id
// anchoring, Phase 8), so a ball keeps its color while the sim runs and through
// smooth transitions; only a hard reset (different ball count / restart) may
// reassign ids and therefore colors.

/**
 * A readable, high-contrast categorical palette. Distinct hues so neighboring
 * balls separate clearly; wraps if a pattern has more balls than entries
 * (b ≲ 9 here, so at most one repeat).
 */
export const BALL_PALETTE: readonly string[] = [
  '#2f6fed', // blue
  '#e8710a', // orange
  '#12a150', // green
  '#d4306c', // magenta
  '#8b5cf6', // violet
  '#0aa5c4', // cyan
  '#b58900', // amber
  '#dc2626', // red
];

/** The palette color for a ball id (wraps by palette length; total for any integer). */
export function ballPaletteColor(ballId: number): string {
  const n = BALL_PALETTE.length;
  return BALL_PALETTE[((ballId % n) + n) % n] ?? '#666666';
}

/**
 * The one color rule every view uses: the per-ball palette color when the
 * coloring toggle is on, the single configurable color when it is off. The
 * ladder calls this directly and the 3D scene calls it via
 * `useBallColorResolver` (render3d), so the two views can never drift.
 */
export function resolveBallColor(
  perBallColoring: boolean,
  singleColor: string,
  ballId: number,
): string {
  return perBallColoring ? ballPaletteColor(ballId) : singleColor;
}
