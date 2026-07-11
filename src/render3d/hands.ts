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
 * Samples per beat along a hand path. Hand carries/returns are quintic, but the
 * carry's dip has a sharp ~0.08 s scoop whose flanks a coarse uniform comb chords
 * across: at 20/beat the overlay cut the real hand path by up to ~15 mm at a corner
 * (repro 441 bp=0.25 dw=0.1645). At 80/beat that worst-case deviation drops to
 * ~1.8 mm (~0.4 mm on the repro) — visually exact — while the point count (≈1921
 * for the longest loop, ~23 KB/hand) stays well within the preallocated buffer.
 * Uniform sampling is kept deliberately (no segment-aware sampler).
 */
export const HAND_PATH_SAMPLES_PER_BEAT = 80;

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

// --- Hand cup tilt (normal to the ball at catch & throw) --------------------
//
// Owner: "the hands should tilt to receive and throw the balls; the hand should be
// normal to the ball at both catch and throw events." The cup is a lower hemisphere
// whose opening axis is local +y; tilting means rotating that axis onto the desired
// cup normal:
//   catch  → normal = −v̂(arrival)   (opening faces the incoming ball)
//   throw  → normal = +v̂(release)   (opening faces the departing ball)
// Between events we blend smoothly (smoothstep-eased slerp, C1 at every keyframe —
// no snapping): during a carry catch→throw; during an empty-hand return the hand
// relaxes toward upright and then into the next catch (an upright keyframe is
// inserted at the return midpoint). All pure (no three.js): the render layer
// precomputes per-hand keyframes once per sim identity from core's analytic event
// velocities, then per frame binary-searches + slerps into a preallocated quat.

/** Numerical guard for direction/parallel tests (unitless / m·s⁻¹ scale). */
const TILT_EPS = 1e-9;
/** Below this the slerp is nearly parallel — use nlerp to avoid a 0/0 in sin(θ). */
const SLERP_PARALLEL_EPS = 1e-6;

/** A mutable unit quaternion (x, y, z, w). three.Quaternion satisfies this shape,
 * so the render layer can pass a preallocated one as `out` for zero allocation. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** The upright cup orientation: identity (opening faces +y). */
export const UPRIGHT_QUAT: Readonly<Quat> = { x: 0, y: 0, z: 0, w: 1 };

/** Write the identity (upright) quaternion into `out`. */
function setUpright(out: Quat): void {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.w = 1;
}

/**
 * Write into `out` the unit quaternion rotating the cup's opening axis +y onto the
 * direction (nx, ny, nz). Degenerate cases are guarded: a near-zero direction →
 * upright (identity); the antiparallel −y direction → a stable 180° rotation about
 * +x (never a NaN quaternion). Always a unit quaternion.
 */
export function cupQuaternionFromNormal(nx: number, ny: number, nz: number, out: Quat): void {
  const length = Math.hypot(nx, ny, nz);
  if (length < TILT_EPS) {
    setUpright(out); // no direction → rest upright
    return;
  }
  const bx = nx / length;
  const by = ny / length;
  const bz = nz / length;
  const dot = by; // (0,1,0) · b̂
  if (dot > 1 - TILT_EPS) {
    setUpright(out); // already +y
    return;
  }
  if (dot < -1 + TILT_EPS) {
    // Antiparallel (−y): the half-way construction degenerates (cross → 0), so pick
    // a stable perpendicular axis (+x) for the 180° flip. Maps +y → −y, no NaN.
    out.x = 1;
    out.y = 0;
    out.z = 0;
    out.w = 0;
    return;
  }
  // Half-way quaternion: axis = (0,1,0) × b̂ = (bz, 0, −bx), scalar = 1 + dot.
  const qx = bz;
  const qz = -bx;
  const qw = 1 + dot;
  const inv = 1 / Math.hypot(qx, 0, qz, qw);
  out.x = qx * inv;
  out.y = 0;
  out.z = qz * inv;
  out.w = qw * inv;
}

/** Cup orientation for a CATCH: opening faces the incoming ball (−arrival velocity). */
export function catchCupQuaternion(vx: number, vy: number, vz: number, out: Quat): void {
  cupQuaternionFromNormal(-vx, -vy, -vz, out);
}

/** Cup orientation for a THROW: opening faces the departing ball (+release velocity). */
export function throwCupQuaternion(vx: number, vy: number, vz: number, out: Quat): void {
  cupQuaternionFromNormal(vx, vy, vz, out);
}

/**
 * Write into `out` the smoothstep-eased slerp from quaternion a to b at fraction u.
 * The parameter is eased by smoothstep (3u²−2u³) so the angular velocity is zero at
 * u = 0 and u = 1 — hence C1 across every keyframe (no snapping). Takes the shortest
 * arc (flips b if the dot is negative) and falls back to a normalized lerp when the
 * two quaternions are nearly parallel. Result is a unit quaternion.
 */
export function slerpEased(
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
  u: number,
  out: Quat,
): void {
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  const s = clamped * clamped * (3 - 2 * clamped); // smoothstep → C1 at the ends
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  let cx = bx;
  let cy = by;
  let cz = bz;
  let cw = bw;
  if (dot < 0) {
    // Shortest arc: negate the far end (q and −q are the same rotation).
    cx = -bx;
    cy = -by;
    cz = -bz;
    cw = -bw;
    dot = -dot;
  }
  let k0: number;
  let k1: number;
  if (dot > 1 - SLERP_PARALLEL_EPS) {
    k0 = 1 - s; // nearly parallel → nlerp (sin θ → 0)
    k1 = s;
  } else {
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    k0 = Math.sin((1 - s) * theta) / sinTheta;
    k1 = Math.sin(s * theta) / sinTheta;
  }
  const rx = k0 * ax + k1 * cx;
  const ry = k0 * ay + k1 * cy;
  const rz = k0 * az + k1 * cz;
  const rw = k0 * aw + k1 * cw;
  const inv = 1 / (Math.hypot(rx, ry, rz, rw) || 1);
  out.x = rx * inv;
  out.y = ry * inv;
  out.z = rz * inv;
  out.w = rw * inv;
}

