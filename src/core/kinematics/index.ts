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
 * Hands evenly spaced on a line along x at height `y`, z = 0: throw points inset
 * (±throwHalf) and catch points outset (±catchHalf). For n_h = 2 this is exactly
 * the DESIGN.md §7 default (throws x = ±0.10, catches x = ±0.30, y = 1.00). For
 * n_h = 1 both points sit at the origin column (straight-up throws).
 */
export function lineHandGeometry(
  handCount: number,
  { y = 1, throwHalf = 0.1, catchHalf = 0.3 }: { y?: number; throwHalf?: number; catchHalf?: number } = {},
): HandGeometry {
  const throwPoints: Vec3[] = [];
  const catchPoints: Vec3[] = [];
  for (let hand = 0; hand < Math.max(1, handCount); hand++) {
    // u ∈ [-1, 1] spreads hands symmetrically about the center line.
    const u = handCount <= 1 ? 0 : (hand / (handCount - 1)) * 2 - 1;
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
 * analytic derivatives. Flights are quadratics; quintic carry/return halves are
 * degree-5; cubic carries are degree-3.
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
}

/**
 * A pluggable catch→throw hand path (DESIGN.md §4.3). The default is quintic +
 * hold-dip via-point; the cubic Bézier alternative is provided for the
 * acceleration-jump comparison. Each `build` returns one or more contiguous
 * segments tiling [startTime, endTime].
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
 * Default carry path: two quintic Hermite segments through a hold-dip via-point
 * `holdDepth` below the catch–throw midpoint, stitched C² at the via-point and
 * matching (0, −g, 0) acceleration at both endpoints. Position, velocity, and
 * acceleration are continuous at the catch/throw events and at the stitch; the
 * contact force ramps from zero at the catch, through zero at the dip, to zero at
 * the release (§4.3, §4.5).
 */
function buildQuinticViaCarry(spec: CarrySpec): PolySegment[] {
  const { startTime, endTime, catchPoint, throwPoint, startVelocity, endVelocity } = spec;
  const total = endTime - startTime;
  if (total <= 0) {
    return [staticSegment(startTime, endTime, catchPoint)];
  }
  const half = total / 2;
  const midTime = startTime + half;
  const via = subtract(midpoint(catchPoint, throwPoint), vec3(0, spec.holdDepth, 0));
  // Via-point derivatives: chord velocity (for equal-height ends this is the true
  // turning point, vy=0) and free-fall-matched acceleration, shared by both
  // halves so the stitch is C² (equal a_mid ⇒ acceleration continuous).
  const vMid = scale(subtract(throwPoint, catchPoint), 1 / total);
  const g = gravityVector(spec.gravity);
  const segmentA: PolySegment = {
    startTime,
    endTime: midTime,
    x: quinticHermite(catchPoint.x, startVelocity.x, g.x, via.x, vMid.x, g.x, half),
    y: quinticHermite(catchPoint.y, startVelocity.y, g.y, via.y, vMid.y, g.y, half),
    z: quinticHermite(catchPoint.z, startVelocity.z, g.z, via.z, vMid.z, g.z, half),
  };
  const segmentB: PolySegment = {
    startTime: midTime,
    endTime,
    x: quinticHermite(via.x, vMid.x, g.x, throwPoint.x, endVelocity.x, g.x, half),
    y: quinticHermite(via.y, vMid.y, g.y, throwPoint.y, endVelocity.y, g.y, half),
    z: quinticHermite(via.z, vMid.z, g.z, throwPoint.z, endVelocity.z, g.z, half),
  };
  return [segmentA, segmentB];
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

/** The default carry path (DESIGN.md §4.3): quintic Hermite + hold-dip via-point. */
export const quinticViaCarryPath: CarryPath = { name: 'quintic-via', build: buildQuinticViaCarry };

/** The comparison carry path: velocity-matched cubic Hermite (acceleration jumps). */
export const cubicBezierCarryPath: CarryPath = { name: 'cubic-bezier', build: buildCubicCarry };

/**
 * A single quintic Hermite return segment (throw → next catch, empty hand),
 * matching velocity at both ends and (0, −g, 0) acceleration so it is C² with the
 * carries it joins (DESIGN.md §4.3). No via-point (empty-hand swing).
 */
function buildReturn(
  startTime: number,
  endTime: number,
  fromPoint: Vec3,
  fromVelocity: Vec3,
  toPoint: Vec3,
  toVelocity: Vec3,
  gravity: number,
): PolySegment {
  const T = endTime - startTime;
  if (T <= 0) {
    return staticSegment(startTime, endTime, fromPoint);
  }
  const g = gravityVector(gravity);
  return {
    startTime,
    endTime,
    x: quinticHermite(fromPoint.x, fromVelocity.x, g.x, toPoint.x, toVelocity.x, g.x, T),
    y: quinticHermite(fromPoint.y, fromVelocity.y, g.y, toPoint.y, toVelocity.y, g.y, T),
    z: quinticHermite(fromPoint.z, fromVelocity.z, g.z, toPoint.z, toVelocity.z, g.z, T),
  };
}

// --- Assembled kinematics ---------------------------------------------------

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
  const gravity = options.gravity ?? DEFAULT_GRAVITY;
  const holdDepth = options.holdDepth ?? DEFAULT_HOLD_DEPTH;
  const handCount = options.handCount;
  const geometry = options.geometry ?? defaultHandGeometry(handCount);
  const carryPath = options.carryPath ?? quinticViaCarryPath;

  // Solve every flight once; index by (ballId, throwBeat) and (ballId, landingBeat)
  // so a carry can look up its delivering/departing flight for boundary velocity.
  const flightSolution = new Map<Flight, FlightSolution>();
  const byThrow = new Map<string, Flight>();
  const byLanding = new Map<string, Flight>();
  for (const flight of timeline.flights) {
    flightSolution.set(
      flight,
      solveFlight(
        geometry.throwPoint(flight.throwHand),
        geometry.catchPoint(flight.landingHand),
        flight.throwTime,
        flight.arrivalTime,
        gravity,
      ),
    );
    byThrow.set(flightKey(flight.ballId, flight.throwBeat), flight);
    byLanding.set(flightKey(flight.ballId, flight.landingBeat), flight);
  }

  // Solve every carry: boundary velocities come from the flights it connects.
  const carryMotions: CarryMotion[] = [];
  for (const carry of timeline.carries) {
    const delivering = byLanding.get(flightKey(carry.ballId, carry.startBeat));
    const departing = byThrow.get(flightKey(carry.ballId, carry.endBeat));
    const catchPoint = geometry.catchPoint(carry.hand);
    const throwPoint = geometry.throwPoint(carry.hand);
    // Chord velocity is the defensive fallback if a boundary flight is missing
    // (does not occur for in-range carries — every carry connects two flights).
    const chord = scale(subtract(throwPoint, catchPoint), 1 / (carry.endTime - carry.startTime));
    const startVelocity = delivering
      ? (flightSolution.get(delivering) as FlightSolution).arrivalVelocity
      : chord;
    const endVelocity = departing
      ? (flightSolution.get(departing) as FlightSolution).releaseVelocity
      : chord;
    const segments = carryPath.build({
      startTime: carry.startTime,
      endTime: carry.endTime,
      catchPoint,
      throwPoint,
      startVelocity,
      endVelocity,
      gravity,
      holdDepth,
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
    addBallSegments(flight.ballId, [(flightSolution.get(flight) as FlightSolution).segment]);
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
        // (arrival velocity), C² with both carries.
        segments.push(
          buildReturn(
            carry.endTime,
            next.startTime,
            carry.throwPoint,
            carry.endVelocity,
            next.catchPoint,
            next.startVelocity,
            gravity,
          ),
        );
      }
    }
    handSegmentMap.set(hand, segments);
    return segments;
  };

  // Held-forever balls: a hand whose every beat (over lcm(L, n_h)) is a held 2.
  const staticHoldList: StaticHold[] = [];
  const length = options.values.length;
  const holdRestByHand = new Map<number, Vec3>();
  if (length > 0 && handCount > 0) {
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
      if (anyBeat && allHeld) {
        // Rest at the hold position (the dip point) so the ball sits sensibly.
        const rest = subtract(
          midpoint(geometry.catchPoint(hand), geometry.throwPoint(hand)),
          vec3(0, holdDepth, 0),
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
    gravity,
    holdDepth,
    handCount,
    geometry,
    carryPath,
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
      const fallback = holdRestByHand.get(hand) ?? geometry.catchPoint(hand);
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
