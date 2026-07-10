import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validatePattern } from '../siteswap';
import {
  buildTimeline,
  periodicSchedule,
  spliceSchedule,
  type TimelineParams,
} from '../timeline';
import { buildStateGraph, patternCycle, planTransition, stateAtBits } from '../stategraph';
import {
  add,
  apexHeight,
  buildKinematics,
  circleHandGeometry,
  cubicBezierCarryPath,
  cubicHermite,
  defaultHandGeometry,
  evaluateSegment,
  lineHandGeometry,
  magnitude,
  makeHandGeometry,
  quinticHermite,
  quinticViaCarryPath,
  solveFlight,
  vec3,
  type CarryMotion,
  type CarrySpec,
  type Kinematics,
  type KinematicsEpoch,
  type MotionState,
  type PolySegment,
  type Vec3,
} from './index';

const DEFAULT_PARAMS: TimelineParams = { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 };
const G = 9.81;

function parse(text: string): number[] {
  const result = validatePattern(text);
  if (!result.ok) {
    throw new Error(`fixture pattern ${text} is invalid`);
  }
  return result.values;
}

function kinematicsFor(
  text: string,
  beatCount: number,
  overrides: Partial<Parameters<typeof buildKinematics>[1]> = {},
): { kinematics: Kinematics; values: number[] } {
  const values = parse(text);
  const handCount = overrides.handCount ?? DEFAULT_PARAMS.handCount;
  const timeline = buildTimeline(values, {
    beatCount,
    params: { ...DEFAULT_PARAMS, handCount },
  });
  return {
    kinematics: buildKinematics(timeline, { values, handCount, ...overrides }),
    values,
  };
}

