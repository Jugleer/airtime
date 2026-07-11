import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BALL_PALETTE } from '../state/ballColors';
import {
  buildHandTiltKeyframes,
  catchCupQuaternion,
  cupQuaternionFromNormal,
  evaluateHandTilt,
  HAND_CUP_RADIUS_FACTOR,
  HAND_PATH_MAX_PERIOD_BEATS,
  HAND_PATH_PALETTE,
  HAND_PATH_SAMPLES_PER_BEAT,
  type HandTiltKeyframes,
  handCupRadius,
  handPathColor,
  handPathPeriodBeats,
  handPathPointCount,
  handPathStartBeat,
  maxHandPathPoints,
  type Quat,
  slerpEased,
  throwCupQuaternion,
  UPRIGHT_QUAT,
} from './hands';

// --- Cup-tilt test helpers ---------------------------------------------------

/** Rotate the cup opening axis +y by quaternion q (the cup normal it produces). */
function rotatedOpeningAxis(q: Quat): [number, number, number] {
  const { x, y, z, w } = q;
  return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
}

/** Unit-norm check for a quaternion. */
function quatNorm(q: Quat): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

function normalize3(vx: number, vy: number, vz: number): [number, number, number] {
  const len = Math.hypot(vx, vy, vz);
  return [vx / len, vy / len, vz / len];
}

describe('handCupRadius', () => {
  it('scales the ball radius by the cup factor (~1.6–2×)', () => {
    expect(handCupRadius(0.035)).toBeCloseTo(0.035 * HAND_CUP_RADIUS_FACTOR, 12);
    expect(HAND_CUP_RADIUS_FACTOR).toBeGreaterThanOrEqual(1.6);
    expect(HAND_CUP_RADIUS_FACTOR).toBeLessThanOrEqual(2);
  });
});

describe('handPathPeriodBeats', () => {
  it('is 0 for a non-positive period (nothing to draw)', () => {
    expect(handPathPeriodBeats(0)).toBe(0);
    expect(handPathPeriodBeats(-3)).toBe(0);
  });

  it('rounds the spatial period to whole beats', () => {
    expect(handPathPeriodBeats(2)).toBe(2);
    expect(handPathPeriodBeats(6)).toBe(6);
  });

  it('caps very long periods at the sampling maximum', () => {
    expect(handPathPeriodBeats(1000)).toBe(HAND_PATH_MAX_PERIOD_BEATS);
  });
});

describe('handPathPointCount', () => {
  it('is 0 for no period', () => {
    expect(handPathPointCount(0)).toBe(0);
  });

  it('is ~samplesPerBeat per beat plus a closing point', () => {
    // 2 beats ⇒ 2·20 + 1 = 41 points (last sample closes the loop on the first).
    expect(handPathPointCount(2)).toBe(2 * HAND_PATH_SAMPLES_PER_BEAT + 1);
  });

  it('never exceeds the preallocated buffer capacity', () => {
    const cap = maxHandPathPoints();
    for (const period of [1, 2, 6, 12, HAND_PATH_MAX_PERIOD_BEATS, 1000]) {
      expect(handPathPointCount(period)).toBeLessThanOrEqual(cap);
      expect(handPathPointCount(period)).toBeGreaterThanOrEqual(2);
    }
  });

  it('maxHandPathPoints covers the longest sampled loop', () => {
    expect(maxHandPathPoints()).toBe(HAND_PATH_SAMPLES_PER_BEAT * HAND_PATH_MAX_PERIOD_BEATS + 1);
  });
});

describe('handPathStartBeat', () => {
  it('anchors one full period in when there is no kinematics epoch (skip startup)', () => {
    expect(handPathStartBeat(2, 160, -1)).toBe(2);
    expect(handPathStartBeat(6, 160, -1)).toBe(6);
  });

  it('anchors at the latest kinematics-epoch beat so param edits are reflected', () => {
    expect(handPathStartBeat(2, 160, 40)).toBe(40);
  });

  it('clamps the window so the whole loop stays inside the generated horizon', () => {
    // Epoch near the end: start pulls back so start + period ≤ beatCount.
    expect(handPathStartBeat(6, 100, 98)).toBe(94);
    expect(handPathStartBeat(6, 100, 98) + 6).toBeLessThanOrEqual(100);
  });

  it('is 0 for a degenerate period or empty horizon', () => {
    expect(handPathStartBeat(0, 160, 10)).toBe(0);
    expect(handPathStartBeat(2, 0, 10)).toBe(0);
  });
});

describe('handPathColor', () => {
  it('wraps by palette length and is total for any integer', () => {
    for (let hand = 0; hand < HAND_PATH_PALETTE.length; hand++) {
      expect(handPathColor(hand)).toBe(HAND_PATH_PALETTE[hand]);
    }
    expect(handPathColor(HAND_PATH_PALETTE.length)).toBe(HAND_PATH_PALETTE[0]);
    expect(handPathColor(-1)).toBe(HAND_PATH_PALETTE[HAND_PATH_PALETTE.length - 1]);
  });

  it('uses hues distinct from the per-ball palette (guide lines, not balls)', () => {
    const ballHues = new Set(BALL_PALETTE.map((c) => c.toLowerCase()));
    for (const hue of HAND_PATH_PALETTE) {
      expect(ballHues.has(hue.toLowerCase())).toBe(false);
    }
  });
});

