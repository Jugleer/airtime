// src/core/kinematics — closed-form ball flight + hand carry/return paths and
// their exact position/velocity/acceleration/jerk (DESIGN.md §4.2–§4.4).
//
// The simulation is a pure function of time (DESIGN.md §2): this module layers a
// *geometric* evaluation over the Phase-1 event timeline (which is purely
// temporal). Given per-hand catch/throw points, gravity, and a hold depth, every
// segment becomes a per-axis polynomial in local time, so ballState/handState are
// closed-form — no numeric differentiation anywhere (CLAUDE.md hard rule 3).
//
// Seam (documented in the Phase-2 report): the Timeline is NOT mutated. Positions
// derive from the timeline's already-frozen event *times* plus the hand geometry
// passed in here, so epoch immutability is inherited for free — a past/in-flight
// flight's endpoints and release velocity are fixed because its times and the
// geometry are fixed. Hand geometry is a parameter into core; the state layer will
// own it (Phase 6). NOTATION.md symbols: g = gravity, t_air = air time.
//
// Pure and deterministic: no Date.now / Math.random / performance.

import { spatialPeriodBeats } from '../siteswap';
import type { Flight, Timeline } from '../timeline';
import { Polynomial } from './poly';
import { midpoint, scale, subtract, vec3, ZERO, type Vec3 } from './vec3';

export { Polynomial, realRootsInInterval, signedIntegral } from './poly';
export {
  add,
  dot,
  magnitude,
  magnitudeSquared,
  midpoint,
  scale,
  subtract,
  vec3,
  ZERO,
  type Vec3,
} from './vec3';

/** Default gravity g in m/s² (DESIGN.md §7). */
export const DEFAULT_GRAVITY = 9.81;
/** Default hold-dip depth in meters (DESIGN.md §7 `holdDepth`). */
export const DEFAULT_HOLD_DEPTH = 0.1;

/**
 * Physical apex height above the throw point for equal-height throw and catch
 * points, NOTATION.md identity (3): z_apex = g·t_air²/8.
 */
export function apexHeight(airTime: number, gravity = DEFAULT_GRAVITY): number {
  return (gravity * airTime * airTime) / 8;
}

// --- Hand geometry ----------------------------------------------------------

/**
 * Per-hand catch/throw points (meters, y-up). A parameter into core — the state
 * layer owns the editable positions later (DESIGN.md §2, §6). Hand index is the
 * beat's `beat mod n_h`; both accessors wrap by hand count.
 */
export interface HandGeometry {
  /** Release point P_t of hand `hand` (DESIGN.md §4.2). */
  throwPoint(hand: number): Vec3;
  /** Catch point P_c of hand `hand`. */
  catchPoint(hand: number): Vec3;
}

/** Build a {@link HandGeometry} from explicit per-hand point arrays (wraps by index). */
export function makeHandGeometry(
  throwPoints: readonly Vec3[],
  catchPoints: readonly Vec3[],
): HandGeometry {
  const nt = throwPoints.length;
  const nc = catchPoints.length;
  const wrap = (index: number, length: number): number =>
    length <= 0 ? 0 : ((index % length) + length) % length;
  return {
    throwPoint: (hand) => throwPoints[wrap(hand, nt)] ?? ZERO,
    catchPoint: (hand) => catchPoints[wrap(hand, nc)] ?? ZERO,
  };
}

/**
 * Unit x-positions (in half-pair-width units) for line-preset hands, following the
 * ALTERNATING-OUTWARD rule (owner 2026-07-11). A single hand sits on the center
 * column (u = 0); the canonical pair straddles it at ∓1 (n_h = 2, the DESIGN §7
 * default); every additional hand is appended on the OUTSIDE, alternating
 * +, −, +, − at a constant 2-unit spacing (hand 2 → +3, hand 3 → −3, hand 4 → +5…).
 *
 * Consequence: `lineUnitPositions(n)` is a strict PREFIX of `lineUnitPositions(n+1)`
 * for every n ≥ 2, so raising the hand count preserves the existing hands and adds
 * the new one strictly outward, and lowering it drops the most-recently-added hand.
 * (The 1 → 2 step is the one exception: a solo center hand becomes the ∓1 pair.)
 * Scaled by throwHalf / catchHalf into meters by {@link lineHandGeometry}.
 */
export function lineUnitPositions(handCount: number): number[] {
  const n = Math.max(0, Math.floor(handCount));
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [0];
  }
  const units: number[] = [-1, 1];
  for (let hand = 2; hand < n; hand++) {
    const pairIndex = Math.floor((hand - 2) / 2); // 0, 0, 1, 1, 2, 2, …
    const magnitude = 3 + 2 * pairIndex; // 3, 3, 5, 5, 7, 7, …
    const sign = hand % 2 === 0 ? 1 : -1; // hand 2 → +, hand 3 → −, …
    units.push(sign * magnitude);
  }
  return units;
}

/**
 * Hands on a line along x at height `y`, z = 0: throw points inset (u·throwHalf)
 * and catch points outset (u·catchHalf), with the per-hand unit offsets u from the
 * alternating-outward {@link lineUnitPositions}. For n_h = 2 this is exactly the
 * DESIGN.md §7 default (throws x = ±0.10, catches x = ±0.30, y = 1.00); for n_h = 1
 * both points sit at the origin column (straight-up throws). For n_h ≥ 3 each added
 * hand is placed on the outside (alternating sides) so the earlier hands keep their
 * positions as the count grows (owner item, 2026-07-11).
 */
export function lineHandGeometry(
  handCount: number,
  { y = 1, throwHalf = 0.1, catchHalf = 0.3 }: { y?: number; throwHalf?: number; catchHalf?: number } = {},
): HandGeometry {
  const throwPoints: Vec3[] = [];
  const catchPoints: Vec3[] = [];
  for (const u of lineUnitPositions(handCount)) {
    throwPoints.push(vec3(u * throwHalf, y, 0));
    catchPoints.push(vec3(u * catchHalf, y, 0));
  }
  return makeHandGeometry(throwPoints, catchPoints);
}

/**
 * Hands on a horizontal circle of radius `radius` in the x–z plane at height `y`,
 * with throw points inset toward the center by `throwInset` (DESIGN.md §7 circle
 * preset, r = 0.45 m). A natural 3D geometry; the UI wires preset selection in
 * Phase 6.
 */
export function circleHandGeometry(
  handCount: number,
  { radius = 0.45, throwInset = 0.1, y = 1 }: { radius?: number; throwInset?: number; y?: number } = {},
): HandGeometry {
  const throwPoints: Vec3[] = [];
  const catchPoints: Vec3[] = [];
  const n = Math.max(1, handCount);
  for (let hand = 0; hand < n; hand++) {
    const theta = (2 * Math.PI * hand) / n;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    catchPoints.push(vec3(radius * cos, y, radius * sin));
    throwPoints.push(vec3((radius - throwInset) * cos, y, (radius - throwInset) * sin));
  }
  return makeHandGeometry(throwPoints, catchPoints);
}

/** Default hand geometry for a hand count: the DESIGN.md §7 line preset. */
export function defaultHandGeometry(handCount: number): HandGeometry {
  return lineHandGeometry(handCount);
}

// --- Motion state & polynomial segments -------------------------------------

/** Position/velocity/acceleration/jerk at an instant (all exact, closed-form). */
export interface MotionState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly acceleration: Vec3;
  readonly jerk: Vec3;
}

/**
 * A motion segment: per-axis position polynomials in *local* time s = t −
 * startTime, valid over [startTime, endTime). Velocity/acceleration/jerk are the
 * analytic derivatives. Flights are quadratics; quintic carry/return segments
 * are degree-5; cubic carries are degree-3.
 */
export interface PolySegment {
  readonly startTime: number;
  readonly endTime: number;
  readonly x: Polynomial;
  readonly y: Polynomial;
  readonly z: Polynomial;
}