/** Max per-axis absolute difference of two vectors. */
function vecDiff(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/** Rendered ball set consumed by Balls.tsx: dynamic ids ∪ static-hold ids. */
function renderedBallIds(k: Kinematics): number[] {
  return [...k.ballIds(), ...k.staticHolds().map((h) => h.ballId)];
}

/**
 * Build kinematics for a legal state-graph transition from a valid prefix pattern
 * to a valid target (both ball count b, fitting N) — the same splice the store
 * performs (DESIGN.md §5), assembled directly so the kinematics fix is tested at
 * the core seam. `options.values` is the TARGET, exactly as buildSimulation passes.
 */
function transitionKinematics(
  prefixText: string,
  targetText: string,
  maxHeight: number,
  spliceBeat: number,
  extraBeats = 24,
): { kinematics: Kinematics; b: number; bridgeEndBeat: number; beatTime: (beat: number) => number } {
  const prefix = parse(prefixText);
  const target = parse(targetText);
  const result = validatePattern(prefix);
  const b = result.ok ? result.ballCount : 0;
  const graph = buildStateGraph(b, maxHeight);
  const source = stateAtBits(prefix, spliceBeat, maxHeight);
  const cycle = patternCycle(target, maxHeight);
  const plan = planTransition(graph, source, cycle.nodeSet);
  const targetPhase = cycle.phaseOf.get(plan.to) ?? 0;
  const schedule = spliceSchedule(periodicSchedule(prefix), spliceBeat, plan.throws, target, targetPhase);
  const bridgeEndBeat = spliceBeat + plan.throws.length;
  const timeline = buildTimeline(target, {
    beatCount: bridgeEndBeat + extraBeats,
    params: DEFAULT_PARAMS,
    schedule,
  });
  return {
    kinematics: buildKinematics(timeline, { values: target, handCount: 2 }),
    b,
    bridgeEndBeat,
    beatTime: (beat) => timeline.beatTime(beat),
  };
}

// --- Placeholder-era API (kept) ---------------------------------------------

describe('apexHeight', () => {
  it('computes the apex height from air time and gravity', () => {
    expect(apexHeight(1, 9.81)).toBeCloseTo(9.81 / 8, 12);
  });

  it('has zero apex for a zero air time', () => {
    expect(apexHeight(0)).toBe(0);
  });
});

// --- Hand geometry ----------------------------------------------------------

describe('hand geometry', () => {
  it('defaults n_h = 2 to the DESIGN §7 positions', () => {
    const geo = defaultHandGeometry(2);
    // Hand 0 at −x, hand 1 at +x; throws inset ±0.10, catches outset ±0.30, y = 1.
    expect(geo.throwPoint(0)).toEqual(vec3(-0.1, 1, 0));
    expect(geo.catchPoint(0)).toEqual(vec3(-0.3, 1, 0));
    expect(geo.throwPoint(1)).toEqual(vec3(0.1, 1, 0));
    expect(geo.catchPoint(1)).toEqual(vec3(0.3, 1, 0));
  });

  it('puts a single hand on the center column', () => {
    const geo = lineHandGeometry(1);
    expect(geo.throwPoint(0)).toEqual(vec3(0, 1, 0));
    expect(geo.catchPoint(0)).toEqual(vec3(0, 1, 0));
  });

  it('wraps hand indices modulo the hand count', () => {
    const geo = defaultHandGeometry(2);
    expect(geo.throwPoint(2)).toEqual(geo.throwPoint(0));
    expect(geo.catchPoint(-1)).toEqual(geo.catchPoint(1));
  });

  it('places circle-preset hands on the requested radius, throws inset', () => {
    const geo = circleHandGeometry(4, { radius: 0.45, throwInset: 0.1, y: 1 });
    for (let hand = 0; hand < 4; hand++) {
      const c = geo.catchPoint(hand);
      expect(Math.hypot(c.x, c.z)).toBeCloseTo(0.45, 12);
      expect(c.y).toBe(1);
      const t = geo.throwPoint(hand);
      expect(Math.hypot(t.x, t.z)).toBeCloseTo(0.35, 12);
    }
  });

  it('makeHandGeometry falls back to origin for an empty geometry', () => {
    const geo = makeHandGeometry([], []);
    expect(geo.throwPoint(0)).toEqual(vec3(0, 0, 0));
    expect(geo.catchPoint(3)).toEqual(vec3(0, 0, 0));
  });
});

// --- Vector helpers ---------------------------------------------------------

describe('vec3 helpers', () => {
  it('adds vectors and measures magnitude', () => {
    expect(add(vec3(1, 2, 3), vec3(-1, 0, 4))).toEqual(vec3(0, 2, 7));
    expect(magnitude(vec3(3, 4, 0))).toBeCloseTo(5, 12);
  });
});

// --- Carry-path degenerate guards -------------------------------------------

describe('carry paths handle a degenerate zero-duration carry', () => {
  const spec: CarrySpec = {
    startTime: 1,
    endTime: 1,
    catchPoint: vec3(-0.3, 1, 0),
    throwPoint: vec3(-0.1, 1, 0),
    startVelocity: vec3(0, 0, 0),
    endVelocity: vec3(0, 0, 0),
    gravity: G,
    holdDepth: 0.1,
  };

  it('returns a static segment at the catch point without dividing by zero', () => {
    for (const path of [quinticViaCarryPath, cubicBezierCarryPath]) {
      const segments = path.build(spec);
      expect(segments).toHaveLength(1);
      const state = evalSeg(segments[0] as PolySegment, 1);
      expect(vecDiff(state.position, spec.catchPoint)).toBe(0);
    }
  });
});

// --- Parabola solver (§4.2) -------------------------------------------------

describe('solveFlight — the unique parabola (§4.2)', () => {
  const from = vec3(-0.1, 1, 0);
  const to = vec3(0.3, 1.2, 0.05);
  const solution = solveFlight(from, to, 2, 2.5, G);

  it('hits the throw and catch points at the endpoints', () => {
    const start = evalSeg(solution.segment, 2);
    const end = evalSeg(solution.segment, 2.5);
    expect(vecDiff(start.position, from)).toBeLessThan(1e-12);
    expect(vecDiff(end.position, to)).toBeLessThan(1e-12);
  });

  it('has acceleration exactly (0, −g, 0) throughout', () => {
    for (const t of [2, 2.2, 2.49]) {
      expect(evalSeg(solution.segment, t).acceleration).toEqual(vec3(0, -G, 0));
    }
  });

  it('relates arrival velocity to release velocity by −g·t_air', () => {
    const tAir = 0.5;
    expect(solution.arrivalVelocity.x).toBeCloseTo(solution.releaseVelocity.x, 12);
    expect(solution.arrivalVelocity.y).toBeCloseTo(solution.releaseVelocity.y - G * tAir, 12);
    expect(solution.arrivalVelocity.z).toBeCloseTo(solution.releaseVelocity.z, 12);
  });

  it('reaches z_apex above equal-height endpoints at the midpoint (identity 3)', () => {
    const level = solveFlight(vec3(-0.1, 1, 0), vec3(0.3, 1, 0), 0, 0.6, G);
    const apex = evalSeg(level.segment, 0.3).position.y - 1;
    expect(apex).toBeCloseTo(apexHeight(0.6, G), 12);
  });
});

// --- Hermite solvers --------------------------------------------------------

describe('quinticHermite — matches position/velocity/acceleration at both ends', () => {
  it('satisfies all six boundary conditions', () => {
    fc.assert(
      fc.property(
        fc.record({
          p0: fc.double({ min: -2, max: 2, noNaN: true }),
          v0: fc.double({ min: -3, max: 3, noNaN: true }),
          a0: fc.double({ min: -10, max: 10, noNaN: true }),
          p1: fc.double({ min: -2, max: 2, noNaN: true }),
          v1: fc.double({ min: -3, max: 3, noNaN: true }),
          a1: fc.double({ min: -10, max: 10, noNaN: true }),
          T: fc.double({ min: 0.05, max: 1.5, noNaN: true }),
        }),
        ({ p0, v0, a0, p1, v1, a1, T }) => {
          const p = quinticHermite(p0, v0, a0, p1, v1, a1, T);
          const dp = p.derivative();
          const ddp = dp.derivative();
          expect(p.eval(0)).toBeCloseTo(p0, 9);
          expect(dp.eval(0)).toBeCloseTo(v0, 9);
          expect(ddp.eval(0)).toBeCloseTo(a0, 9);
          expect(p.eval(T)).toBeCloseTo(p1, 8);
          expect(dp.eval(T)).toBeCloseTo(v1, 8);
          expect(ddp.eval(T)).toBeCloseTo(a1, 8);
        },
      ),
    );
  });
});

describe('cubicHermite — matches position/velocity only', () => {
  it('matches endpoints but generally not the acceleration target', () => {
    const p = cubicHermite(0, 1, 1, 0, 0.5);
    const dp = p.derivative();
    expect(p.eval(0)).toBeCloseTo(0, 12);
    expect(dp.eval(0)).toBeCloseTo(1, 12);
    expect(p.eval(0.5)).toBeCloseTo(1, 12);
    expect(dp.eval(0.5)).toBeCloseTo(0, 12);
    // Endpoint acceleration is forced by the endpoints — not free to be −g.
    expect(dp.derivative().eval(0)).not.toBeCloseTo(-G, 2);
  });
});

// --- Assembled kinematics: cascade 3 ---------------------------------------

describe('buildKinematics — cascade 3', () => {
  const { kinematics } = kinematicsFor('3', 16);

  it('has three balls and no static holds', () => {
    expect(kinematics.ballIds()).toHaveLength(3);
    expect(kinematics.staticHolds()).toEqual([]);
  });

  it('is defined for all t, including before the first and after the last segment', () => {
    for (const t of [-100, -1, 0, 1.23, 3.0, 1000]) {
      for (const ballId of kinematics.ballIds()) {
        expect(() => kinematics.ballState(ballId, t)).not.toThrow();
      }
      expect(() => kinematics.handState(0, t)).not.toThrow();
      expect(() => kinematics.handState(1, t)).not.toThrow();
    }
  });

  it('holds the ball exactly where the hand is during a carry', () => {
    const carry = kinematics
      .carriesForHand(0)
      .find((c) => c.startBeat >= 2 && c.startBeat <= 10);
    expect(carry).toBeDefined();
    if (!carry) return;
    for (let f = 0.1; f < 1; f += 0.2) {
      const t = carry.startTime + f * (carry.endTime - carry.startTime);
      const ball = kinematics.ballState(carry.ballId, t).position;
      const hand = kinematics.handState(0, t).position;
      expect(vecDiff(ball, hand)).toBeLessThan(1e-9);
    }
  });

  it('flies with acceleration exactly (0, −g, 0) between events', () => {
    const flightSeg = kinematics
      .ballSegments(0)
      .find((s) => s.y.degree === 2); // the quadratic flight segment
    expect(flightSeg).toBeDefined();
    if (!flightSeg) return;
    const mid = 0.5 * (flightSeg.startTime + flightSeg.endTime);
    expect(evalSeg(flightSeg, mid).acceleration).toEqual(vec3(0, -G, 0));
  });
});

// --- Continuity at events (§4.4) — property tests ---------------------------

/** Argsort-derived permutation of [0..L-1] (mirrors the timeline test helper). */
function permutationFromKeys(keys: number[]): number[] {
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.index);
}

