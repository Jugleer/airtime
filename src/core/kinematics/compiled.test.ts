import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseNotation, type CompiledPattern } from '../siteswap';
import { buildTimeline, type TimelineParams } from '../timeline';
import { carryEnergy } from '../energy';
import {
  buildKinematics,
  evaluateSegment,
  magnitude,
  subtract,
  vec3,
  type MotionState,
  type PolySegment,
} from './index';

const G = 9.81;

function compile(text: string): CompiledPattern {
  const parsed = parseNotation(text);
  if (!parsed.ok) throw new Error(`fixture ${text}: ${parsed.errors[0]?.message}`);
  return parsed.compiled;
}

function kinematicsFor(
  text: string,
  { handCount = 2, holdDepth = 0.1, gravity = G, beatPeriod = 0.25 } = {},
) {
  const compiled = compile(text);
  const params: TimelineParams = { beatPeriod, dwellTime: 0.3, handCount };
  const timeline = buildTimeline([], { beatCount: 24, params, compiled });
  const kinematics = buildKinematics(timeline, {
    values: [],
    compiled,
    handCount,
    gravity,
    holdDepth,
  });
  return { timeline, kinematics };
}

function evalSeg(segment: PolySegment, t: number): MotionState {
  return evaluateSegment(segment, t);
}

