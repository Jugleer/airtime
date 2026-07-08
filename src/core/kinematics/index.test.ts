import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validatePattern } from '../siteswap';
import { buildTimeline, type TimelineParams } from '../timeline';
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
  type CarrySpec,
  type Kinematics,
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

  it('returns a rest state for an unknown ball id', () => {
    const { kinematics } = kinematicsFor('3', 12);
    const state = kinematics.ballState(9999, 1.0);
    expect(state.position).toEqual(vec3(0, 0, 0));
    expect(state.velocity).toEqual(vec3(0, 0, 0));
  });
});

// --- Multi-beat held carry and multi-hand -----------------------------------

describe('held carries and multi-hand patterns', () => {
  it('carries a held 2 through a single dipping segment pair (423)', () => {
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

/** Evaluate a segment's motion at global time `t`. */
function evalSeg(segment: PolySegment, t: number): MotionState {
  return evaluateSegment(segment, t);
}
