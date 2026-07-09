import { describe, expect, it } from 'vitest';
import { vec3, type MotionState } from '../core/kinematics';
import {
  axisScalar,
  foldSampleRange,
  formatTick,
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