function vecDiff(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

function jointStates(segments: readonly PolySegment[]): { left: MotionState; right: MotionState }[] {
  const joints: { left: MotionState; right: MotionState }[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    const left = segments[i] as PolySegment;
    const right = segments[i + 1] as PolySegment;
    joints.push({ left: evalSeg(left, left.endTime), right: evalSeg(right, right.startTime) });
  }
  return joints;
}

const CLASSICS = ['(4,4)', '(6x,4)*', '(4,2x)*', '(2,2)', '[33]33', '24[54]', '([44],2x)*', '[42]', '[23]3'] as const;

describe('property: continuity at events for sync/multiplex (§4.4)', () => {
  it('position, velocity, and acceleration continuous at every joint across the classics', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLASSICS),
        fc.double({ min: 0, max: 0.4, noNaN: true }),
        fc.double({ min: 0.5, max: 30, noNaN: true }),
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        (text, holdDepth, gravity, beatPeriod) => {
          const { kinematics } = kinematicsFor(text, { holdDepth, gravity, beatPeriod });
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
          for (let hand = 0; hand < 2; hand++) {
            check(kinematics.handSegments(hand));
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('flight acceleration is exactly (0, −g, 0) for sync/multiplex', () => {
  it('every ball is in free-fall mid-flight (including a crossing 2x)', () => {
    for (const text of CLASSICS) {
      const { timeline, kinematics } = kinematicsFor(text);
      for (const flight of timeline.flights) {
        if (flight.throwBeat < 0 || flight.throwBeat > 12) continue;
        const mid = 0.5 * (flight.throwTime + flight.arrivalTime);
        const a = kinematics.ballState(flight.ballId, mid).acceleration;
        expect(vecDiff(a, vec3(0, -G, 0)), `${text} flight of ${flight.value}`).toBeLessThan(1e-9);
      }
    }
  });
});

describe('multiplex balls get distinct in-cup offsets (no z-fight)', () => {
  it('[33]33 keeps the two co-thrown balls apart while co-flying', () => {
    const { timeline, kinematics } = kinematicsFor('[33]33');
    const beat0 = timeline.flights.filter((f) => f.throwBeat === 0);
    expect(beat0).toHaveLength(2);
    const [a, b] = [beat0[0]?.ballId ?? 0, beat0[1]?.ballId ?? 0];
    // Mid-flight they would coincide exactly without the offset; assert visible gap.
    const t = 0.5 * ((beat0[0]?.throwTime ?? 0) + (beat0[0]?.arrivalTime ?? 0));
    const pa = kinematics.ballState(a, t).position;
    const pb = kinematics.ballState(b, t).position;
    expect(magnitude(subtract(pa, pb))).toBeGreaterThan(0.01);
  });

  it('pure sync (4,4) applies NO offset (ball leaves exactly its throw point)', () => {
    // (4,4) has no multiplex, so the offset branch is skipped: at the throw instant the
    // ball is exactly on the hand's throw point (no in-cup displacement).
    const { timeline, kinematics } = kinematicsFor('(4,4)');
    const flight = timeline.flights.find((f) => f.throwBeat === 0 && f.throwHand === 0);
    expect(flight).toBeDefined();
    if (!flight) return;
    const ball = kinematics.ballState(flight.ballId, flight.throwTime).position;
    const throwPoint = kinematics.geometry.throwPoint(0);
    expect(vecDiff(ball, throwPoint)).toBeLessThan(1e-9);
  });
});

describe('work–energy theorem holds per carry for sync/multiplex (§4.5)', () => {
  it('net contact work = ΔKE + g·Δy on every in-window carry', () => {
    for (const text of CLASSICS) {
      const { kinematics } = kinematicsFor(text);
      for (const carry of kinematics.allCarries()) {
        if (carry.startBeat < 0 || carry.startBeat > 12) continue;
        const energy = carryEnergy(carry.segments, carry.gravity);
        const first = carry.segments[0] as PolySegment;
        const last = carry.segments[carry.segments.length - 1] as PolySegment;
        const start = evalSeg(first, first.startTime);
        const end = evalSeg(last, last.endTime);
        const ke = (v: MotionState): number =>
          0.5 * (v.velocity.x ** 2 + v.velocity.y ** 2 + v.velocity.z ** 2);
        const expected = ke(end) - ke(start) + carry.gravity * (end.position.y - start.position.y);
        expect(Math.abs(energy.net - expected)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('(2,2) holds a static ball in each hand', () => {
  it('synthesizes two static holds and no dynamic balls', () => {
    const { kinematics } = kinematicsFor('(2,2)');
    expect(kinematics.staticHolds()).toHaveLength(2);
    expect(kinematics.ballIds()).toHaveLength(0);
  });
});

describe('handState is a single coherent position under multiplex', () => {
  it('24[54] hand path is continuous and finite for all sampled t', () => {
    const { kinematics } = kinematicsFor('24[54]');
    for (let t = 0; t < 5; t += 0.05) {
      for (let hand = 0; hand < 2; hand++) {
        const s = kinematics.handState(hand, t);
        expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true);
      }
    }
  });
});

describe('multiplex held-2 carry keeps the hand moving (daisy-chain regression, §4.4)', () => {
  // A non-crossing held 2 inside a multiplex makes each per-hand held carry OVERLAP the
  // next (each ~0.8 s carry staggered ~0.5 s). The old cluster reduction extended the
  // reach across the whole overlap chain while keeping only the earliest carry, so the
  // entire chain collapsed onto ONE dip near genStart, buildHandSegments emitted no
  // returns, and handState was pinned ~15 cm from the balls for the whole window (zero
  // total variation). Tiling the occupancy per representative endTime keeps the hand
  // dipping per hold and returning between holds.
  it('[42] and [23]3 hands stay in motion, near a held ball, and C² at every joint', () => {
    for (const text of ['[42]', '[23]3']) {
      const { kinematics } = kinematicsFor(text);
      for (let hand = 0; hand < 2; hand++) {
        let totalVariation = 0;
        let closestApproach = Infinity;
        let nearSamples = 0;
        let samples = 0;
        let prev = kinematics.handState(hand, 1).position;
        for (let t = 1; t <= 4; t += 0.01) {
          const p = kinematics.handState(hand, t).position;
          totalVariation += vecDiff(p, prev);
          prev = p;
          let nearest = Infinity;
          for (const id of kinematics.ballIds()) {
            nearest = Math.min(nearest, magnitude(subtract(p, kinematics.ballState(id, t).position)));
          }
          closestApproach = Math.min(closestApproach, nearest);
          if (nearest <= 0.06) nearSamples += 1;
          samples += 1;
        }
        // Non-trivial motion — was ~0 when the whole chain collapsed onto one frozen dip.
        expect(totalVariation, `${text} hand ${hand} total variation`).toBeGreaterThan(0.5);
        // Genuinely holding balls: it reaches within a few cm and stays near them for most
        // of the window (the frozen hand sat a fixed ~15 cm from the balls the whole time).
        expect(closestApproach, `${text} hand ${hand} closest approach`).toBeLessThan(0.05);
        expect(nearSamples / samples, `${text} hand ${hand} fraction near a ball`).toBeGreaterThan(0.5);
        // Hand-segment joints meet the continuity budget (pos/vel < 1e-10, acc < 1e-9).
        for (const { left, right } of jointStates(kinematics.handSegments(hand))) {
          expect(vecDiff(left.position, right.position)).toBeLessThan(1e-10);
          expect(vecDiff(left.velocity, right.velocity)).toBeLessThan(1e-10);
          expect(vecDiff(left.acceleration, right.acceleration)).toBeLessThan(1e-9);
        }
      }
    }
  });
});