/** Arbitrary valid siteswap value array (collision-free, integer average). */
const validPatternArb = fc.integer({ min: 1, max: 5 }).chain((length) =>
  fc
    .record({
      keys: fc.array(fc.nat(), { minLength: length, maxLength: length }),
      extra: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: length, maxLength: length }),
    })
    .map(({ keys, extra }) => {
      const permutation = permutationFromKeys(keys);
      return permutation.map((target, index) => {
        const base = (((target - index) % length) + length) % length;
        return base + length * (extra[index] as number);
      });
    }),
);

/** Adjacent segment joints of a segment list, evaluated from both sides. */
function jointStates(segments: readonly PolySegment[]): { left: MotionState; right: MotionState }[] {
  const joints: { left: MotionState; right: MotionState }[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    const left = segments[i] as PolySegment;
    const right = segments[i + 1] as PolySegment;
    joints.push({ left: evalSeg(left, left.endTime), right: evalSeg(right, right.startTime) });
  }
  return joints;
}

/**
 * Valid siteswap arb with every held-2 throw lifted a full period higher
 * (value 2 → 2 + L). Adding a multiple of L preserves the landing permutation
 * (site = (i + value) mod L) and the integer average, so the pattern stays valid
 * but contains no `2`. Used for every hand count except n_h = 2, where held 2s
 * are the pending held-2 limitation (see the continuity property below).
 */
const validPatternArbNoTwos = validPatternArb.map((values) =>
  values.map((value) => (value === 2 ? value + values.length : value)),
);