describe('HAND_PATH_SAMPLES_PER_BEAT (overlay resolution, ITEM 2)', () => {
  it('is raised to 80/beat so the sharp scoop flanks are traced (< ~2 mm)', () => {
    // 20/beat cut the ~0.08 s scoop by up to ~15 mm at a corner; 80/beat → ~1.8 mm.
    expect(HAND_PATH_SAMPLES_PER_BEAT).toBe(80);
    // Uniform sampling: the longest loop stays inside the preallocated buffer.
    expect(maxHandPathPoints()).toBe(80 * HAND_PATH_MAX_PERIOD_BEATS + 1);
  });
});

describe('cupQuaternionFromNormal (cup tilt math, ITEM 3)', () => {
  const out: Quat = { x: 0, y: 0, z: 0, w: 1 };

  it('is upright (identity) for a straight-up throw (normal +y)', () => {
    // Release velocity straight up → cup normal +y → opening faces up (upright).
    throwCupQuaternion(0, 4.2, 0, out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(0, 12);
    expect(Math.abs(out.w)).toBeCloseTo(1, 12);
    // And the opening axis really is +y.
    const [nx, ny, nz] = rotatedOpeningAxis(out);
    expect(nx).toBeCloseTo(0, 9);
    expect(ny).toBeCloseTo(1, 9);
    expect(nz).toBeCloseTo(0, 9);
  });

  it('rotates the opening onto +v̂ for an angled zip throw', () => {
    // A fast, mostly-horizontal release (a value-1 zip): cup normal = +release v̂.
    const v: [number, number, number] = [3.5, 1.2, -0.8];
    throwCupQuaternion(v[0], v[1], v[2], out);
    expect(quatNorm(out)).toBeCloseTo(1, 9);
    const [nx, ny, nz] = rotatedOpeningAxis(out);
    const [ex, ey, ez] = normalize3(v[0], v[1], v[2]);
    expect(nx).toBeCloseTo(ex, 9);
    expect(ny).toBeCloseTo(ey, 9);
    expect(nz).toBeCloseTo(ez, 9);
  });

  it('faces the incoming ball for a near-vertical catch (−arrival v̂)', () => {
    // Ball arrives almost straight down with a tiny sideways drift: the cup opens
    // up-and-slightly-toward it, no NaN despite the near-vertical direction.
    const arrival: [number, number, number] = [0.02, -5.4, -0.01];
    catchCupQuaternion(arrival[0], arrival[1], arrival[2], out);
    expect(quatNorm(out)).toBeCloseTo(1, 9);
    const [nx, ny, nz] = rotatedOpeningAxis(out);
    const [ex, ey, ez] = normalize3(-arrival[0], -arrival[1], -arrival[2]);
    expect(nx).toBeCloseTo(ex, 9);
    expect(ny).toBeCloseTo(ey, 9);
    expect(nz).toBeCloseTo(ez, 9);
  });

  it('handles the exactly-antiparallel (−y) direction with a stable 180° (no NaN)', () => {
    // Throwing straight DOWN (or catching a ball rising straight up) → normal −y:
    // the half-way construction degenerates, so a stable +x axis is used.
    cupQuaternionFromNormal(0, -1, 0, out);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(quatNorm(out)).toBeCloseTo(1, 12);
    const [nx, ny, nz] = rotatedOpeningAxis(out);
    expect(nx).toBeCloseTo(0, 9);
    expect(ny).toBeCloseTo(-1, 9);
    expect(nz).toBeCloseTo(0, 9);
  });

  it('falls back to upright for a near-zero velocity', () => {
    cupQuaternionFromNormal(1e-12, -1e-12, 0, out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
    expect(out.w).toBe(1);
  });

  it('never produces a NaN and always a unit quaternion (random velocities)', () => {
    const out2: Quat = { x: 0, y: 0, z: 0, w: 1 };
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (vx, vy, vz) => {
          cupQuaternionFromNormal(vx, vy, vz, out2);
          expect(Number.isFinite(out2.x)).toBe(true);
          expect(Number.isFinite(out2.y)).toBe(true);
          expect(Number.isFinite(out2.z)).toBe(true);
          expect(Number.isFinite(out2.w)).toBe(true);
          expect(quatNorm(out2)).toBeCloseTo(1, 9);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('slerpEased (smoothstep-eased quaternion blend, ITEM 3)', () => {
  const a: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const b: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const out: Quat = { x: 0, y: 0, z: 0, w: 1 };

  it('returns exactly the endpoints at u = 0 and u = 1', () => {
    throwCupQuaternion(1, 0.3, 0.2, a); // some tilted orientation
    catchCupQuaternion(0.1, -4, 0.05, b); // another
    slerpEased(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, 0, out);
    expect(out.x).toBeCloseTo(a.x, 9);
    expect(out.w).toBeCloseTo(a.w, 9);
    slerpEased(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, 1, out);
    expect(out.x).toBeCloseTo(b.x, 9);
    expect(out.w).toBeCloseTo(b.w, 9);
  });

  it('has zero angular velocity at the endpoints (C1 — no snapping)', () => {
    throwCupQuaternion(2, 1, -0.5, a);
    catchCupQuaternion(-0.3, -3, 1, b);
    const q0: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const qh: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const qMid1: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const qMid2: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const h = 1e-4;
    // Finite-difference "speed" at u = 0 vs at mid-segment.
    slerpEased(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, 0, q0);
    slerpEased(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, h, qh);
    slerpEased(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, 0.5, qMid1);
    slerpEased(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, 0.5 + h, qMid2);
    const speedAt0 = Math.hypot(qh.x - q0.x, qh.y - q0.y, qh.z - q0.z, qh.w - q0.w) / h;
    const speedAtMid = Math.hypot(
      qMid2.x - qMid1.x,
      qMid2.y - qMid1.y,
      qMid2.z - qMid1.z,
      qMid2.w - qMid1.w,
    ) / h;
    expect(speedAt0).toBeLessThan(1e-2); // ~0 at the keyframe (smoothstep)
    expect(speedAtMid).toBeGreaterThan(0.1); // moving through the middle
  });
});

describe('buildHandTiltKeyframes / evaluateHandTilt (ITEM 3)', () => {
  // Two carries separated by an empty-hand return (a gap): catch → throw, return,
  // catch → throw. startVelocity/endVelocity mimic core CarryMotion endpoints.
  const carries = [
    {
      startTime: 1.0,
      endTime: 1.2,
      startVelocity: { x: 0.3, y: -4, z: 0 }, // arrival (falling)
      endVelocity: { x: -0.2, y: 4.1, z: 0 }, // release (rising)
    },
    {
      startTime: 1.6,
      endTime: 1.8,
      startVelocity: { x: -0.3, y: -4.2, z: 0 },
      endVelocity: { x: 0.25, y: 4, z: 0 },
    },
  ];

  it('lands catch/throw/upright keyframes at the right times, strictly increasing', () => {
    const kf = buildHandTiltKeyframes(carries);
    // catch1, throw1, upright(return mid), catch2, throw2 = 5 keyframes.
    expect(kf.count).toBe(5);
    for (let i = 1; i < kf.count; i++) {
      expect(kf.times[i]).toBeGreaterThan(kf.times[i - 1] as number);
    }
    expect(kf.times[2]).toBeCloseTo(0.5 * (1.2 + 1.6), 12); // return midpoint
  });

  it('evaluates to the catch normal at a catch and the throw normal at a throw', () => {
    const kf = buildHandTiltKeyframes(carries);
    const out: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const expectNormal = (t: number, dir: [number, number, number]): void => {
      evaluateHandTilt(kf, t, out);
      const [nx, ny, nz] = rotatedOpeningAxis(out);
      const [ex, ey, ez] = normalize3(dir[0], dir[1], dir[2]);
      expect(nx).toBeCloseTo(ex, 6);
      expect(ny).toBeCloseTo(ey, 6);
      expect(nz).toBeCloseTo(ez, 6);
    };
    // At the catch, opening faces −arrival velocity; at the throw, +release velocity.
    expectNormal(1.0, [-0.3, 4, 0]);
    expectNormal(1.2, [-0.2, 4.1, 0]);
    // At the return midpoint the cup is upright (+y).
    evaluateHandTilt(kf, 0.5 * (1.2 + 1.6), out);
    const [, my] = rotatedOpeningAxis(out);
    expect(my).toBeCloseTo(1, 6);
  });

  it('is continuous through a keyframe (C0) and eases (C1) — no snap', () => {
    const kf = buildHandTiltKeyframes(carries);
    const before: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const at: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const after: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const tk = 1.2; // the throw1 keyframe
    const h = 1e-4;
    evaluateHandTilt(kf, tk - h, before);
    evaluateHandTilt(kf, tk, at);
    evaluateHandTilt(kf, tk + h, after);
    // C0: both sides converge on the keyframe orientation.
    expect(Math.hypot(before.x - at.x, before.y - at.y, before.z - at.z, before.w - at.w)).toBeLessThan(1e-3);
    expect(Math.hypot(after.x - at.x, after.y - at.y, after.z - at.z, after.w - at.w)).toBeLessThan(1e-3);
  });

  it('is upright everywhere for a hand with no carries (static hold)', () => {
    const kf: HandTiltKeyframes = buildHandTiltKeyframes([]);
    const out: Quat = { x: 0, y: 0, z: 0, w: 1 };
    evaluateHandTilt(kf, 3.14, out);
    expect(out.x).toBe(UPRIGHT_QUAT.x);
    expect(out.w).toBe(UPRIGHT_QUAT.w);
  });
});
