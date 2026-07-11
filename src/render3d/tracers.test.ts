import { describe, expect, it } from 'vitest';
import { buildKinematics, type Kinematics } from '../core/kinematics';
import { buildTimeline } from '../core/timeline';
import { BEAT_PERIOD_MIN, TRAIL_LENGTH_MAX } from '../state';
import {
  BOUNDARY_HEADROOM,
  buildSampleTimes,
  GHOST_SPAN_SECONDS,
  ghostBufferCapacity,
  maxGhostPoints,
  maxTrailPoints,
  sampleTimeAt,
  segmentBoundaryTimes,
  TRAIL_SAMPLE_DT,
  trailBufferCapacity,
  trailPointCount,
} from './tracers';

// A real core build (no three.js) for the boundary-anchored sampling regressions.
function buildK(
  values: number[],
  opts: { beatPeriod: number; dwellTime: number; handCount: number; beatCount: number },
): Kinematics {
  const { beatPeriod, dwellTime, handCount, beatCount } = opts;
  const timeline = buildTimeline(values, {
    beatCount,
    params: { beatPeriod, dwellTime, handCount },
  });
  return buildKinematics(timeline, { values, handCount });
}

/** Sample the ball's y over the trail window and report min y (the captured dip). */
function capturedDip(
  k: Kinematics,
  ballId: number,
  boundaries: readonly number[],
  windowStart: number,
  windowEnd: number,
  lo: number,
  hi: number,
  out: Float64Array,
): { count: number; times: number[]; dip: number } {
  const count = buildSampleTimes(windowStart, windowEnd, TRAIL_SAMPLE_DT, boundaries, out);
  const times: number[] = [];
  let dip = Infinity;
  for (let i = 0; i < count; i++) {
    const t = out[i] as number;
    if (t >= lo - 1e-12 && t <= hi + 1e-12) {
      times.push(t);
      dip = Math.min(dip, k.ballState(ballId, t).position.y);
    }
  }
  return { count, times, dip };
}

describe('trailPointCount', () => {
  it('is 0 for a non-positive span (nothing to draw)', () => {
    expect(trailPointCount(0, TRAIL_SAMPLE_DT, 1000)).toBe(0);
    expect(trailPointCount(-1, TRAIL_SAMPLE_DT, 1000)).toBe(0);
  });

  it('is at least 2 for any positive span (a polyline needs two ends)', () => {
    expect(trailPointCount(0.001, TRAIL_SAMPLE_DT, 1000)).toBe(2);
  });

  it('spaces points about dt apart', () => {
    // 1.2 s at 12 ms ⇒ floor(100)+1 = 101 points.
    expect(trailPointCount(1.2, 0.012, 1000)).toBe(101);
  });

  it('caps at the buffer capacity', () => {
    expect(trailPointCount(100, 0.012, 50)).toBe(50);
  });
});

describe('sampleTimeAt', () => {
  it('pins the endpoints exactly (first = start, last = end)', () => {
    const start = 2;
    const end = 5;
    const count = 7;
    expect(sampleTimeAt(0, count, start, end)).toBeCloseTo(start, 12);
    expect(sampleTimeAt(count - 1, count, start, end)).toBeCloseTo(end, 12);
  });

  it('spaces samples uniformly across the span', () => {
    const count = 5; // spans divided into 4 equal steps
    const times = Array.from({ length: count }, (_, i) => sampleTimeAt(i, count, 0, 4));
    expect(times).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns end for a degenerate single-point count', () => {
    expect(sampleTimeAt(0, 1, 3, 9)).toBe(9);
  });
});

describe('buffer capacities', () => {
  it('maxTrailPoints sizes for the longest trail', () => {
    // The longest trail is now 2 s (owner 2026-07-11, was 8 s): 2 s at 12 ms ⇒
    // floor(166.6)+1 = 167.
    expect(maxTrailPoints(2, 0.012)).toBe(167);
  });

  it('maxGhostPoints covers the fixed ghost span', () => {
    expect(maxGhostPoints(0.012)).toBe(Math.floor(GHOST_SPAN_SECONDS / 0.012) + 1);
  });

  it('every trail point count stays within the buffer', () => {
    // Cap follows the real max trail (2 s); spans past it (3, 8) exercise the clamp.
    const cap = maxTrailPoints(TRAIL_LENGTH_MAX, TRAIL_SAMPLE_DT);
    for (const span of [0.1, 0.8, 3, 8]) {
      expect(trailPointCount(span, TRAIL_SAMPLE_DT, cap)).toBeLessThanOrEqual(cap);
    }
  });
});

