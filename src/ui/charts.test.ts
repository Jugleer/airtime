import { describe, expect, it } from 'vitest';
import { vec3, type MotionState } from '../core/kinematics';
import {
  axisScalar,
  CHART_MIN_HEIGHT,
  chartCanvasHeight,
  foldSampleRange,
  formatTick,
  gridSampleTime,
  gridStep,
  handColor,
  HAND_PALETTE,
  isFiniteSample,
  niceScale,
  quantityMeta,
  quantityVector,
  SAMPLE_COUNT,
  scalarFromState,
  windowSampleTime,
} from './charts';

function motionState(): MotionState {
  return {
    position: vec3(1, 2, 3),
    velocity: vec3(3, 4, 0), // |v| = 5
    acceleration: vec3(0, -9.81, 0),
    jerk: vec3(1, -2, 2), // |j| = 3
  };
}

describe('windowSampleTime', () => {
  it('spans [windowStart, windowStart + window] with exact endpoints', () => {
    const start = 4.1;
    const window = 3;
    expect(windowSampleTime(0, SAMPLE_COUNT, start, window)).toBeCloseTo(start, 12);
    expect(windowSampleTime(SAMPLE_COUNT - 1, SAMPLE_COUNT, start, window)).toBeCloseTo(
      start + window,
      12,
    );
  });

  it('places the midpoint sample at the window center', () => {
    const t = windowSampleTime(4, 9, 0, 8); // index 4 of 9 → halfway
    expect(t).toBeCloseTo(4, 12);
  });

  it('degrades to windowStart for a count of 1', () => {
    expect(windowSampleTime(0, 1, 2.5, 3)).toBe(2.5);
  });

  it('is monotonically increasing across the window', () => {
    let previous = -Infinity;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const t = windowSampleTime(i, SAMPLE_COUNT, -1, 5);
      expect(t).toBeGreaterThan(previous);
      previous = t;
    }
  });
});

describe('chartCanvasHeight — splitter-responsive canvas sizing', () => {
  it('passes through a measured height above the floor, floored to whole px', () => {
    expect(chartCanvasHeight(300)).toBe(300);
    expect(chartCanvasHeight(417.6)).toBe(417); // integral CSS px keeps dpr scaling exact
    expect(chartCanvasHeight(CHART_MIN_HEIGHT + 1)).toBe(CHART_MIN_HEIGHT + 1);
  });

  it('clamps to the CHART_MIN_HEIGHT floor for small measurements', () => {
    expect(chartCanvasHeight(CHART_MIN_HEIGHT)).toBe(CHART_MIN_HEIGHT);
    expect(chartCanvasHeight(100)).toBe(CHART_MIN_HEIGHT); // dock dragged below floor
    expect(chartCanvasHeight(0)).toBe(CHART_MIN_HEIGHT); // transient zero measurement
    expect(chartCanvasHeight(-50)).toBe(CHART_MIN_HEIGHT);
  });

  it('is total on junk input (NaN / ±Infinity fall back to the floor)', () => {
    expect(chartCanvasHeight(NaN)).toBe(CHART_MIN_HEIGHT);
    expect(chartCanvasHeight(Infinity)).toBe(CHART_MIN_HEIGHT);
    expect(chartCanvasHeight(-Infinity)).toBe(CHART_MIN_HEIGHT);
  });

  it('honors a custom floor and keeps the pre-splitter height as the default', () => {
    expect(CHART_MIN_HEIGHT).toBe(176); // the old fixed CHART_HEIGHT, now the floor
    expect(chartCanvasHeight(100, 80)).toBe(100);
    expect(chartCanvasHeight(50, 80)).toBe(80);
  });
});