/** Evaluate a segment's motion at global time `t` (s = t − startTime). */
export function evaluateSegment(segment: PolySegment, t: number): MotionState {
  const s = t - segment.startTime;
  const { x, y, z } = segment;
  const vx = x.derivative();
  const vy = y.derivative();
  const vz = z.derivative();
  const ax = vx.derivative();
  const ay = vy.derivative();
  const az = vz.derivative();
  const jx = ax.derivative();
  const jy = ay.derivative();
  const jz = az.derivative();
  return {
    position: vec3(x.eval(s), y.eval(s), z.eval(s)),
    velocity: vec3(vx.eval(s), vy.eval(s), vz.eval(s)),
    acceleration: vec3(ax.eval(s), ay.eval(s), az.eval(s)),
    jerk: vec3(jx.eval(s), jy.eval(s), jz.eval(s)),
  };
}

/** A resting state: fixed position, zero velocity/acceleration/jerk. */
function restState(position: Vec3): MotionState {
  return { position, velocity: ZERO, acceleration: ZERO, jerk: ZERO };
}

/**
 * Evaluate an ordered, contiguous segment list at `t`. Inside the covered span
 * the owning segment is evaluated; outside it, the nearest endpoint is held as a
 * static rest so the function is total for all `t` (DESIGN.md §4.3 — handState
 * must be defined everywhere) and position stays continuous.
 */