/** A carry's endpoints as the tilt keyframe builder needs them (structural — a
 * core {@link CarryMotion} satisfies this). */
interface CarryTiltInput {
  readonly startTime: number;
  readonly endTime: number;
  readonly startVelocity: { readonly x: number; readonly y: number; readonly z: number };
  readonly endVelocity: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Per-hand cup-orientation keyframes: parallel arrays of times (ascending, strictly
 * increasing) and quaternions (4 floats each). Zero-allocation to evaluate — the
 * render layer binary-searches `times` and slerps into a preallocated quaternion.
 */
export interface HandTiltKeyframes {
  readonly times: Float64Array;
  readonly quats: Float64Array;
  readonly count: number;
}

/** Empty keyframe set (a static-hold hand with no carries → always upright). */
const EMPTY_TILT_KEYFRAMES: HandTiltKeyframes = {
  times: new Float64Array(0),
  quats: new Float64Array(0),
  count: 0,
};

/**
 * Build one hand's cup-orientation keyframes from its carries (sorted by start
 * time). Each carry contributes a catch keyframe (−arrival velocity) at its start
 * and a throw keyframe (+release velocity) at its end; when an empty-hand return
 * separates two carries, an UPRIGHT keyframe is inserted at the return midpoint so
 * the hand relaxes toward upright and then blends into the next catch. Coincident
 * times (e.g. a zero-gap exchange) collapse to a single keyframe, later-wins, so
 * the times stay strictly increasing for the binary search.
 */
export function buildHandTiltKeyframes(carries: readonly CarryTiltInput[]): HandTiltKeyframes {
  if (carries.length === 0) {
    return EMPTY_TILT_KEYFRAMES;
  }
  const sorted = [...carries].sort((a, b) => a.startTime - b.startTime);
  const times: number[] = [];
  const quats: number[] = [];
  const scratch: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const push = (time: number, qx: number, qy: number, qz: number, qw: number): void => {
    const n = times.length;
    if (n > 0 && time - (times[n - 1] as number) <= TILT_EPS) {
      // Coincident time (e.g. throw == next catch at a zero-gap exchange): keep the
      // later keyframe so the upcoming receive orientation wins.
      quats[4 * (n - 1)] = qx;
      quats[4 * (n - 1) + 1] = qy;
      quats[4 * (n - 1) + 2] = qz;
      quats[4 * (n - 1) + 3] = qw;
      return;
    }
    times.push(time);
    quats.push(qx, qy, qz, qw);
  };
  for (let i = 0; i < sorted.length; i++) {
    const carry = sorted[i] as CarryTiltInput;
    catchCupQuaternion(carry.startVelocity.x, carry.startVelocity.y, carry.startVelocity.z, scratch);
    push(carry.startTime, scratch.x, scratch.y, scratch.z, scratch.w);
    throwCupQuaternion(carry.endVelocity.x, carry.endVelocity.y, carry.endVelocity.z, scratch);
    push(carry.endTime, scratch.x, scratch.y, scratch.z, scratch.w);
    const next = sorted[i + 1];
    if (next && next.startTime - carry.endTime > TILT_EPS) {
      // Empty-hand return: relax toward upright at its midpoint.
      push(0.5 * (carry.endTime + next.startTime), 0, 0, 0, 1);
    }
  }
  return { times: Float64Array.from(times), quats: Float64Array.from(quats), count: times.length };
}

/**
 * Write the hand's cup orientation at time `t` into `out` (zero allocation). Before
 * the first / after the last keyframe the nearest keyframe orientation is held;
 * between keyframes the orientation is the smoothstep-eased slerp of the bracketing
 * pair. An empty keyframe set → upright.
 */
export function evaluateHandTilt(keyframes: HandTiltKeyframes, t: number, out: Quat): void {
  const { times, quats, count } = keyframes;
  if (count === 0) {
    setUpright(out);
    return;
  }
  // Clamp to the nearest keyframe outside the range (inlined — no per-call closure,
  // this runs in the useFrame hot path).
  if (t <= (times[0] as number)) {
    out.x = quats[0] as number;
    out.y = quats[1] as number;
    out.z = quats[2] as number;
    out.w = quats[3] as number;
    return;
  }
  if (t >= (times[count - 1] as number)) {
    const base = 4 * (count - 1);
    out.x = quats[base] as number;
    out.y = quats[base + 1] as number;
    out.z = quats[base + 2] as number;
    out.w = quats[base + 3] as number;
    return;
  }
  // Binary search: last index i with times[i] <= t.
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((times[mid] as number) <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const i0 = lo;
  const i1 = lo + 1;
  const t0 = times[i0] as number;
  const t1 = times[i1] as number;
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  slerpEased(
    quats[4 * i0] as number,
    quats[4 * i0 + 1] as number,
    quats[4 * i0 + 2] as number,
    quats[4 * i0 + 3] as number,
    quats[4 * i1] as number,
    quats[4 * i1 + 1] as number,
    quats[4 * i1 + 2] as number,
    quats[4 * i1 + 3] as number,
    u,
    out,
  );
}