describe('gridSampleTime — absolute-lattice sampling (jerk anti-alias, owner req. 4)', () => {
  const step = 0.1;

  it('places every sample on the absolute lattice {k·step}', () => {
    for (const windowStart of [-0.37, 0, 1.234, 9.87]) {
      for (let i = 0; i < 6; i++) {
        const t = gridSampleTime(i, windowStart, step);
        expect(t / step).toBeCloseTo(Math.round(t / step), 9);
      }
    }
  });

  it('starts at the first lattice point ≥ windowStart and steps by exactly one step', () => {
    // windowStart 1.02 → first lattice point is 1.1; samples are 1.1, 1.2, 1.3, …
    const times = Array.from({ length: 4 }, (_, i) => gridSampleTime(i, 1.02, step));
    expect(times[0]).toBeCloseTo(1.1, 9);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeCloseTo(step, 9);
    }
  });

  it('is INVARIANT to a sub-step playhead move — the regression this fixes', () => {
    // A sub-step scrub within one lattice cell must not move the sample times: the
    // trace scrolls (via xOf) but never resamples history, so the jerk stops jittering.
    const before = gridSampleTime(10, 1.02, step);
    const after = gridSampleTime(10, 1.05, step); // still inside the (1.0, 1.1) cell
    expect(after).toBe(before);

    // Contrast: windowSampleTime shifts EVERY sample time by the playhead delta,
    // re-phasing past samples each frame — exactly the aliasing source being removed.
    const wBefore = windowSampleTime(10, SAMPLE_COUNT, 1.02, 3);
    const wAfter = windowSampleTime(10, SAMPLE_COUNT, 1.05, 3);
    expect(wAfter - wBefore).toBeCloseTo(0.03, 9);
  });

  it('yields identical values at a shared absolute time from two playhead positions', () => {
    // Two windows that both contain the lattice point 2.0 sample it as the SAME
    // number, so a pure sampler (handState) returns identical values regardless of
    // where the playhead sits — the property the owner asked to capture.
    const fromA = Array.from({ length: 40 }, (_, i) => gridSampleTime(i, 1.05, step));
    const fromB = Array.from({ length: 40 }, (_, i) => gridSampleTime(i, 1.62, step));
    expect(fromA).toContain(2);
    expect(fromB).toContain(2);
    const bLattice = new Set(fromB.map((t) => Math.round(t / step)));
    let shared = 0;
    for (const t of fromA) {
      if (bLattice.has(Math.round(t / step))) {
        shared++;
      }
    }
    expect(shared).toBeGreaterThan(0);
  });

  it('gridStep spans the window across SAMPLE_COUNT samples and is degenerate-safe', () => {
    expect(gridStep(3, SAMPLE_COUNT)).toBeCloseTo(3 / (SAMPLE_COUNT - 1), 12);
    expect(gridStep(3, 1)).toBe(3); // count ≤ 1 → no division by zero
    expect(gridSampleTime(5, 1.23, 0)).toBe(1.23); // non-positive step → windowStart
  });
});

describe('axisScalar / quantityVector / scalarFromState', () => {
  const state = motionState();

  it('quantityVector selects the right vector', () => {
    expect(quantityVector(state, 'velocity')).toEqual(state.velocity);
    expect(quantityVector(state, 'acceleration')).toEqual(state.acceleration);
    expect(quantityVector(state, 'jerk')).toEqual(state.jerk);
  });

  it('magnitude mode returns the Euclidean length', () => {
    expect(axisScalar(state.velocity, 'magnitude')).toBeCloseTo(5, 12);
    expect(axisScalar(state.jerk, 'magnitude')).toBeCloseTo(3, 12);
  });

  it('component modes return the signed axis value', () => {
    expect(axisScalar(state.velocity, 'x')).toBe(3);
    expect(axisScalar(state.velocity, 'y')).toBe(4);
    expect(axisScalar(state.acceleration, 'y')).toBeCloseTo(-9.81, 12);
    expect(axisScalar(state.velocity, 'z')).toBe(0);
  });

  it('scalarFromState threads quantity + axis mode together', () => {
    expect(scalarFromState(state, 'velocity', 'magnitude')).toBeCloseTo(5, 12);
    expect(scalarFromState(state, 'acceleration', 'y')).toBeCloseTo(-9.81, 12);
    expect(scalarFromState(state, 'jerk', 'x')).toBe(1);
  });
});

describe('quantityMeta', () => {
  it('uses the |·| symbol and full word in magnitude mode', () => {
    expect(quantityMeta('velocity', 'magnitude')).toEqual({ title: 'Speed |v|', unit: 'm/s' });
    expect(quantityMeta('jerk', 'magnitude')).toEqual({ title: 'Jerk |j|', unit: 'm/s³' });
  });

  it('names the component axis in component mode with the right unit', () => {
    expect(quantityMeta('acceleration', 'x')).toEqual({ title: 'Acceleration x', unit: 'm/s²' });
    expect(quantityMeta('velocity', 'z')).toEqual({ title: 'Velocity z', unit: 'm/s' });
  });
});

