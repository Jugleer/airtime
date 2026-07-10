// src/render3d/hands — pure geometry + sampling arithmetic for the hand cups and
// the persistent hand-path lines (DESIGN.md §4.3–§4.4, §6). No three.js, no React:
// just the "how big is the cup", "how many samples and which beats", and "which
// hue per hand" so the components (Hands.tsx) can preallocate buffers and fill
// them without per-frame allocation (mirrors ./tracers for the ball trails).
//
// A hand cup is a simple partial hollow sphere (the lower hemisphere → a bowl
// opening upward) scaled to the ball radius, drawn at `handState(hand, t)` every
// frame. A hand path is the CLOSED loop a hand traverses over one spatial period
// (carries + returns): because the sim is a pure function of time (DESIGN.md §2)
// and the loop is periodic, it is sampled ONCE per kinematics epoch / sim rebuild,
// not per frame.

// --- Hand cup (partial hollow sphere) ---------------------------------------

/**
 * Cup outer radius as a multiple of the ball radius (owner: ~1.6–2× ball radius).
 * 1.8× reads as a hand cradling the ball without swamping it at the default sizes.
 */
export const HAND_CUP_RADIUS_FACTOR = 1.8;

/**
 * How far below the hand point the cup center sits, as a multiple of the ball
 * radius, so a carried ball (which rides the hand point) nests inside the cup's
 * opening instead of floating at the rim center. Purely aesthetic.
 */
export const HAND_CUP_DROP_FACTOR = 1.0;

// three.js SphereGeometry angle ranges (radians). theta is the polar angle from
// the +y pole (0) to the −y pole (π); [π/2, π] is the LOWER hemisphere — a bowl
// whose opening faces up. phi spans the full circle so it is a complete bowl.
export const HAND_CUP_PHI_START = 0;
export const HAND_CUP_PHI_LENGTH = Math.PI * 2;
export const HAND_CUP_THETA_START = Math.PI / 2;
export const HAND_CUP_THETA_LENGTH = Math.PI / 2;

/** Cup outer radius in meters for a given ball radius. */
export function handCupRadius(ballRadius: number): number {
  return ballRadius * HAND_CUP_RADIUS_FACTOR;
}

// --- Hand-path sampling ------------------------------------------------------

/**
 * Samples per beat along a hand path. Hand carries/returns are quintic (smoother
 * than ball flights), so 20/beat traces the loop visually exactly while bounding
 * the point count.
 */
export const HAND_PATH_SAMPLES_PER_BEAT = 20;

/**
 * Longest period (in beats) sampled for a single hand loop. Practical patterns
 * repeat well inside this; a pattern whose spatial period exceeds it samples only
 * the first {@link HAND_PATH_MAX_PERIOD_BEATS} beats of the loop (which then does
 * not visually close — an accepted corner for very long patterns).
 */
export const HAND_PATH_MAX_PERIOD_BEATS = 24;

/** Preallocated buffer capacity (points) for one hand's path polyline. */
export function maxHandPathPoints(): number {
  return HAND_PATH_SAMPLES_PER_BEAT * HAND_PATH_MAX_PERIOD_BEATS + 1;
}

/** The period (in beats) actually sampled: the spatial period, capped and rounded. */
export function handPathPeriodBeats(spatialPeriodBeats: number): number {
  if (!(spatialPeriodBeats > 0)) {
    return 0;
  }
  return Math.min(Math.round(spatialPeriodBeats), HAND_PATH_MAX_PERIOD_BEATS);
}

/**
 * Number of polyline points for a hand path of `periodBeats` beats: ~
 * {@link HAND_PATH_SAMPLES_PER_BEAT} per beat plus a closing point, at least 2
 * (a polyline needs two ends) and capped at the buffer capacity. 0 when there is
 * no period (nothing to draw).
 */
export function handPathPointCount(periodBeats: number): number {
  if (!(periodBeats > 0)) {
    return 0;
  }
  const beats = Math.min(periodBeats, HAND_PATH_MAX_PERIOD_BEATS);
  const n = Math.round(beats * HAND_PATH_SAMPLES_PER_BEAT) + 1;
  return Math.max(2, Math.min(n, maxHandPathPoints()));
}

/**
 * The beat the sampled loop STARTS at — the steady state to sample one period
 * from. When a kinematics epoch (gravity / hold depth / carry path / geometry
 * edit) exists, anchor at the first beat at/after the LATEST epoch so the drawn
 * path reflects the current kinematics (pass that beat as `lastEpochBeat`);
 * otherwise (`lastEpochBeat < 0`) anchor one full period in, past the startup
 * ease-in, so the loop is a clean closed steady-state cycle. The window is
 * clamped so the whole loop `[start, start + periodBeats]` stays inside the
 * generated horizon (`beatCount`).
 */
export function handPathStartBeat(
  periodBeats: number,
  beatCount: number,
  lastEpochBeat: number,
): number {
  if (periodBeats <= 0 || beatCount <= 0) {
    return 0;
  }
  let start = lastEpochBeat >= 0 ? lastEpochBeat : periodBeats;
  if (start + periodBeats > beatCount) {
    start = Math.max(0, beatCount - periodBeats);
  }
  return start;
}

// --- Per-hand path hues ------------------------------------------------------

/**
 * Per-hand path hues, deliberately DISTINCT from the saturated per-ball palette
 * (state/ballColors): these are lighter, lower-chroma "-300"-level pastels so the
 * hand loops read as subtle guide lines rather than balls, and they hold enough
 * lightness/chroma to remain visible over both the dark and light scene grids
 * (rendered translucent by the component). Wraps if n_h exceeds the entry count.
 */
export const HAND_PATH_PALETTE: readonly string[] = [
  '#7dd3fc', // sky
  '#fca5a5', // rose
  '#86efac', // mint
  '#fcd34d', // gold
  '#c4b5fd', // lilac
  '#f9a8d4', // pink
  '#5eead4', // teal
  '#fdba74', // apricot
];

/** The path hue for a hand index (wraps by palette length; total for any integer). */
export function handPathColor(hand: number): string {
  const n = HAND_PATH_PALETTE.length;
  return HAND_PATH_PALETTE[((hand % n) + n) % n] ?? '#94a3b8';
}