function evaluateSegments(segments: readonly PolySegment[], t: number, fallback: Vec3): MotionState {
  if (segments.length === 0) {
    return restState(fallback);
  }
  const first = segments[0] as PolySegment;
  const last = segments[segments.length - 1] as PolySegment;
  if (t < first.startTime) {
    return restState(evaluateSegment(first, first.startTime).position);
  }
  if (t >= last.endTime) {
    return restState(evaluateSegment(last, last.endTime).position);
  }
  // Binary search for the segment whose [startTime, endTime) contains t.
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((segments[mid] as PolySegment).startTime <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return evaluateSegment(segments[lo] as PolySegment, t);
}

// --- Parabola solver (flight, DESIGN.md §4.2) -------------------------------

/** A solved flight: its position segment and endpoint velocities. */
export interface FlightSolution {
  readonly segment: PolySegment;
  /** Release velocity v0 at the throw (s = 0). */
  readonly releaseVelocity: Vec3;
  /** Arrival velocity v1 at the catch (s = t_air). */
  readonly arrivalVelocity: Vec3;
}

/**
 * The unique parabola from `throwPoint` to `catchPoint` over [throwTime,
 * arrivalTime] under gravity (0, −g, 0): horizontal velocity is Δxz/t_air; the
 * vertical component solves the endpoint constraint (DESIGN.md §4.2). Flight
 * acceleration is exactly (0, −g, 0).
 */
export function solveFlight(
  throwPoint: Vec3,
  catchPoint: Vec3,
  throwTime: number,
  arrivalTime: number,
  gravity: number,
): FlightSolution {
  const airTime = arrivalTime - throwTime;
  const v0x = (catchPoint.x - throwPoint.x) / airTime;
  const v0y = (catchPoint.y - throwPoint.y) / airTime + 0.5 * gravity * airTime;
  const v0z = (catchPoint.z - throwPoint.z) / airTime;
  const segment: PolySegment = {
    startTime: throwTime,
    endTime: arrivalTime,
    x: new Polynomial([throwPoint.x, v0x]),
    y: new Polynomial([throwPoint.y, v0y, -0.5 * gravity]),
    z: new Polynomial([throwPoint.z, v0z]),
  };
  return {
    segment,
    releaseVelocity: vec3(v0x, v0y, v0z),
    arrivalVelocity: vec3(v0x, v0y - gravity * airTime, v0z),
  };
}

// --- Hermite solvers --------------------------------------------------------

/** Solve the 3×3 system A·x = b by Cramer's rule (well-conditioned for T > 0). */
function solve3(a: readonly number[][], b: readonly number[]): [number, number, number] {
  const det = (m: readonly number[][]): number =>
    (m[0]?.[0] ?? 0) * ((m[1]?.[1] ?? 0) * (m[2]?.[2] ?? 0) - (m[1]?.[2] ?? 0) * (m[2]?.[1] ?? 0)) -
    (m[0]?.[1] ?? 0) * ((m[1]?.[0] ?? 0) * (m[2]?.[2] ?? 0) - (m[1]?.[2] ?? 0) * (m[2]?.[0] ?? 0)) +
    (m[0]?.[2] ?? 0) * ((m[1]?.[0] ?? 0) * (m[2]?.[1] ?? 0) - (m[1]?.[1] ?? 0) * (m[2]?.[0] ?? 0));
  const d = det(a);
  const withColumn = (col: number): number[][] =>
    a.map((row, r) => row.map((value, c) => (c === col ? (b[r] ?? 0) : value)));
  return [det(withColumn(0)) / d, det(withColumn(1)) / d, det(withColumn(2)) / d];
}

/**
 * Quintic Hermite: the unique degree-5 polynomial with p(0)=p0, p'(0)=v0,
 * p''(0)=a0 and p(T)=p1, p'(T)=v1, p''(T)=a1. Returns ascending coefficients.
 * Matching acceleration at both ends is what keeps ball acceleration continuous
 * across catch/throw events and makes contact force ramp from/to zero (§4.3).
 */
export function quinticHermite(
  p0: number,
  v0: number,
  a0: number,
  p1: number,
  v1: number,
  a1: number,
  T: number,
): Polynomial {
  const c0 = p0;
  const c1 = v0;
  const c2 = 0.5 * a0;
  const r0 = p1 - (c0 + c1 * T + c2 * T * T);
  const r1 = v1 - (c1 + 2 * c2 * T);
  const r2 = a1 - 2 * c2;
  const [c3, c4, c5] = solve3(
    [
      [T ** 3, T ** 4, T ** 5],
      [3 * T ** 2, 4 * T ** 3, 5 * T ** 4],
      [6 * T, 12 * T ** 2, 20 * T ** 3],
    ],
    [r0, r1, r2],
  );
  return new Polynomial([c0, c1, c2, c3, c4, c5]);
}

/**
 * Well-conditioned quintic Hermite for SHORT segments: analytically identical
 * to {@link quinticHermite}, but numerically far more careful.
 *
 * Two differences matter when T is small:
 *   1. Residuals are formed difference-first ((p1 − p0) − v0·T − …), so
 *      rounding stays at the segment-local scale (|Δp|, |v·T|, |a·T²|) instead
 *      of the absolute position scale |p| — the latter, divided by T² when the
 *      acceleration is evaluated, breaches the 1e-9 continuity budget.
 *   2. The 3×3 system is solved in normalized time τ = s/T, where the matrix is
 *      the constant [[1,1,1],[3,4,5],[6,12,20]] with the exact inverse applied
 *      below — no Cramer's rule over powers of a tiny T.
 *
 * Used by the carry construction for its short absorb/wind-up/hold segments;
 * longer segments keep {@link quinticHermite} so their output stays
 * bit-for-bit identical to the original construction.
 */
function quinticHermiteConditioned(
  p0: number,
  v0: number,
  a0: number,
  p1: number,
  v1: number,
  a1: number,
  T: number,
): Polynomial {
  const T2 = T * T;
  // Normalized residuals: with q(τ) = p(τ·T), r0 = q(1) − (q0 + q1 + q2),
  // r1 = q'(1) − (q1 + 2q2), r2 = q''(1) − 2q2 — assembled difference-first.
  const r0 = p1 - p0 - v0 * T - 0.5 * a0 * T2;
  const r1 = (v1 - v0 - a0 * T) * T;
  const r2 = (a1 - a0) * T2;
  // Exact inverse of [[1,1,1],[3,4,5],[6,12,20]] (determinant 2).
  const q3 = 10 * r0 - 4 * r1 + 0.5 * r2;
  const q4 = -15 * r0 + 7 * r1 - r2;
  const q5 = 6 * r0 - 3 * r1 + 0.5 * r2;
  const T3 = T2 * T;
  return new Polynomial([p0, v0, 0.5 * a0, q3 / T3, q4 / (T3 * T), q5 / (T3 * T2)]);
}

/**
 * Cubic Hermite: the unique degree-3 polynomial matching p and p' at both ends
 * (velocity-matched only). Its endpoint acceleration is *not* free — generically
 * ≠ (0, −g, 0) — which is exactly why the cubic carry path shows an acceleration
 * jump at events (§4.3, the comparison alternative).
 */
export function cubicHermite(p0: number, v0: number, p1: number, v1: number, T: number): Polynomial {
  const c0 = p0;
  const c1 = v0;
  const c2 = (3 * (p1 - p0) - (2 * v0 + v1) * T) / (T * T);
  const c3 = (-2 * (p1 - p0) + (v0 + v1) * T) / (T * T * T);
  return new Polynomial([c0, c1, c2, c3]);
}

// --- Carry paths (pluggable; DESIGN.md §4.3) --------------------------------

/** Everything a carry path needs to build the catch→throw segment(s). */
export interface CarrySpec {
  readonly startTime: number;
  readonly endTime: number;
  readonly catchPoint: Vec3;
  readonly throwPoint: Vec3;
  /** Arrival velocity of the delivering flight (v at the catch). */
  readonly startVelocity: Vec3;
  /** Release velocity of the departing flight (v at the throw). */
  readonly endVelocity: Vec3;
  readonly gravity: number;
  readonly holdDepth: number;
  /**
   * True when this carry spans held `2` beats (a multi-beat hold, timeline
   * `Carry.held`): the hand rests (velocity zero) at the dip low point for the
   * spare carry time. Normal single-beat carries sweep smoothly through the dip
   * instead. Optional — synthetic specs that omit it are treated as normal
   * carries.
   */
  readonly held?: boolean;
  /**
   * Optional lower bound (s) on the scoop-sweep flank time. RETURNS set this
   * (see {@link RETURN_FLANK_FLOOR}) so their steep, ball-velocity-driven flanks
   * cannot collapse below a numerically clean duration; carries omit it (their
   * flank timing is fixed by the vertical descent so the scoop-shape monotone
   * descent stays intact).
   */
  readonly minFlankTime?: number;
}

/**
 * A pluggable catch→throw hand path (DESIGN.md §4.3). The default is the
 * quintic scoop-and-hold through the dip; the cubic Bézier alternative is
 * provided for the acceleration-jump comparison. Each `build` returns one or
 * more contiguous segments tiling [startTime, endTime].
 */
export interface CarryPath {
  readonly name: string;
  build(spec: CarrySpec): PolySegment[];
}

/** Local free-fall-matched endpoint acceleration g_vec = (0, −g, 0). */
function gravityVector(gravity: number): Vec3 {
  return vec3(0, -gravity, 0);
}

/**
 * Minimum hold depth (m) for a bounded absorb. Below this the dip is visually
 * flat, and the constant-deceleration absorb time 2·holdDepth/v would shrink
 * toward zero — whose enormous internal accelerations would leave float dust at
 * the stitches — so the carry degenerates to two half-carry segments instead.
 */
const MIN_ABSORB_DEPTH = 1e-3;

/**
 * Numerical-conditioning floor for the absorb/wind-up time: never shorter than
 * verticalSpeed · ABSORB_TIME_PER_SPEED seconds, capping the absorb's internal
 * acceleration scale (≈ v / t_absorb) at 1/K = 2·10⁴ m/s². Below that scale,
 * double-precision rounding in the quintic's coefficients — divided by
 * t_absorb² wherever acceleration is evaluated — would breach the 1e-9
 * acceleration-continuity budget at the segment joints (the flaky-property
 * regression: holdDepth just above MIN_ABSORB_DEPTH, or a fast catch into a
 * shallow dip). When the floor binds, the dip is shallower than the catch speed
 * can turn in and the absorb may slightly overshoot it — the deliberate corner
 * trade for exact C² joints. On the scoop-shape test domain (holdDepth ≥ 0.02,
 * vertical speeds ≤ 18 m/s) the floor never binds: 2·d/v ≥ 2.2 ms > v·K.
 */
const ABSORB_TIME_PER_SPEED = 5e-5;

/**
 * Segments shorter than this build their quintics via
 * {@link quinticHermiteConditioned} and with EXACT evaluation-visible durations
 * (see buildQuinticViaCarry); longer segments keep the original
 * {@link quinticHermite} construction so their output is bit-for-bit unchanged.
 * At 50 ms the legacy construction's worst joint error is ≲ 5e-11 — safely
 * inside the 1e-9 budget — so the switchover is invisible.
 */
const SHORT_SEGMENT_TIME = 0.05;

/**
 * Level holds shorter than this are dropped (the absorb takes the half-carry
 * instead): a micro-hold's residual rounding, divided by its tiny duration²
 * at the acceleration level, would also breach the continuity budget.
 */
const MIN_HOLD_TIME = 1e-3;

/**
 * Minimum absorb/wind-up flank time (s) for a RETURN's dip scoop. A return
 * inherits the ball's release velocity (UP) at the throw and arrival velocity
 * (DOWN) at the catch — the opposite of a carry, whose boundary velocities point
 * INTO the dip — so its scoop-sweep flanks work harder to reverse the vertical
 * motion, and for a high throw (large release/arrival speed) the
 * {@link ABSORB_TIME_PER_SPEED} floor collapses the flank toward ~0.7 ms, whose
 * steep quintic breaches the 1e-9 acceleration-continuity budget at the flank
 * seams (measured 1.78e-9 for a value-14 return at g ≈ 19, holdDepth ≈ 0.005 —
 * the near-MIN_ABSORB conditioning corner). Unlike a carry, a return is NOT
 * subject to the scoop-shape monotone-descent test, so its flank may be floored
 * to a clean-conditioning duration without risking a vertical overshoot below
 * the dip (a slightly lower empty-hand ready point is harmless). At 3 ms the
 * measured worst return-flank endpoint |a| error over the property domain drops
 * to ~2.6e-10 — comfortably inside budget. The value is capped at a quarter of
 * the return so the scoop's sweep always survives (see buildScoopSweepCarry).
 */
const RETURN_FLANK_FLOOR = 3e-3;

/**
 * Cap (m/s²) on the internal horizontal acceleration of a HELD-2 rest flank,
 * used to decide when a held 2 may rest at the dip versus scoop through. The
 * rest brings the hand to velocity ZERO, cramming the full half-chord horizontal
 * reposition into a flank whose duration is fixed by the vertical descent
 * (2·holdDepth/v_y — it cannot be lengthened without overshooting the dip). When
 * the dip is shallow and/or the catch is fast, that flank collapses and the
 * reposition's steep quintic drives the absorb→rest acceleration seam past the
 * 1e-9 budget (adversarially verified: ~1.0e-9 at holdDepth 0.009, ~3.7e-8 at
 * 0.0015). A held 2 therefore rests only when reposition/flank² ≤ this cap
 * (flank ≥ √(reposition/cap)); otherwise it scoops through like a normal carry,
 * which spreads the reposition across the long sweep instead of the flank. At
 * reposition 0.1 m the cap admits the rest for flank ≥ 5 ms — measured seam error
 * ≤ ~3e-10 — and realistic holds (holdDepth ≳ 0.02 at moderate gravity) keep it;
 * only the extreme shallow-dip / high-gravity corner falls through (still
 * continuous, non-flat, and nowhere near a realistic hold).
 */
const HELD_REST_MAX_ACCEL = 4000;

/**
 * Smooth scoop-sweep for NORMAL (single-beat) carries whose absorb leaves spare
 * time — exactly the carries where the level-hold construction used to flatten
 * the bottom (the owner's "often flat at the bottom of the hold"; the flat is
 * reserved for held 2s). Three C²-stitched segments:
 *
 *   absorb  (catch → dip entry)  quintic flank, endpoint accel (0, −g, 0)
 *   sweep   (through the dip)    exact parabola-with-drift, vertex at dipY
 *   wind-up (dip exit → throw)   quintic flank, endpoint accel (0, −g, 0)
 *
 * VERTICAL: the sweep is the parabola y = dipY + a_y/2·(s − t_sweep/2)² with
 * entry/exit depth δ = holdDepth/4 above the vertex (entry vy = −w, exit +w,
 * w = holdDepth/t_sweep, a_y = 2·w/t_sweep — all one family: δ = w·t_sweep/4).
 * Each flank then decelerates the larger endpoint vertical speed v_y to w over
 * the remaining depth 3d/4 by the constant-deceleration identity
 * t_flank = 2·(3d/4)/(v_y + w); with t_sweep + 2·t_flank = T this collapses to
 * the closed-form root of
 *
 *   v_y·t_sweep² + (4d − T·v_y)·t_sweep − T·d = 0
 *
 * evaluated in the numerically stable branch (t_sweep ∈ (T/4, T]; v_y = 0
 * gives exactly T/4 with no special case). The bottom is a single smooth
 * minimum at exactly dipY — no flat, no overshoot, monotone flanks (pinned by
 * the scoop property test and the flat-fraction test).
 *
 * HORIZONTAL (x and z): the dip entry/exit are placed so each flank is a
 * constant-acceleration-consistent velocity ramp from the endpoint velocity to
 * the sweep drift u (runway = (v_end + u)/2 · t_flank), with the drift closing
 * the chord exactly:
 *
 *   u = (Δ − (v_catch + v_throw)·t_flank/2) / (t_sweep + t_flank)
 *
 * This is what tames the zip counter-snap: a fast, mostly-horizontal release
 * (a value-1 rethrow) pulls the dip exit toward the catch side, giving the
 * wind-up the runway to accelerate monotonically into the release instead of
 * swinging backward first (531 at defaults: 28.5 mm / +2.3 m/s of counter-swing
 * before; none after — pinned by the zip regression test).
 *
 * Built with the conditioned Hermite and exact evaluation-visible durations
 * throughout (the flanks are short by construction — the same conditioning
 * rules as the legacy short branch). Returns null when the conditioning floor
 * eats the sweep (extreme speed / short-carry corners); the caller falls back
 * to the legacy construction.
 */
function buildScoopSweepCarry(spec: CarrySpec): PolySegment[] | null {
  const { startTime, endTime, catchPoint, throwPoint, startVelocity, endVelocity } = spec;
  const total = endTime - startTime;
  const depth = spec.holdDepth;
  const g = gravityVector(spec.gravity);
  const dipY = 0.5 * (catchPoint.y + throwPoint.y) - depth;
  const verticalSpeed = Math.max(Math.abs(startVelocity.y), Math.abs(endVelocity.y));
  const q = 4 * depth - total * verticalSpeed;
  const root = Math.sqrt(q * q + 4 * verticalSpeed * total * depth);
  const sweepRaw = q > 0 ? (2 * total * depth) / (q + root) : (root - q) / (2 * verticalSpeed);
  let flankTime = (total - sweepRaw) / 2;
  // Floor the flank for numerical conditioning: the ABSORB_TIME_PER_SPEED scale
  // caps the internal vertical acceleration, and RETURNS additionally floor by
  // minFlankTime (their ball-velocity-driven flanks would otherwise collapse
  // below a clean-conditioning duration — see RETURN_FLANK_FLOOR).
  const flankFloor = Math.max(verticalSpeed * ABSORB_TIME_PER_SPEED, spec.minFlankTime ?? 0);
  if (flankTime < flankFloor) {
    flankTime = Math.min(flankFloor, total / 2);
  }
  const sweepTime = total - 2 * flankTime;
  if (sweepTime < Math.max(1e-3, total / 8)) {
    return null;
  }
  const dipSpeed = depth / sweepTime; // w: |vy| entering/leaving the sweep
  const sweepAccelY = (2 * dipSpeed) / sweepTime; // a_y: upward parabola curvature
  const entryY = dipY + 0.25 * depth; // δ = d/4 above the vertex
  const driftOf = (from: number, to: number, vFrom: number, vTo: number): number =>
    (to - from - ((vFrom + vTo) * flankTime) / 2) / (sweepTime + flankTime);
  const driftX = driftOf(catchPoint.x, throwPoint.x, startVelocity.x, endVelocity.x);
  const driftZ = driftOf(catchPoint.z, throwPoint.z, startVelocity.z, endVelocity.z);
  const dipEntry = vec3(
    catchPoint.x + ((startVelocity.x + driftX) * flankTime) / 2,
    entryY,
    catchPoint.z + ((startVelocity.z + driftZ) * flankTime) / 2,
  );
  const dipExit = vec3(
    throwPoint.x - ((endVelocity.x + driftX) * flankTime) / 2,
    entryY,
    throwPoint.z - ((endVelocity.z + driftZ) * flankTime) / 2,
  );
  const entryTime = startTime + flankTime;
  const exitTime = endTime - flankTime;
  // Exact evaluation-visible durations (see SHORT_SEGMENT_TIME notes): each
  // Hermite is built with the double duration the evaluator will compute, so
  // joints land exactly on the designed endpoint states.
  const absorbDuration = entryTime - startTime;
  const sweepDuration = exitTime - entryTime;
  const windupDuration = endTime - exitTime;
  return [
    {
      startTime,
      endTime: entryTime,
      x: quinticHermiteConditioned(catchPoint.x, startVelocity.x, g.x, dipEntry.x, driftX, 0, absorbDuration),
      y: quinticHermiteConditioned(catchPoint.y, startVelocity.y, g.y, dipEntry.y, -dipSpeed, sweepAccelY, absorbDuration),
      z: quinticHermiteConditioned(catchPoint.z, startVelocity.z, g.z, dipEntry.z, driftZ, 0, absorbDuration),
    },
    {
      // Boundary states are exactly those of the parabola-with-drift, so the
      // unique quintic through them IS that parabola: vertex (the carry's one
      // minimum) at dipY, drift u in x/z.
      startTime: entryTime,
      endTime: exitTime,
      x: quinticHermiteConditioned(dipEntry.x, driftX, 0, dipExit.x, driftX, 0, sweepDuration),
      y: quinticHermiteConditioned(dipEntry.y, -dipSpeed, sweepAccelY, dipExit.y, dipSpeed, sweepAccelY, sweepDuration),
      z: quinticHermiteConditioned(dipEntry.z, driftZ, 0, dipExit.z, driftZ, 0, sweepDuration),
    },
    {
      startTime: exitTime,
      endTime,
      x: quinticHermiteConditioned(dipExit.x, driftX, 0, throwPoint.x, endVelocity.x, g.x, windupDuration),
      y: quinticHermiteConditioned(dipExit.y, dipSpeed, sweepAccelY, throwPoint.y, endVelocity.y, g.y, windupDuration),
      z: quinticHermiteConditioned(dipExit.z, driftZ, 0, throwPoint.z, endVelocity.z, g.z, windupDuration),
    },
  ];
}

/**
 * Held-2 carry (`spec.held`): the hand rests EXACTLY at the dip low point — a
 * true stop (velocity, acceleration, and jerk all zero), not a level slide. The
 * owner's rule: holds may simply stop at the lowest point of the hold; no hand
 * path is ever flat-and-moving. Three C²-stitched segments:
 *
 *   absorb  (catch → rest)   quintic flank, endpoint accel (0, −g, 0) → (0,0,0)
 *   rest    (at the dip)      constant polynomials — v = a = jerk ≡ 0
 *   wind-up (rest → throw)    quintic flank, endpoint accel (0,0,0) → (0, −g, 0)
 *
 * The rest point is the catch/throw midpoint in x/z at y = dipY. ALL horizontal
 * repositioning happens in the curved flanks (never a flat horizontal creep
 * across the hold — the owner forbids that slow slide). The vertical profile of
 * each flank is identical to the old level hold's (catchY, v_y, −g) → (dipY, 0,
 * 0), so the monotone descent to exactly dipY with no overshoot is preserved
 * (the scoop-shape test). Only the horizontal endpoints change (to the rest at
 * v = 0 instead of a nonzero chord handoff) and the hold is a static rest, not a
 * level slide.
 *
 * Flank timing is the raw absorb time (2·holdDepth/v_y floored by
 * {@link ABSORB_TIME_PER_SPEED}) — matched to the vertical descent so it cannot
 * overshoot; lengthening it to ease the horizontal reposition was tried and
 * REFUTED (it drove the vertical flank past dipY). Short flanks use the
 * conditioned Hermite with EXACT evaluation-visible durations (endTime −
 * startTime, as doubles) so the internal jerk cannot amplify an ε·|t| duration
 * gap into a joint acceleration mismatch (the flaky-continuity root cause);
 * measured worst held-flank endpoint |a| error over the property domain ~7e-11,
 * so no extra reposition floor is needed.
 */
function buildHeldRestCarry(spec: CarrySpec, boundedAbsorb: number, dipY: number): PolySegment[] {
  const { startTime, endTime, catchPoint, throwPoint, startVelocity, endVelocity } = spec;
  const total = endTime - startTime;
  const g = gravityVector(spec.gravity);
  const rest = vec3(
    0.5 * (catchPoint.x + throwPoint.x),
    dipY,
    0.5 * (catchPoint.z + throwPoint.z),
  );
  // The flank time is the raw absorb time — 2·holdDepth/v_y floored by
  // ABSORB_TIME_PER_SPEED (the vertical descent is timed to the vertical speed;
  // lengthening it would overshoot below the dip). The exact evaluation-visible
  // durations below keep the seam accelerations inside the 1e-9 budget with no
  // extra floor (measured worst held-flank endpoint |a| error ~7e-11 over the
  // property domain). Never consume the whole carry: keep a resting hold of at
  // least MIN_HOLD_TIME.
  const flankTime = Math.min(boundedAbsorb, 0.5 * (total - MIN_HOLD_TIME));
  const entryTime = startTime + flankTime;
  const exitTime = endTime - flankTime;
  const short = flankTime < SHORT_SEGMENT_TIME;
  const hermite = short ? quinticHermiteConditioned : quinticHermite;
  const absorbDuration = short ? entryTime - startTime : flankTime;
  const windupDuration = short ? endTime - exitTime : flankTime;
  return [
    {
      startTime,
      endTime: entryTime,
      x: hermite(catchPoint.x, startVelocity.x, g.x, rest.x, 0, 0, absorbDuration),
      y: hermite(catchPoint.y, startVelocity.y, g.y, rest.y, 0, 0, absorbDuration),
      z: hermite(catchPoint.z, startVelocity.z, g.z, rest.z, 0, 0, absorbDuration),
    },
    // A true rest: constant polynomials, so velocity/acceleration/jerk are
    // exactly 0 through the whole hold (the strengthened held-carry test pins
    // |v| < 1e-9). The flanks meet it at v = a = 0, so the seams are C².
    staticSegment(entryTime, exitTime, rest),
    {
      startTime: exitTime,
      endTime,
      x: hermite(rest.x, 0, 0, throwPoint.x, endVelocity.x, g.x, windupDuration),
      y: hermite(rest.y, 0, 0, throwPoint.y, endVelocity.y, g.y, windupDuration),
      z: hermite(rest.z, 0, 0, throwPoint.z, endVelocity.z, g.z, windupDuration),
    },
  ];
}

/**
 * Default carry path (DESIGN.md §4.3): a bounded-absorb scoop. Dispatch:
 *
 *  - HELD carries (multi-beat 2s, `spec.held`) whose flank can reposition cleanly
 *    (see HELD_REST_MAX_ACCEL) — a true REST at the dip low point
 *    ({@link buildHeldRestCarry}): the hand stops there (v = 0), all horizontal
 *    repositioning in the curved flanks.
 *  - NORMAL carries with spare time — and held 2s whose flank is too short to
 *    rest cleanly (shallow dip / fast catch corner) — the smooth scoop-sweep
 *    ({@link buildScoopSweepCarry}): one continuous parabolic dip, no flat.
 *  - No spare time (deep/slow: 2·d/v_y ≥ total/2), a vanishing hold depth, OR a
 *    carry whose scoop-sweep tripped its conditioning guard — two half-carry
 *    segments meeting at the dip (a natural V; level y at the dip, horizontal
 *    chord drift through it — continuous and NON-flat). The flat is reserved for
 *    the true rest, so a normal carry NEVER lands on the level hold.
 *
 * All variants match (0, −g, 0) acceleration at the carry endpoints (contact
 * force ramps from zero at the catch and back to zero at the release) and are
 * stitched C² at the internal joints. The absorb time comes from the
 * constant-deceleration identity — cancelling a vertical speed v over a
 * stopping distance d takes 2·d/v seconds — sized by the larger endpoint
 * vertical speed so both flanks fit, and floored for numerical conditioning
 * (see {@link ABSORB_TIME_PER_SPEED}):
 *
 *   v_y      = max(|v_catch·ŷ|, |v_throw·ŷ|)
 *   t_absorb = min(total/2, max(2·holdDepth / v_y, v_y·ABSORB_TIME_PER_SPEED))
 *
 * The descent is monotone into the dip with no overshoot below it and no
 * mid-carry bump back up (the wavy-carry regression, pinned by the scoop
 * property test). The dip acceleration is never (0, −g, 0): with dip vertical
 * velocity 0 an acceleration of −g would make the dip a local MAXIMUM of
 * vertical motion — which is precisely what produced the old W-shaped double
 * dip.
 *
 * Degenerate guard: a vanishing hold depth (or vertical speed) has no useful
 * finite absorb time; fall back to t_absorb = total/2 (two half-carry segments
 * meeting at the dip) so no zero-duration segment is ever built and
 * holdDepth = 0 stays NaN-free.
 */
function buildQuinticViaCarry(spec: CarrySpec): PolySegment[] {
  const { startTime, endTime, catchPoint, throwPoint, startVelocity, endVelocity } = spec;
  const total = endTime - startTime;
  if (total <= 0) {
    return [staticSegment(startTime, endTime, catchPoint)];
  }
  const half = total / 2;
  const g = gravityVector(spec.gravity);
  // Average catch→throw drift (per second); the V dip is traversed level in y at
  // exactly this rate (a horizontal sweep through the low point).
  const chordVelocity = scale(subtract(throwPoint, catchPoint), 1 / total);
  const dipY = 0.5 * (catchPoint.y + throwPoint.y) - spec.holdDepth;
  const verticalSpeed = Math.max(Math.abs(startVelocity.y), Math.abs(endVelocity.y));
  // 2·d/v = +Infinity when verticalSpeed is 0 (both flights level out exactly at
  // the endpoints); Math.min then falls back to the half-carry absorb. The
  // ABSORB_TIME_PER_SPEED floor keeps the absorb numerically well-conditioned
  // when the dip is much shallower than the catch speed can turn in.
  const boundedAbsorb =
    spec.holdDepth > MIN_ABSORB_DEPTH
      ? Math.min(
          half,
          Math.max((2 * spec.holdDepth) / verticalSpeed, verticalSpeed * ABSORB_TIME_PER_SPEED),
        )
      : half;
  const hasHold = total - 2 * boundedAbsorb > MIN_HOLD_TIME;
  // A HELD 2 rests at the dip (v = 0) ONLY when its flank — timed to the vertical
  // descent (2·holdDepth/v_y) so it cannot overshoot the dip — is ALSO long enough
  // to reposition horizontally without breaching conditioning. The v = 0 rest
  // crams the full half-chord reposition into that flank, and a collapsing flank
  // (shallow dip and/or fast catch) drives the absorb→rest acceleration seam past
  // the 1e-9 budget (see HELD_REST_MAX_ACCEL); lengthening the flank was refuted
  // (it overshoots). In that corner the held 2 instead scoops through like a
  // normal carry (smooth, non-flat) — the scoop-sweep spreads the horizontal
  // reposition across the long sweep, off the collapsing flank.
  const reposition =
    0.5 * Math.max(Math.abs(throwPoint.x - catchPoint.x), Math.abs(throwPoint.z - catchPoint.z));
  const restFlankClean = boundedAbsorb >= Math.sqrt(reposition / HELD_REST_MAX_ACCEL);
  const useHold = hasHold && spec.held === true && restFlankClean;
  // NORMAL carries with spare time — and held 2s that cannot rest cleanly — sweep
  // a smooth parabolic bottom through the dip (no flat). The level slide is gone:
  // a carry whose scoop-sweep guard trips falls through to the V below, and the
  // flat is reserved for the true rest (useHold), never a normal carry.
  if (hasHold && !useHold) {
    const smooth = buildScoopSweepCarry(spec);
    if (smooth) {
      return smooth;
    }
  }
  if (useHold) {
    return buildHeldRestCarry(spec, boundedAbsorb, dipY);
  }
  // V: two half-carry segments meeting at the dip (deep/slow carries, the
  // smooth-guard fallback, and holdDepth ≈ 0). Level y at the dip, horizontal
  // chord drift through it — continuous and non-flat.
  const absorbTime = half;
  const dipEntryTime = startTime + absorbTime;
  const dipVelocity = vec3(chordVelocity.x, 0, chordVelocity.z);
  const dipEntry = vec3(
    catchPoint.x + chordVelocity.x * absorbTime,
    dipY,
    catchPoint.z + chordVelocity.z * absorbTime,
  );
  // Short segments carry steep quintics (internal jerk up to ~v/t_absorb²), so
  // below SHORT_SEGMENT_TIME build with the conditioned Hermite and the EXACT
  // duration evaluation will see (endTime − startTime, as doubles) — otherwise
  // an ε·|t| gap between the designed duration and the evaluated local time is
  // amplified by the jerk into a joint acceleration mismatch (the flaky
  // continuity failure). Longer segments keep the original construction path.
  const short = absorbTime < SHORT_SEGMENT_TIME;
  const hermite = short ? quinticHermiteConditioned : quinticHermite;
  const absorbDuration = short ? dipEntryTime - startTime : absorbTime;
  const windupDuration = short ? endTime - dipEntryTime : absorbTime;
  return [
    {
      startTime,
      endTime: dipEntryTime,
      x: hermite(catchPoint.x, startVelocity.x, g.x, dipEntry.x, dipVelocity.x, 0, absorbDuration),
      y: hermite(catchPoint.y, startVelocity.y, g.y, dipEntry.y, dipVelocity.y, 0, absorbDuration),
      z: hermite(catchPoint.z, startVelocity.z, g.z, dipEntry.z, dipVelocity.z, 0, absorbDuration),
    },
    {
      startTime: dipEntryTime,
      endTime,
      x: hermite(dipEntry.x, dipVelocity.x, 0, throwPoint.x, endVelocity.x, g.x, windupDuration),
      y: hermite(dipEntry.y, dipVelocity.y, 0, throwPoint.y, endVelocity.y, g.y, windupDuration),
      z: hermite(dipEntry.z, dipVelocity.z, 0, throwPoint.z, endVelocity.z, g.z, windupDuration),
    },
  ];
}

/**
 * Comparison carry path: a single cubic Hermite over the whole carry, matching
 * position and velocity at the endpoints only. It does NOT match endpoint
 * acceleration, so ball acceleration jumps at the catch and throw events — the
 * property test pins this as the reason the quintic is the default (§4.3).
 */
function buildCubicCarry(spec: CarrySpec): PolySegment[] {
  const { startTime, endTime, catchPoint, throwPoint, startVelocity, endVelocity } = spec;
  const total = endTime - startTime;
  if (total <= 0) {
    return [staticSegment(startTime, endTime, catchPoint)];
  }
  return [
    {
      startTime,
      endTime,
      x: cubicHermite(catchPoint.x, startVelocity.x, throwPoint.x, endVelocity.x, total),
      y: cubicHermite(catchPoint.y, startVelocity.y, throwPoint.y, endVelocity.y, total),
      z: cubicHermite(catchPoint.z, startVelocity.z, throwPoint.z, endVelocity.z, total),
    },
  ];
}

/** A constant-position segment (degenerate / rest fallback). */
function staticSegment(startTime: number, endTime: number, position: Vec3): PolySegment {
  return {
    startTime,
    endTime,
    x: new Polynomial([position.x]),
    y: new Polynomial([position.y]),
    z: new Polynomial([position.z]),
  };
}

/** The default carry path (DESIGN.md §4.3): quintic scoop-and-hold via the dip. */
export const quinticViaCarryPath: CarryPath = { name: 'quintic-via', build: buildQuinticViaCarry };

/** The comparison carry path: velocity-matched cubic Hermite (acceleration jumps). */
export const cubicBezierCarryPath: CarryPath = { name: 'cubic-bezier', build: buildCubicCarry };

/**
 * Empty-hand return (throw → next catch): the hand scoops through a low ready
 * point via the SAME dip construction as a carry ({@link buildQuinticViaCarry}
 * with `held: false`), NOT a single quintic pinned to the throw's six ball-
 * derived boundary states. That single quintic was exactly the flight parabola
 * for a self-throw (its endpoints ARE the flight's), so the empty hand traced
 * the ball's whole arc (owner: "the hand throwing the 4 follows the ball"); for
 * fast zips it lunged toward the far hand on the inherited release velocity.
 * Routing through the dip pulls the hand down to the ready point instead.
 *
 * The seams stay C²: the via-carry absorb begins at exactly (fromPoint,
 * fromVelocity, (0, −g, 0)) and the wind-up ends at exactly (toPoint,
 * toVelocity, (0, −g, 0)) — the same six endpoint states the old single quintic
 * matched; only the interior changes (it now dips instead of tracking the ball).
 * Returns ALWAYS use this construction regardless of the user's carry-path
 * choice (the old return was likewise a hardcoded quintic). buildQuinticViaCarry
 * handles the total ≤ 0 / short / holdDepth = 0 edge cases, so no guard here.
 */
function buildReturn(
  startTime: number,
  endTime: number,
  fromPoint: Vec3,
  fromVelocity: Vec3,
  toPoint: Vec3,
  toVelocity: Vec3,
  gravity: number,
  holdDepth: number,
): PolySegment[] {
  return buildQuinticViaCarry({
    startTime,
    endTime,
    catchPoint: fromPoint,
    throwPoint: toPoint,
    startVelocity: fromVelocity,
    endVelocity: toVelocity,
    gravity,
    holdDepth,
    held: false,
    // Keep the empty-hand scoop's flanks numerically clean (see RETURN_FLANK_FLOOR),
    // capped at a quarter of the return so the sweep always survives.
    minFlankTime: Math.min(0.25 * (endTime - startTime), RETURN_FLANK_FLOOR),
  });
}

// --- Assembled kinematics ---------------------------------------------------

/**
 * A runtime kinematics-parameter change (DESIGN.md §4.6): from sim time `time`
 * onward the given fields apply. Gravity / hold depth / hand geometry / carry
 * path edits affect FUTURE segments only — an in-flight ball keeps the parabola
 * it was aimed with, a carry in progress keeps its path. Fields are optional and
 * merged cumulatively over the base params (like the timeline's `Epoch`). Unlike
 * the timeline's beat-indexed epoch, this is keyed by *time* because kinematics
 * segments resolve their params by their own start time (a flight at its throw
 * time, a carry at its catch time, a return at its start). Gravity is here — not
 * in {@link TimelineParams} — because it does not affect timing (air time is
 * `h·τ_b − t_d_eff`, g-independent, NOTATION identity 1).
 */
export interface KinematicsEpoch {
  /** Sim time (s) from which these params take effect (future segments only). */
  readonly time: number;
  /** g (m/s²) from `time` onward. */
  readonly gravity?: number;
  /** Hold-dip depth (m) from `time` onward. */
  readonly holdDepth?: number;
  /** Per-hand catch/throw points from `time` onward. */
  readonly geometry?: HandGeometry;
  /** Carry path from `time` onward. */
  readonly carryPath?: CarryPath;
}

/** Options for {@link buildKinematics}. */
export interface KinematicsOptions {
  /** The pattern's throw values (for spatial period + held-forever detection). */
  readonly values: readonly number[];
  /** n_h, the hand count (DESIGN.md §3). */
  readonly handCount: number;
  /** Per-hand catch/throw points; defaults to {@link defaultHandGeometry}. */
  readonly geometry?: HandGeometry;
  /** g (m/s²); default 9.81. */
  readonly gravity?: number;
  /** Hold-dip depth (m); default 0.10. */
  readonly holdDepth?: number;
  /** Carry path; default {@link quinticViaCarryPath}. */
  readonly carryPath?: CarryPath;
  /**
   * Optional ordered runtime parameter epochs (DESIGN.md §4.6). Each segment
   * resolves its gravity / hold depth / geometry / carry path by its own start
   * time; omit (or leave empty) for a single set of params over the whole build
   * (backward compatible — identical output to no epochs).
   */
  readonly epochs?: readonly KinematicsEpoch[];
}

/** Resolved kinematics params in force at a given sim time (base + epochs ≤ time). */
interface ResolvedKinematicsParams {
  readonly gravity: number;
  readonly holdDepth: number;
  readonly geometry: HandGeometry;
  readonly carryPath: CarryPath;
}

/** The motion of one carry: its segments and boundary data (for energy + tests). */
export interface CarryMotion {
  readonly ballId: number;
  readonly hand: number;
  readonly startBeat: number;
  readonly endBeat: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly segments: PolySegment[];
  readonly catchPoint: Vec3;
  readonly throwPoint: Vec3;
  readonly startVelocity: Vec3;
  readonly endVelocity: Vec3;
  /** g (m/s²) in effect for this carry (resolved at its catch time). */
  readonly gravity: number;
  readonly held: boolean;
}

/** A ball held indefinitely (all-2 hand): rendered riding its hand at rest. */
export interface StaticHold {
  readonly hand: number;
  /** Synthetic negative ball id, distinct from dynamic ids. */
  readonly ballId: number;
  readonly position: Vec3;
}

/** The evaluable kinematics over a timeline (closed-form for all `t`). */
export interface Kinematics {
  readonly gravity: number;
  readonly holdDepth: number;
  readonly handCount: number;
  readonly geometry: HandGeometry;
  readonly carryPath: CarryPath;
  /** Dynamic ball ids present as flights/carries (excludes held-forever balls). */
  ballIds(): number[];
  /** Ordered, contiguous motion segments for a ball. */
  ballSegments(ballId: number): PolySegment[];
  /** Ordered, contiguous motion segments for a hand (carries + returns). */
  handSegments(hand: number): PolySegment[];
  /** Ball position/velocity/acceleration/jerk at `t`, total for all `t`. */
  ballState(ballId: number, t: number): MotionState;
  /** Hand position/velocity/acceleration/jerk at `t`, total for all `t`. */
  handState(hand: number, t: number): MotionState;
  /** Per-hand carry motions (for energy aggregation and property tests). */
  carriesForHand(hand: number): CarryMotion[];
  /** Every carry motion in the generated range. */
  allCarries(): CarryMotion[];
  /** Balls held indefinitely by an all-2 hand (DESIGN.md §4.3 degenerate case). */
  staticHolds(): StaticHold[];
  /** Spatial period in beats (DESIGN.md §6), for energy aggregation windows. */
  spatialPeriodBeats: number;
}

function flightKey(ballId: number, beat: number): string {
  return `${ballId}:${beat}`;
}

/**
 * Assemble closed-form kinematics over a built timeline (DESIGN.md §4.2–§4.4).
 * Flights become parabolas; carries become carry-path segments whose boundary
 * velocities equal the adjoining flights' arrival/release velocities (so velocity
 * is continuous at every event); returns fill the empty-hand gaps.
 */
export function buildKinematics(timeline: Timeline, options: KinematicsOptions): Kinematics {
  // Base params (in force before any epoch). Each defaults to today's behavior so
  // existing call sites and tests are unchanged (backward compatible).
  const baseGravity = options.gravity ?? DEFAULT_GRAVITY;
  const baseHoldDepth = options.holdDepth ?? DEFAULT_HOLD_DEPTH;
  const handCount = options.handCount;
  const baseGeometry = options.geometry ?? defaultHandGeometry(handCount);
  const baseCarryPath = options.carryPath ?? quinticViaCarryPath;

  // Kinematics epochs (DESIGN.md §4.6): runtime gravity / hold depth / geometry /
  // carry-path edits apply to FUTURE segments only. Each segment resolves its
  // params by its own start time — a flight at its throw time, a carry at its
  // catch time, a return at its start (the preceding throw). Fields merge
  // cumulatively; sorted once, ascending in time. With no epochs this is exactly
  // the base params, so the output is bit-identical to the pre-epoch code.
  const sortedEpochs = [...(options.epochs ?? [])].sort((a, b) => a.time - b.time);
  const paramsAt = (time: number): ResolvedKinematicsParams => {
    let gravity = baseGravity;
    let holdDepth = baseHoldDepth;
    let geometry = baseGeometry;
    let carryPath = baseCarryPath;
    for (const epoch of sortedEpochs) {
      if (epoch.time > time) {
        break;
      }
      if (epoch.gravity !== undefined) {
        gravity = epoch.gravity;
      }
      if (epoch.holdDepth !== undefined) {
        holdDepth = epoch.holdDepth;
      }
      if (epoch.geometry !== undefined) {
        geometry = epoch.geometry;
      }
      if (epoch.carryPath !== undefined) {
        carryPath = epoch.carryPath;
      }
    }
    return { gravity, holdDepth, geometry, carryPath };
  };

  // Solve every flight at its THROW-time params: the parabola it was aimed with,
  // using the geometry (both throw and catch points) and gravity known at the
  // throw. An in-flight ball keeps this even if a later epoch changes gravity or
  // geometry (DESIGN.md §4.6). Index by (ballId, throwBeat)/(ballId, landingBeat)
  // so a carry can look up its delivering/departing flight for boundary state.
  interface SolvedFlight {
    readonly solution: FlightSolution;
    readonly throwPoint: Vec3;
    readonly catchPoint: Vec3;
    readonly gravity: number;
  }
  const flightData = new Map<Flight, SolvedFlight>();
  const byThrow = new Map<string, Flight>();
  const byLanding = new Map<string, Flight>();
  for (const flight of timeline.flights) {
    const p = paramsAt(flight.throwTime);
    const throwPoint = p.geometry.throwPoint(flight.throwHand);
    const catchPoint = p.geometry.catchPoint(flight.landingHand);
    const solution = solveFlight(throwPoint, catchPoint, flight.throwTime, flight.arrivalTime, p.gravity);
    flightData.set(flight, { solution, throwPoint, catchPoint, gravity: p.gravity });
    byThrow.set(flightKey(flight.ballId, flight.throwBeat), flight);
    byLanding.set(flightKey(flight.ballId, flight.landingBeat), flight);
  }

  // Solve every carry at its CATCH-time params (its internal gravity / hold depth
  // / carry path). Its endpoint POSITIONS and VELOCITIES are threaded from the
  // flights it connects — the delivering flight's arrival state (start) and the
  // departing flight's release state (end) — NOT re-resolved from geometry. This
  // is what keeps the BALL path position- AND velocity-continuous at every
  // catch/throw even ACROSS a parameter epoch: the flight thrown before an epoch
  // keeps its aim, and the carry that receives it starts exactly from that arrival
  // state (chaining through the boundary). Only the carry's *acceleration* endpoint
  // (0, −g, 0) uses the catch-time gravity, so at a param boundary the ball may
  // show a small, expected acceleration step at the catch (documented, §4.6).
  const carryMotions: CarryMotion[] = [];
  for (const carry of timeline.carries) {
    const p = paramsAt(carry.startTime);
    const delivering = byLanding.get(flightKey(carry.ballId, carry.startBeat));
    const departing = byThrow.get(flightKey(carry.ballId, carry.endBeat));
    const deliveringData = delivering ? flightData.get(delivering) : undefined;
    const departingData = departing ? flightData.get(departing) : undefined;
    // Endpoints from the connecting flights; geometry fallback only if a boundary
    // flight is missing (does not occur for in-range carries — every carry
    // connects two flights).
    const catchPoint = deliveringData ? deliveringData.catchPoint : p.geometry.catchPoint(carry.hand);
    const throwPoint = departingData ? departingData.throwPoint : p.geometry.throwPoint(carry.hand);
    const chord = scale(subtract(throwPoint, catchPoint), 1 / (carry.endTime - carry.startTime));
    const startVelocity = deliveringData ? deliveringData.solution.arrivalVelocity : chord;
    const endVelocity = departingData ? departingData.solution.releaseVelocity : chord;
    const segments = p.carryPath.build({
      startTime: carry.startTime,
      endTime: carry.endTime,
      catchPoint,
      throwPoint,
      startVelocity,
      endVelocity,
      gravity: p.gravity,
      holdDepth: p.holdDepth,
      held: carry.held,
    });
    carryMotions.push({
      ballId: carry.ballId,
      hand: carry.hand,
      startBeat: carry.startBeat,
      endBeat: carry.endBeat,
      startTime: carry.startTime,
      endTime: carry.endTime,
      segments,
      catchPoint,
      throwPoint,
      startVelocity,
      endVelocity,
      gravity: p.gravity,
      held: carry.held,
    });
  }

  // Ball → its ordered segment list (flights + carry halves).
  const ballSegmentMap = new Map<number, PolySegment[]>();
  const addBallSegments = (ballId: number, segs: PolySegment[]): void => {
    const bucket = ballSegmentMap.get(ballId);
    if (bucket) {
      bucket.push(...segs);
    } else {
      ballSegmentMap.set(ballId, [...segs]);
    }
  };
  for (const flight of timeline.flights) {
    addBallSegments(flight.ballId, [(flightData.get(flight) as SolvedFlight).solution.segment]);
  }
  for (const carry of carryMotions) {
    addBallSegments(carry.ballId, carry.segments);
  }
  for (const segs of ballSegmentMap.values()) {
    segs.sort((a, b) => a.startTime - b.startTime);
  }

  // Hand → carries (sorted); returns fill the gaps between consecutive carries.
  const carriesByHand = new Map<number, CarryMotion[]>();
  for (const carry of carryMotions) {
    const bucket = carriesByHand.get(carry.hand) ?? [];
    bucket.push(carry);
    carriesByHand.set(carry.hand, bucket);
  }
  for (const bucket of carriesByHand.values()) {
    bucket.sort((a, b) => a.startTime - b.startTime);
  }

  const handSegmentMap = new Map<number, PolySegment[]>();
  const buildHandSegments = (hand: number): PolySegment[] => {
    const cached = handSegmentMap.get(hand);
    if (cached) {
      return cached;
    }
    const carries = carriesByHand.get(hand) ?? [];
    const segments: PolySegment[] = [];
    for (let i = 0; i < carries.length; i++) {
      const carry = carries[i] as CarryMotion;
      segments.push(...carry.segments);
      const next = carries[i + 1];
      if (next && next.startTime > carry.endTime) {
        // Empty-hand return: throw point (release velocity) → next catch point
        // (arrival velocity), C² with both carries. It scoops through a low ready
        // point via the dip construction (no ball-tracking), using the return's
        // start-time gravity AND hold depth (the preceding throw). Its endpoint
        // acceleration (0, −g, 0) uses that gravity; across a param boundary the
        // empty HAND path may show a small, expected acceleration step here — the
        // ball is not in the hand, so this is fine (DESIGN.md §4.6). Endpoint
        // positions/velocities are threaded from the adjoining carries, so the
        // hand path stays position-continuous.
        const returnParams = paramsAt(carry.endTime);
        segments.push(
          ...buildReturn(
            carry.endTime,
            next.startTime,
            carry.throwPoint,
            carry.endVelocity,
            next.catchPoint,
            next.startVelocity,
            returnParams.gravity,
            returnParams.holdDepth,
          ),
        );
      }
    }
    handSegmentMap.set(hand, segments);
    return segments;
  };

  // Held-forever balls: a hand whose every beat (over lcm(L, n_h)) is a held 2.
  // The abstract `values` alone is not enough: a hand that is all-2 in the target
  // pattern can still receive a DYNAMIC ball via a state-graph transition INTO it
  // (e.g. 3 -> 42, 31 -> 2). That ball's last flight settles it into the hand, and
  // its held-2 tail has no closing flight — so it already renders as a dynamic ball
  // resting at its catch point (DESIGN.md §5). Synthesizing a StaticHold there too
  // would double-count it. So a hand qualifies for a hold only when the ACTUAL
  // timeline never delivers a flight into it — i.e. it eternally holds a ball with
  // no dynamic delivery. This decision is stable under horizon extension: the
  // prehistory (genStart) is fixed, and a genuinely all-2 hand never gains a
  // landing flight as the future window grows, so it never flips.
  const staticHoldList: StaticHold[] = [];
  const length = options.values.length;
  const holdRestByHand = new Map<number, Vec3>();
  if (length > 0 && handCount > 0) {
    const handsReceivingFlight = new Set<number>();
    for (const flight of timeline.flights) {
      handsReceivingFlight.add(flight.landingHand);
    }
    const span = lcmOf(length, handCount);
    for (let hand = 0; hand < handCount; hand++) {
      let anyBeat = false;
      let allHeld = true;
      for (let beat = 0; beat < span; beat++) {
        if (((beat % handCount) + handCount) % handCount !== hand) {
          continue;
        }
        anyBeat = true;
        if (options.values[beat % length] !== 2) {
          allHeld = false;
          break;
        }
      }
      if (anyBeat && allHeld && !handsReceivingFlight.has(hand)) {
        // Rest at the hold position (the dip point) so the ball sits sensibly.
        // Held-forever balls are a degenerate all-2 case (only meaningful at
        // n_h = 2); resolve them with the base geometry/hold depth (t = 0 params).
        const rest = subtract(
          midpoint(baseGeometry.catchPoint(hand), baseGeometry.throwPoint(hand)),
          vec3(0, baseHoldDepth, 0),
        );
        holdRestByHand.set(hand, rest);
        staticHoldList.push({ hand, ballId: -1 - hand, position: rest });
      }
    }
  }
  const staticBallPosition = new Map<number, Vec3>();
  for (const hold of staticHoldList) {
    staticBallPosition.set(hold.ballId, hold.position);
  }

  const dynamicBallIds = [...ballSegmentMap.keys()].sort((a, b) => a - b);

  return {
    // The `gravity`/`holdDepth`/`geometry`/`carryPath` fields report the BASE
    // (t = 0) params; per-segment params (under epochs) live on each CarryMotion
    // and are resolved internally. With no epochs these are the only params.
    gravity: baseGravity,
    holdDepth: baseHoldDepth,
    handCount,
    geometry: baseGeometry,
    carryPath: baseCarryPath,
    spatialPeriodBeats: spatialPeriodBeats(options.values, handCount),
    ballIds: () => [...dynamicBallIds],
    ballSegments: (ballId) => [...(ballSegmentMap.get(ballId) ?? [])],
    handSegments: (hand) => [...buildHandSegments(hand)],
    ballState: (ballId, t) => {
      const held = staticBallPosition.get(ballId);
      if (held) {
        return restState(held);
      }
      return evaluateSegments(ballSegmentMap.get(ballId) ?? [], t, ZERO);
    },
    handState: (hand, t) => {
      // Fallback rest: a held-forever hand rests at its hold point; any other
      // hand with no segments eases to and rests at its catch point (§4.3 idle).
      const fallback = holdRestByHand.get(hand) ?? baseGeometry.catchPoint(hand);
      return evaluateSegments(buildHandSegments(hand), t, fallback);
    },
    carriesForHand: (hand) => [...(carriesByHand.get(hand) ?? [])],
    allCarries: () => [...carryMotions],
    staticHolds: () => [...staticHoldList],
  };
}

/** Greatest common divisor (for the held-forever span). */
function gcdOf(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Least common multiple. */
function lcmOf(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return Math.abs((a / gcdOf(a, b)) * b);
}