describe('handColor', () => {
  it('wraps by palette length and is stable per hand', () => {
    expect(handColor(0)).toBe(HAND_PALETTE[0]);
    expect(handColor(HAND_PALETTE.length)).toBe(HAND_PALETTE[0]);
    expect(handColor(1)).toBe(handColor(1));
    expect(handColor(-1)).toBe(HAND_PALETTE[HAND_PALETTE.length - 1]);
  });
});

describe('isFiniteSample', () => {
  it('accepts finite numbers, rejects NaN/±Infinity', () => {
    expect(isFiniteSample(0)).toBe(true);
    expect(isFiniteSample(-3.2)).toBe(true);
    expect(isFiniteSample(NaN)).toBe(false);
    expect(isFiniteSample(Infinity)).toBe(false);
    expect(isFiniteSample(-Infinity)).toBe(false);
  });
});

describe('niceScale', () => {
  it('rounds a [0, 9.7] range to nice bounds and integer ticks', () => {
    const scale = niceScale(0, 9.7, 5);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(10);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks).toContain(10);
    // Ticks are evenly stepped and enclose the data.
    for (const tick of scale.ticks) {
      expect(tick).toBeGreaterThanOrEqual(scale.min - 1e-9);
      expect(tick).toBeLessThanOrEqual(scale.max + 1e-9);
    }
  });

  it('encloses a signed component range and includes zero', () => {
    const scale = niceScale(-3, 5, 5);
    expect(scale.min).toBeLessThanOrEqual(-3);
    expect(scale.max).toBeGreaterThanOrEqual(5);
    expect(scale.ticks.some((t) => Math.abs(t) < 1e-9)).toBe(true);
  });

  it('opens a readable band for a zero-width range at zero', () => {
    const scale = niceScale(0, 0, 5);
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThan(0);
    expect(scale.max - scale.min).toBeGreaterThan(0);
  });

  it('opens a symmetric band for a zero-width range at a nonzero value', () => {
    const scale = niceScale(5, 5, 5);
    expect(scale.min).toBeLessThan(5);
    expect(scale.max).toBeGreaterThan(5);
  });

  it('falls back to [0, 1] for non-finite inputs (no NaN in the scale)', () => {
    const scale = niceScale(NaN, Infinity, 5);
    expect(Number.isFinite(scale.min)).toBe(true);
    expect(Number.isFinite(scale.max)).toBe(true);
    expect(scale.max).toBeGreaterThan(scale.min);
    for (const tick of scale.ticks) {
      expect(Number.isFinite(tick)).toBe(true);
    }
  });

  it('produces a positive, finite step', () => {
    for (const [lo, hi] of [
      [0, 100],
      [0, 0.02],
      [-1.5, 1.5],
    ] as const) {
      const scale = niceScale(lo, hi, 5);
      expect(scale.step).toBeGreaterThan(0);
      expect(Number.isFinite(scale.step)).toBe(true);
    }
  });
});

describe('formatTick', () => {
  it('shows more decimals for smaller steps', () => {
    expect(formatTick(0, 5)).toBe('0');
    expect(formatTick(2.5, 0.5)).toBe('2.5');
    expect(formatTick(0.02, 0.02)).toBe('0.02');
  });
});

describe('foldSampleRange', () => {
  it('folds the finite min/max and skips NaN/Infinity', () => {
    const buffer = new Float32Array([1, NaN, -2, Infinity, 3, -Infinity]);
    const acc = foldSampleRange(buffer, 0, buffer.length, { min: Infinity, max: -Infinity });
    expect(acc.min).toBe(-2);
    expect(acc.max).toBe(3);
  });

  it('leaves the accumulator untouched when every sample is non-finite', () => {
    const buffer = new Float32Array([NaN, Infinity, -Infinity]);
    const acc = foldSampleRange(buffer, 0, buffer.length, { min: Infinity, max: -Infinity });
    expect(acc.min).toBe(Infinity);
    expect(acc.max).toBe(-Infinity);
  });

  it('respects the base offset and count window', () => {
    const buffer = new Float32Array([100, 5, 7, 200]);
    const acc = foldSampleRange(buffer, 1, 2, { min: Infinity, max: -Infinity });
    expect(acc.min).toBe(5);
    expect(acc.max).toBe(7);
  });
});
