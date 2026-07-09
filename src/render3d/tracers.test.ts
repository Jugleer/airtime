import { describe, expect, it } from 'vitest';
import {
  GHOST_SPAN_SECONDS,
  maxGhostPoints,
  maxTrailPoints,
  sampleTimeAt,
  TRAIL_SAMPLE_DT,
  trailPointCount,
} from './tracers';

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
    // 8 s at 12 ms ⇒ floor(666.6)+1 = 667.
    expect(maxTrailPoints(8, 0.012)).toBe(667);
  });

  it('maxGhostPoints covers the fixed ghost span', () => {
    expect(maxGhostPoints(0.012)).toBe(Math.floor(GHOST_SPAN_SECONDS / 0.012) + 1);
  });

  it('every trail point count stays within the buffer', () => {
    const cap = maxTrailPoints(8, TRAIL_SAMPLE_DT);
    for (const span of [0.1, 0.8, 3, 8, 12]) {
      expect(trailPointCount(span, TRAIL_SAMPLE_DT, cap)).toBeLessThanOrEqual(cap);
    }
  });
});