describe('segmentBoundaryTimes', () => {
  it('is empty for no segments', () => {
    expect(segmentBoundaryTimes([])).toEqual([]);
  });

  it('is the sorted, deduped set of segment start/end times', () => {
    const segs = [
      { startTime: 0, endTime: 0.2 },
      { startTime: 0.2, endTime: 0.5 }, // shared join deduped
      { startTime: 0.5, endTime: 0.9 },
    ];
    expect(segmentBoundaryTimes(segs)).toEqual([0, 0.2, 0.5, 0.9]);
  });
});

describe('buildSampleTimes (boundary-anchored, ITEM 1)', () => {
  it('pins both endpoints exactly and stays sorted + deduped', () => {
    const out = new Float64Array(64);
    const boundaries = [0.311, 0.517];
    const count = buildSampleTimes(0.3, 0.55, TRAIL_SAMPLE_DT, boundaries, out);
    expect(out[0]).toBe(0.3);
    expect(out[count - 1]).toBe(0.55);
    for (let i = 1; i < count; i++) {
      expect(out[i]).toBeGreaterThan(out[i - 1] as number);
    }
    // Both interior boundaries appear as samples.
    for (const b of boundaries) {
      expect(Array.from(out.subarray(0, count)).some((t) => Math.abs(t - b) < 1e-9)).toBe(true);
    }
  });

  it('places the absolute-anchored interior grid (m·dt), independent of the window', () => {
    const out = new Float64Array(64);
    const count = buildSampleTimes(0.1, 0.16, 0.012, [], out);
    // Interior grid multiples of 0.012 strictly inside (0.1, 0.16): 0.108, 0.12,
    // 0.132, 0.144, 0.156 — plus the two endpoints.
    const times = Array.from(out.subarray(0, count));
    for (const m of [0.108, 0.12, 0.132, 0.144, 0.156]) {
      expect(times.some((t) => Math.abs(t - m) < 1e-9)).toBe(true);
    }
  });

  it('emits just the two endpoints for a degenerate/tiny window', () => {
    const out = new Float64Array(8);
    expect(buildSampleTimes(2, 2, 0.012, [], out)).toBe(1); // zero-width → single point
    const count = buildSampleTimes(1, 1.0001, 0.012, [], out);
    expect(count).toBe(2);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(1.0001);
  });

  it('ITEM 1 (1) no-flash: in-carry samples + captured dip are invariant under sub-dt playhead motion', () => {
    // Owner repro: values=[3], bp=0.25, hd=2, dwell=0.02. At this dwell each carry
    // is a short V whose dip vertex is a segment boundary. Advancing simTime by
    // sub-dt steps must NOT change the samples inside a fixed carry (pre-fix the
    // sliding comb swung the captured dip ~0.048–0.100 m).
    const k = buildK([3], { beatPeriod: 0.25, dwellTime: 0.02, handCount: 2, beatCount: 60 });
    const carry = k.allCarries().find((c) => c.startTime > 2 && c.startTime < 3);
    expect(carry).toBeDefined();
    const c = carry as NonNullable<typeof carry>;
    const ballId = c.ballId;
    const boundaries = segmentBoundaryTimes(k.ballSegments(ballId));
    const out = new Float64Array(trailBufferCapacity(TRAIL_LENGTH_MAX));
    const trailLength = 4;

    let baseTimes: number[] | null = null;
    let baseDip = NaN;
    const step = TRAIL_SAMPLE_DT / 7; // sub-dt increment
    for (let i = 0; i < 14; i++) {
      const simTime = c.endTime + 0.5 + i * step; // carry stays fully inside the window
      const windowStart = Math.max(0, simTime - trailLength);
      const { times, dip } = capturedDip(k, ballId, boundaries, windowStart, simTime, c.startTime, c.endTime, out);
      const rounded = times.map((t) => Math.round(t / 1e-9));
      if (baseTimes === null) {
        baseTimes = rounded;
        baseDip = dip;
        expect(times.length).toBeGreaterThanOrEqual(2);
      } else {
        expect(rounded).toEqual(baseTimes); // identical in-carry sample set
        expect(dip).toBeCloseTo(baseDip, 12); // identical captured dip (no flash)
      }
    }
  });

  it('ITEM 1 (2) boundaries honored: carry boundaries are sampled and the dip is captured exactly', () => {
    // Across a low-dwell sweep the carry dip sits at a segment boundary; including
    // every boundary makes the captured dip equal the analytic carry minimum.
    const out = new Float64Array(trailBufferCapacity(TRAIL_LENGTH_MAX));
    for (const dwellTime of [0.02, 0.04, 0.06, 0.08, 0.1]) {
      const k = buildK([3], { beatPeriod: 0.25, dwellTime, handCount: 2, beatCount: 60 });
      const carry = k.allCarries().find((cc) => cc.startTime > 2 && cc.startTime < 3);
      expect(carry).toBeDefined();
      const c = carry as NonNullable<typeof carry>;
      const ballId = c.ballId;
      const boundaries = segmentBoundaryTimes(k.ballSegments(ballId));
      const simTime = c.endTime + 0.5;
      const windowStart = Math.max(0, simTime - 4);
      const count = buildSampleTimes(windowStart, simTime, TRAIL_SAMPLE_DT, boundaries, out);
      const sampled = Array.from(out.subarray(0, count));

      // Every carry-internal boundary time appears as a sample.
      for (const b of boundaries) {
        if (b > c.startTime - 1e-12 && b < c.endTime + 1e-12) {
          expect(sampled.some((t) => Math.abs(t - b) < 1e-9)).toBe(true);
        }
      }

      // Captured dip (min over samples in the carry) equals the analytic minimum
      // (dense reference over the carry) to < 1e-6.
      let sampledDip = Infinity;
      for (const t of sampled) {
        if (t >= c.startTime && t <= c.endTime) {
          sampledDip = Math.min(sampledDip, k.ballState(ballId, t).position.y);
        }
      }
      let analyticDip = Infinity;
      const N = 4000;
      for (let j = 0; j <= N; j++) {
        const t = c.startTime + ((c.endTime - c.startTime) * j) / N;
        analyticDip = Math.min(analyticDip, k.ballState(ballId, t).position.y);
      }
      expect(sampledDip).toBeLessThan(Infinity);
      expect(Math.abs(sampledDip - analyticDip)).toBeLessThan(1e-6);
    }
  });

  it('ITEM 1 (3) capacity: value-1 at the min beat period over the max trail never overruns', () => {
    // The densest pattern (a ball caught/thrown every beat) at the shortest beat
    // period over the longest trail. The emitted count must never exceed capacity
    // and all boundary points must survive.
    const beatCount = Math.ceil(TRAIL_LENGTH_MAX / BEAT_PERIOD_MIN) + 40;
    const k = buildK([1], {
      beatPeriod: BEAT_PERIOD_MIN,
      dwellTime: 0.02,
      handCount: 2,
      beatCount,
    });
    const ballId = k.ballIds()[0] as number;
    const boundaries = segmentBoundaryTimes(k.ballSegments(ballId));
    const cap = trailBufferCapacity(TRAIL_LENGTH_MAX);
    const out = new Float64Array(cap);
    for (const simTime of [TRAIL_LENGTH_MAX + 0.1, TRAIL_LENGTH_MAX + 1, TRAIL_LENGTH_MAX + 2.5]) {
      const windowStart = Math.max(0, simTime - TRAIL_LENGTH_MAX);
      const count = buildSampleTimes(windowStart, simTime, TRAIL_SAMPLE_DT, boundaries, out);
      expect(count).toBeLessThanOrEqual(cap);
      // Boundaries in the window all survived (headroom covers them; none dropped).
      const sampled = Array.from(out.subarray(0, count));
      for (const b of boundaries) {
        if (b > windowStart && b < simTime) {
          expect(sampled.some((t) => Math.abs(t - b) < 1e-9)).toBe(true);
        }
      }
    }
  });

  it('ITEM 1 (3b) hard clamp: boundaries survive, grid dropped, when the buffer binds', () => {
    // Force the cap to bind with a tiny buffer that fits the boundaries + endpoints
    // but not the full grid: grid points are dropped in preference, boundaries stay.
    const boundaries = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
    const tiny = new Float64Array(12); // 6 boundaries + 2 endpoints + 4 grid slots
    const count = buildSampleTimes(0, 0.5, 0.012, boundaries, tiny);
    expect(count).toBeLessThanOrEqual(tiny.length);
    const sampled = Array.from(tiny.subarray(0, count));
    for (const b of boundaries) {
      expect(sampled.some((t) => Math.abs(t - b) < 1e-9)).toBe(true); // all survive
    }
    expect(sampled[0]).toBe(0);
    expect(sampled[count - 1]).toBe(0.5);
  });
});

describe('boundary buffer capacities (ITEM 1)', () => {
  it('adds boundary headroom on top of the uniform-grid cap', () => {
    expect(trailBufferCapacity(TRAIL_LENGTH_MAX)).toBe(maxTrailPoints(TRAIL_LENGTH_MAX) + BOUNDARY_HEADROOM);
    expect(ghostBufferCapacity()).toBe(maxGhostPoints() + BOUNDARY_HEADROOM);
  });
});