describe('property: continuity at events (quintic path)', () => {
  it('position, velocity, and acceleration are continuous at every joint', () => {
    // Also vary the physical knobs: hold depth ∈ [0, 0.4], gravity ∈ [0.5, 30],
    // and hand count 1–8. Held 2s stay continuous only at n_h = 2, so exclude
    // value-2 throws everywhere else (held-2 at n_h≠2: pending design decision,
    // see BUILD_LOG Phase 2). At n_h ≥ 3 a held 2's carry ends in a different
    // hand than its rethrow (documented case); at n_h = 1 a held 2 overlaps the
    // single hand's next carry (both are the same held-2 limitation).
    const continuityCaseArb = fc
      .record({
        handCount: fc.integer({ min: 1, max: 8 }),
        holdDepth: fc.double({ min: 0, max: 0.4, noNaN: true }),
        gravity: fc.double({ min: 0.5, max: 30, noNaN: true }),
      })
      .chain((config) =>
        (config.handCount === 2 ? validPatternArb : validPatternArbNoTwos).map((values) => ({
          ...config,
          values,
        })),
      );
    fc.assert(
      fc.property(continuityCaseArb, ({ handCount, holdDepth, gravity, values }) => {
        const timeline = buildTimeline(values, {
          beatCount: 20,
          params: { ...DEFAULT_PARAMS, handCount },
        });
        const kinematics = buildKinematics(timeline, { values, handCount, gravity, holdDepth });
        const check = (segments: PolySegment[]): void => {
          for (const { left, right } of jointStates(segments)) {
            expect(vecDiff(left.position, right.position)).toBeLessThan(1e-10);
            expect(vecDiff(left.velocity, right.velocity)).toBeLessThan(1e-10);
            expect(vecDiff(left.acceleration, right.acceleration)).toBeLessThan(1e-9);
          }
        };
        for (const ballId of kinematics.ballIds()) {
          check(kinematics.ballSegments(ballId));
        }
        for (let hand = 0; hand < handCount; hand++) {
          check(kinematics.handSegments(hand));
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe('property: carry endpoints exert zero contact force (§4.3)', () => {
  it('carry acceleration equals (0, −g, 0) at catch and throw', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const timeline = buildTimeline(values, { beatCount: 20, params: DEFAULT_PARAMS });
        const kinematics = buildKinematics(timeline, { values, handCount: 2 });
        for (const carry of kinematics.allCarries()) {
          if (carry.startBeat < 0 || carry.startBeat > 14) continue;
          const first = carry.segments[0] as PolySegment;
          const last = carry.segments[carry.segments.length - 1] as PolySegment;
          const startAccel = evalSeg(first, first.startTime).acceleration;
          const endAccel = evalSeg(last, last.endTime).acceleration;
          // Contact force F = m·(a − g_vec) = a − (0, −g, 0); zero ⇔ a = (0, −g, 0).
          expect(vecDiff(startAccel, vec3(0, -G, 0))).toBeLessThan(1e-6);
          expect(vecDiff(endAccel, vec3(0, -G, 0))).toBeLessThan(1e-6);
        }
      }),
      { numRuns: 40 },
    );
  });
});

// --- Carry scoop shape: no waviness (§4.3) -----------------------------------

/**
 * Sample the hand height across a carry at a fine uniform step (test-only
 * sampling; core motion itself stays closed-form). Includes both endpoints.
 */
function sampleCarryHeights(kinematics: Kinematics, carry: CarryMotion, samples = 400): number[] {
  const heights: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = carry.startTime + (i / samples) * (carry.endTime - carry.startTime);
    heights.push(kinematics.handState(carry.hand, t).position.y);
  }
  return heights;
}

describe('carry scoop shape — one smooth dip, no waviness (§4.3)', () => {
  // Regression pin for the wavy-carry bug: the old construction imposed via
  // velocity = chord (vy = 0) AND via acceleration = (0, −g, 0) at the dip —
  // making the dip a local MAXIMUM of vertical motion — so every carry
  // double-dipped in a W shape, overshooting the dip line by ~10 mm (pattern 3
  // at defaults) up to ~630 mm (522's held carry). The scoop-and-hold
  // construction must keep the carry one smooth scoop:
  //   (a) the hand never drops below the dip line (dipY = midline − holdDepth),
  //   (b) descent into the dip and ascent out of it are monotone,
  //   (c) between first and last dip contact the hand STAYS at the dip (the
  //       level hold) — no mid-carry bump back up.
  // Scope: holdDepth ≥ 0.02. At holdDepth ≈ 0 a hand arriving with vertical
  // momentum cannot turn around ON the line itself; that degenerate fallback
  // keeps continuity and finiteness (asserted separately below), not shape.
  const patterns = ['3', '531', '423', '522', '441', '345'];
  const gravities = [0.5, G, 30];
  const holdDepths = [0.02, 0.1, 0.4];
  const dwellTimes = [0.05, 0.3, 0.45];

  it(
    'descends, holds at the dip, ascends — across patterns × g × holdDepth × dwell',
    () => {
      const monotoneTolerance = 1e-9;
      const dipTolerance = 1e-6;
      let carriesChecked = 0;
      const failures: string[] = [];
      for (const pattern of patterns) {
        const values = parse(pattern);
        for (const dwellTime of dwellTimes) {
          const timeline = buildTimeline(values, {
            beatCount: 20,
            params: { ...DEFAULT_PARAMS, dwellTime },
          });
          for (const gravity of gravities) {
            for (const holdDepth of holdDepths) {
              const kinematics = buildKinematics(timeline, {
                values,
                handCount: 2,
                gravity,
                holdDepth,
              });
              for (const carry of kinematics.allCarries()) {
                if (carry.startBeat < 2 || carry.startBeat > 14) continue;
                if (carry.endTime - carry.startTime <= 0) continue;
                const dipY = 0.5 * (carry.catchPoint.y + carry.throwPoint.y) - holdDepth;
                const heights = sampleCarryHeights(kinematics, carry);
                const label = `${pattern} g=${gravity} d=${holdDepth} t_d=${dwellTime} beat=${carry.startBeat}`;
                // (a) No overshoot below the dip line.
                let minY = Infinity;
                for (const y of heights) {
                  if (y < minY) minY = y;
                }
                if (minY < dipY - dipTolerance) {
                  failures.push(`${label}: overshoot below dip by ${(dipY - minY).toFixed(6)} m`);
                }
                // Dip contact range: first/last sample at the dip line (the
                // carry must actually reach its dip).
                let firstContact = -1;
                let lastContact = -1;
                for (let i = 0; i < heights.length; i++) {
                  if ((heights[i] as number) <= dipY + dipTolerance) {
                    if (firstContact < 0) firstContact = i;
                    lastContact = i;
                  }
                }
                if (firstContact < 0) {
                  failures.push(`${label}: never reaches its dip line`);
                  continue;
                }
                // (b) Monotone descent before the dip, monotone ascent after it.
                for (let i = 0; i < firstContact; i++) {
                  if ((heights[i + 1] as number) > (heights[i] as number) + monotoneTolerance) {
                    failures.push(`${label}: non-monotone descent at sample ${i}`);
                    break;
                  }
                }
                for (let i = lastContact; i + 1 < heights.length; i++) {
                  if ((heights[i + 1] as number) < (heights[i] as number) - monotoneTolerance) {
                    failures.push(`${label}: non-monotone ascent at sample ${i}`);
                    break;
                  }
                }
                // (c) No mid-carry bump: between contacts the hand stays at the dip.
                for (let i = firstContact; i <= lastContact; i++) {
                  if ((heights[i] as number) > dipY + dipTolerance) {
                    failures.push(
                      `${label}: mid-carry bump ${((heights[i] as number) - dipY).toFixed(6)} m above dip`,
                    );
                    break;
                  }
                }
                carriesChecked += 1;
              }
            }
          }
        }
      }
      expect(failures).toEqual([]);
      expect(carriesChecked).toBeGreaterThan(500);
    },
    120_000,
  );

  it('holdDepth = 0 degenerates safely: finite motion and continuous joints', () => {
    for (const pattern of ['3', '522']) {
      const values = parse(pattern);
      const timeline = buildTimeline(values, { beatCount: 20, params: DEFAULT_PARAMS });
      for (const gravity of [0.5, G, 30]) {
        const kinematics = buildKinematics(timeline, {
          values,
          handCount: 2,
          gravity,
          holdDepth: 0,
        });
        for (const ballId of kinematics.ballIds()) {
          for (const { left, right } of jointStates(kinematics.ballSegments(ballId))) {
            expect(Number.isFinite(left.position.y)).toBe(true);
            expect(Number.isFinite(right.position.y)).toBe(true);
            expect(vecDiff(left.position, right.position)).toBeLessThan(1e-10);
            expect(vecDiff(left.velocity, right.velocity)).toBeLessThan(1e-10);
            expect(vecDiff(left.acceleration, right.acceleration)).toBeLessThan(1e-9);
          }
        }
        for (let hand = 0; hand < 2; hand++) {
          for (const t of [0.3, 1.1, 2.4, 3.7, 4.6]) {
            const state = kinematics.handState(hand, t);
            expect(Number.isFinite(state.position.x)).toBe(true);
            expect(Number.isFinite(state.position.y)).toBe(true);
            expect(Number.isFinite(state.velocity.y)).toBe(true);
            expect(Number.isFinite(state.acceleration.y)).toBe(true);
          }
        }
      }
    }
  });
});

// --- Cubic comparison: acceleration jump (§4.3) -----------------------------

describe('cubicBezierCarryPath — exhibits the acceleration jump at events', () => {
  it('has discontinuous acceleration where the quintic is continuous', () => {
    const { kinematics: quintic } = kinematicsFor('531', 20);
    const { kinematics: cubic } = kinematicsFor('531', 20, { carryPath: cubicBezierCarryPath });

    const maxJoint = (kin: Kinematics): number => {
      let worst = 0;
      for (const ballId of kin.ballIds()) {
        for (const { left, right } of jointStates(kin.ballSegments(ballId))) {
          worst = Math.max(worst, vecDiff(left.acceleration, right.acceleration));
        }
      }
      return worst;
    };

    // The quintic keeps acceleration continuous; the cubic breaks it at events.
    expect(maxJoint(quintic)).toBeLessThan(1e-6);
    expect(maxJoint(cubic)).toBeGreaterThan(0.5);
    expect(cubic.carryPath.name).toBe('cubic-bezier');
  });
});

// --- Idle and held-forever degenerate cases (§4.3) --------------------------

describe('idle and held-forever hands', () => {
  it('rests a purely idle hand at its catch point (40, hand 1)', () => {
    const { kinematics } = kinematicsFor('40', 16);
    const catchPoint = kinematics.geometry.catchPoint(1);
    for (const t of [0.1, 1.0, 2.5]) {
      const state = kinematics.handState(1, t);
      expect(vecDiff(state.position, catchPoint)).toBeLessThan(1e-12);
      expect(state.velocity).toEqual(vec3(0, 0, 0));
    }
    expect(kinematics.staticHolds()).toEqual([]);
  });

  it('holds a ball forever without crashing (pattern 2)', () => {
    const { kinematics } = kinematicsFor('2', 12);
    const holds = kinematics.staticHolds();
    expect(holds).toHaveLength(2); // one ball per hand
    for (const hold of holds) {
      // The held ball rides the resting hand (both static, coincident).
      for (const t of [0.0, 1.7, 3.3]) {
        const hand = kinematics.handState(hold.hand, t);
        const ball = kinematics.ballState(hold.ballId, t);
        expect(vecDiff(hand.position, hold.position)).toBeLessThan(1e-12);
        expect(vecDiff(ball.position, hold.position)).toBeLessThan(1e-12);
        expect(ball.velocity).toEqual(vec3(0, 0, 0));
      }
    }
  });

  it('holds forever for the all-2 pattern 22 as well', () => {
    const { kinematics } = kinematicsFor('22', 12);
    expect(kinematics.staticHolds()).toHaveLength(2);
    expect(() => kinematics.handState(0, 5)).not.toThrow();
  });

  // --- Rendered-ball-count invariant: dynamic ids ∪ static holds == b ----------
  // A synthetic StaticHold is needed ONLY when a hand eternally holds a ball with
  // no dynamic delivery. Plain-periodic all-2 hands keep their holds (that is how
  // those balls render at all); a hand reached by a transition already renders its
  // ball dynamically and must NOT also get a hold (else it double-counts forever).

  it('plain periodic 2 / 42 / 24: rendered count == b with static holds present', () => {
    // 2: both hands held (no flights) → 2 holds, 0 dynamic, b = 2.
    const two = kinematicsFor('2', 12).kinematics;
    expect(two.staticHolds()).toHaveLength(2);
    expect(renderedBallIds(two)).toHaveLength(2);
    // 42: hand 1 held, the 4-orbit dynamic → 1 hold + 2 dynamic, b = 3.
    const fourTwo = kinematicsFor('42', 24).kinematics;
    expect(fourTwo.staticHolds().map((h) => h.hand)).toEqual([1]);
    expect(fourTwo.ballIds()).toHaveLength(2);
    expect(renderedBallIds(fourTwo)).toHaveLength(3);
    // 24: hand 0 held (the mirror) → 1 hold + 2 dynamic, b = 3.
    const twoFour = kinematicsFor('24', 24).kinematics;
    expect(twoFour.staticHolds().map((h) => h.hand)).toEqual([0]);
    expect(renderedBallIds(twoFour)).toHaveLength(3);
  });

  it('transition 3 -> 42 renders exactly b balls (settled ball is dynamic, no hold)', () => {
    const { kinematics, b, bridgeEndBeat, beatTime } = transitionKinematics('3', '42', 5, 12, 24);
    expect(b).toBe(3);
    // No synthetic hold: the ball that settled into hand 1 renders dynamically.
    expect(kinematics.staticHolds()).toEqual([]);
    const rendered = renderedBallIds(kinematics);
    expect(rendered).toHaveLength(b);

    // A few periods after the bridge completes (steady-state 42), sample several
    // instants: the rendered count stays b and no two balls share a position.
    for (let beat = bridgeEndBeat + 6; beat < bridgeEndBeat + 18; beat++) {
      const t = (beatTime(beat) + beatTime(beat + 1)) / 2;
      const positions = rendered.map((id) => kinematics.ballState(id, t).position);
      expect(positions).toHaveLength(b);
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          expect(vecDiff(positions[i] as Vec3, positions[j] as Vec3)).toBeGreaterThan(1e-6);
        }
      }
      // Exactly one rendered ball is truly at rest (the settled held ball); it
      // sits in hand 1 at its catch point (the reviewer's endorsed seam — the
      // dynamic ball renders resting where it caught, no separate hold ghost).
      const atRest = rendered.filter((id) => magnitude(kinematics.ballState(id, t).velocity) < 1e-9);
      expect(atRest).toHaveLength(1);
      const restPos = kinematics.ballState(atRest[0] as number, t).position;
      expect(vecDiff(restPos, kinematics.geometry.catchPoint(1))).toBeLessThan(1e-9);
    }
  });

  it('transition 31 -> 2 (b = 2) renders exactly b balls (both hands settle dynamically)', () => {
    const { kinematics, b, bridgeEndBeat, beatTime } = transitionKinematics('31', '2', 4, 10, 24);
    expect(b).toBe(2);
    // Target 2 makes BOTH hands all-2; both receive a settling flight, so both
    // synthetic holds are suppressed and the two dynamic balls stand in.
    expect(kinematics.staticHolds()).toEqual([]);
    for (let beat = bridgeEndBeat + 6; beat < bridgeEndBeat + 16; beat++) {
      const t = (beatTime(beat) + beatTime(beat + 1)) / 2;
      const rendered = renderedBallIds(kinematics);
      expect(rendered).toHaveLength(b);
      const atRest = rendered.filter((id) => magnitude(kinematics.ballState(id, t).velocity) < 1e-9);
      // Both balls are settled into their hands at steady state, at distinct spots.
      expect(atRest).toHaveLength(2);
      const p0 = kinematics.ballState(atRest[0] as number, t).position;
      const p1 = kinematics.ballState(atRest[1] as number, t).position;
      expect(vecDiff(p0, p1)).toBeGreaterThan(1e-6);
    }
  });

  it('returns a rest state for an unknown ball id', () => {
    const { kinematics } = kinematicsFor('3', 12);
    const state = kinematics.ballState(9999, 1.0);
    expect(state.position).toEqual(vec3(0, 0, 0));
    expect(state.velocity).toEqual(vec3(0, 0, 0));
  });
});

// --- Multi-beat held carry and multi-hand -----------------------------------

describe('held carries and multi-hand patterns', () => {
  it('holds a held 2 level at the dip through the carry (423)', () => {
    const { kinematics } = kinematicsFor('423', 18);
    const held = kinematics.allCarries().find((c) => c.held && c.startBeat >= 3 && c.startBeat <= 12);
    expect(held).toBeDefined();
    if (!held) return;
    // The hold dip reaches holdDepth below the catch–throw midline at mid-carry.
    const midTime = 0.5 * (held.startTime + held.endTime);
    const midY = kinematics.ballState(held.ballId, midTime).position.y;
    const lineMidY = 0.5 * (held.catchPoint.y + held.throwPoint.y);
    expect(midY).toBeCloseTo(lineMidY - kinematics.holdDepth, 9);
  });

  it('evaluates a 3-hand pattern with a circle geometry (531, n_h=3)', () => {
    const values = parse('531');
    const timeline = buildTimeline(values, {
      beatCount: 18,
      params: { ...DEFAULT_PARAMS, handCount: 3 },
    });
    const kinematics = buildKinematics(timeline, {
      values,
      handCount: 3,
      geometry: circleHandGeometry(3),
    });
    for (const ballId of kinematics.ballIds()) {
      for (const { left, right } of jointStates(kinematics.ballSegments(ballId))) {
        expect(vecDiff(left.position, right.position)).toBeLessThan(1e-7);
        expect(vecDiff(left.velocity, right.velocity)).toBeLessThan(1e-6);
      }
    }
  });
});

// --- Kinematics epochs: future-only edits (§4.6) — property + unit tests -------

describe('property: kinematics epoch immutability (future-only, §4.6)', () => {
  it('segments fully before an epoch are bit-identical; the ball path stays position-continuous across it', () => {
    // Mirror of the timeline's epoch-immutability property, on the geometric
    // layer: a gravity + hold-depth + geometry change at time T must leave every
    // segment that ends before T bit-identical, and must NOT break the BALL path's
    // position continuity anywhere (the carry after the epoch chains from the
    // arrival state of the flight before it). Held 2s stay continuous only at
    // n_h = 2, so exclude value-2 throws elsewhere (the same pending held-2 case).
    const caseArb = fc
      .record({
        handCount: fc.integer({ min: 1, max: 4 }),
        epochBeat: fc.integer({ min: 3, max: 12 }),
        gravityAfter: fc.double({ min: 0.5, max: 30, noNaN: true }),
        holdDepthAfter: fc.double({ min: 0, max: 0.4, noNaN: true }),
      })
      .chain((config) =>
        (config.handCount === 2 ? validPatternArb : validPatternArbNoTwos).map((values) => ({
          ...config,
          values,
        })),
      );
    fc.assert(
      fc.property(caseArb, ({ handCount, epochBeat, gravityAfter, holdDepthAfter, values }) => {
        const beatCount = 24;
        const timeline = buildTimeline(values, {
          beatCount,
          params: { ...DEFAULT_PARAMS, handCount },
        });
        const epochTime = timeline.beatTime(epochBeat);
        const baseGeometry = lineHandGeometry(handCount);
        // A visibly different geometry after the epoch (wider throws/catches).
        const geometryAfter = lineHandGeometry(handCount, { throwHalf: 0.18, catchHalf: 0.42 });

        const base = buildKinematics(timeline, {
          values,
          handCount,
          gravity: G,
          holdDepth: 0.1,
          geometry: baseGeometry,
        });
        const changed = buildKinematics(timeline, {
          values,
          handCount,
          gravity: G,
          holdDepth: 0.1,
          geometry: baseGeometry,
          epochs: [
            { time: epochTime, gravity: gravityAfter, holdDepth: holdDepthAfter, geometry: geometryAfter },
          ],
        });

        const eps = 1e-9;
        // 1a. Every flight thrown before the epoch is IMMUTABLE — an in-flight ball
        //     keeps the parabola it was aimed with, even if it lands after the
        //     epoch (a flight straddling the boundary is still bit-identical).
        for (const flight of timeline.flights) {
          if (flight.throwTime >= epochTime - eps || flight.value < 1) {
            continue;
          }
          const midTime = 0.5 * (flight.throwTime + flight.arrivalTime);
          expect(
            vecDiff(base.ballState(flight.ballId, midTime).position, changed.ballState(flight.ballId, midTime).position),
          ).toBe(0);
          expect(
            vecDiff(base.ballState(flight.ballId, midTime).velocity, changed.ballState(flight.ballId, midTime).velocity),
          ).toBe(0);
        }
        // 1b. Every carry that fully ENDS before the epoch is bit-identical. (A
        //     carry straddling the epoch legitimately adjusts its departing end —
        //     the next throw is a future event — so it is NOT asserted here.)
        for (const carry of timeline.carries) {
          if (carry.endTime > epochTime - eps || carry.endTime <= carry.startTime) {
            continue;
          }
          for (const f of [0.25, 0.5, 0.75]) {
            const t = carry.startTime + f * (carry.endTime - carry.startTime);
            expect(
              vecDiff(base.ballState(carry.ballId, t).position, changed.ballState(carry.ballId, t).position),
            ).toBe(0);
          }
        }

        // 2. The changed BALL path is position-continuous at every join, INCLUDING
        //    the parameter boundary (chaining through the flight→carry seam).
        for (const ballId of changed.ballIds()) {
          for (const { left, right } of jointStates(changed.ballSegments(ballId))) {
            expect(vecDiff(left.position, right.position)).toBeLessThan(1e-9);
          }
        }

        // 3. The epoch is not vacuous: a flight thrown strictly after it uses the
        //    new gravity (flight acceleration ≡ (0, −g_after, 0)).
        const postFlight = timeline.flights.find(
          (flight) =>
            flight.throwTime > epochTime + 1e-6 &&
            flight.throwBeat >= 0 &&
            flight.throwBeat < beatCount &&
            flight.value >= 3,
        );
        if (postFlight) {
          const midTime = 0.5 * (postFlight.throwTime + postFlight.arrivalTime);
          expect(changed.ballState(postFlight.ballId, midTime).acceleration.y).toBeCloseTo(
            -gravityAfter,
            6,
          );
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe('kinematics epoch — in-flight ball keeps its parabola (§4.6)', () => {
  it('a gravity change mid-flight leaves the airborne ball unchanged and chains the next carry', () => {
    const values = parse('3');
    const beatCount = 20;
    const timeline = buildTimeline(values, { beatCount, params: DEFAULT_PARAMS });
    const flight = timeline.flights.find((f) => f.throwBeat >= 4 && f.throwBeat < 8 && f.value === 3);
    expect(flight).toBeDefined();
    if (!flight) return;
    // Epoch placed mid-flight (between this throw and its catch).
    const epochTime = 0.5 * (flight.throwTime + flight.arrivalTime);
    const changed = buildKinematics(timeline, {
      values,
      handCount: 2,
      gravity: G,
      epochs: [{ time: epochTime, gravity: 2 }],
    });
    const baseline = buildKinematics(timeline, { values, handCount: 2, gravity: G });

    // The in-flight ball (thrown before the epoch) is bit-identical and still under
    // the OLD gravity — it keeps the parabola it was aimed with.
    for (const f of [0.1, 0.5, 0.9]) {
      const t = flight.throwTime + f * (flight.arrivalTime - flight.throwTime);
      expect(vecDiff(changed.ballState(flight.ballId, t).position, baseline.ballState(flight.ballId, t).position)).toBe(0);
      expect(changed.ballState(flight.ballId, t).acceleration).toEqual(vec3(0, -G, 0));
    }
    // The carry that receives it starts exactly at the flight's arrival position:
    // the ball path is position-continuous across the boundary.
    const beforeCatch = changed.ballState(flight.ballId, flight.arrivalTime - 1e-9).position;
    const afterCatch = changed.ballState(flight.ballId, flight.arrivalTime + 1e-9).position;
    expect(vecDiff(beforeCatch, afterCatch)).toBeLessThan(1e-6);

    // A throw made AFTER the epoch uses the new gravity.
    const later = timeline.flights.find(
      (f) => f.throwTime > epochTime && f.throwBeat < beatCount && f.value === 3,
    );
    expect(later).toBeDefined();
    if (!later) return;
    const midTime = 0.5 * (later.throwTime + later.arrivalTime);
    expect(changed.ballState(later.ballId, midTime).acceleration.y).toBeCloseTo(-2, 6);
  });
});

describe('kinematics epoch — moving a catch point affects only later throws (§4.6)', () => {
  it('flights thrown before the geometry epoch land at the OLD catch point, after at the NEW', () => {
    const values = parse('3');
    const beatCount = 20;
    const timeline = buildTimeline(values, { beatCount, params: DEFAULT_PARAMS });
    const baseGeometry = lineHandGeometry(2); // hand 0 catch at (−0.3, 1, 0)
    const oldCatch = baseGeometry.catchPoint(0);
    const newCatch = vec3(-0.5, 1, 0.2); // move hand 0's catch point
    const movedGeometry = makeHandGeometry(
      [baseGeometry.throwPoint(0), baseGeometry.throwPoint(1)],
      [newCatch, baseGeometry.catchPoint(1)],
    );
    const epochTime = timeline.beatTime(8);
    const kinematics = buildKinematics(timeline, {
      values,
      handCount: 2,
      gravity: G,
      geometry: baseGeometry,
      epochs: [{ time: epochTime, geometry: movedGeometry }],
    });

    // Balls landing in hand 0 (landingHand === 0). Thrown before vs after the epoch.
    const before = timeline.flights.find(
      (f) => f.landingHand === 0 && f.throwBeat >= 2 && f.throwTime < epochTime,
    );
    const after = timeline.flights.find(
      (f) => f.landingHand === 0 && f.throwTime > epochTime && f.throwBeat < 18,
    );
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (!before || !after) return;

    const posBefore = kinematics.ballState(before.ballId, before.arrivalTime - 1e-9).position;
    const posAfter = kinematics.ballState(after.ballId, after.arrivalTime - 1e-9).position;
    expect(vecDiff(posBefore, oldCatch)).toBeLessThan(1e-6); // aimed with old geometry
    expect(vecDiff(posAfter, newCatch)).toBeLessThan(1e-6); // aimed with new geometry
  });
});

describe('kinematics epochs — no epochs is bit-identical to base params', () => {
  it('an empty epoch list produces the same ball states as passing no epochs', () => {
    const values = parse('531');
    const timeline = buildTimeline(values, { beatCount: 20, params: DEFAULT_PARAMS });
    const withoutEpochs = buildKinematics(timeline, { values, handCount: 2, gravity: G });
    const emptyEpochs: KinematicsEpoch[] = [];
    const withEmpty = buildKinematics(timeline, {
      values,
      handCount: 2,
      gravity: G,
      epochs: emptyEpochs,
    });
    for (const ballId of withoutEpochs.ballIds()) {
      for (const t of [0.3, 1.1, 2.4, 3.7]) {
        expect(
          vecDiff(withoutEpochs.ballState(ballId, t).position, withEmpty.ballState(ballId, t).position),
        ).toBe(0);
      }
    }
  });
});

/** Evaluate a segment's motion at global time `t`. */
function evalSeg(segment: PolySegment, t: number): MotionState {
  return evaluateSegment(segment, t);
}
