import { describe, expect, it } from 'vitest';
import { CURSOR_FRACTION, windowSpans } from '../state/simulation';
import {
  clampSimTime,
  flightMarksInWindow,
  timeFromPointer,
  timeOfX,
  trailHandlePlacement,
  xOfTime,
  type BarGeometry,
} from './timelineBar';

// A plot spanning [10, 990] logical units over a 3 s window whose left edge is at
// sim time 4.1 s (i.e. simTime = 5.0, pastSpan = 0.9 at the default window).
function geometry(overrides: Partial<BarGeometry> = {}): BarGeometry {
  return {
    svgWidth: 1000,
    plotLeft: 10,
    plotWidth: 980,
    windowStart: 4.1,
    timelineWindow: 3,
    ...overrides,
  };
}

describe('xOfTime / timeOfX', () => {
  it('map the window edges to the plot edges', () => {
    const g = geometry();
    expect(xOfTime(g.windowStart, g)).toBeCloseTo(g.plotLeft, 9);
    expect(xOfTime(g.windowStart + g.timelineWindow, g)).toBeCloseTo(g.plotLeft + g.plotWidth, 9);
  });

  it('round-trip: timeOfX(xOfTime(t)) = t', () => {
    const g = geometry();
    for (const t of [4.1, 4.5, 5.0, 6.2, 7.1]) {
      expect(timeOfX(xOfTime(t, g), g)).toBeCloseTo(t, 9);
    }
  });

  it('places the anchored playhead a fixed fraction from the left', () => {
    const g = geometry();
    const simTime = g.windowStart + windowSpans(g.timelineWindow).pastSpan; // = 5.0
    const frac = (xOfTime(simTime, g) - g.plotLeft) / g.plotWidth;
    expect(frac).toBeCloseTo(CURSOR_FRACTION, 9);
  });
});

describe('timeFromPointer', () => {
  it('inverts the pixel→time mapping across the rendered width', () => {
    const g = geometry();
    const rect = { left: 100, width: 500 }; // 500 px wide, logical width 1000
    // A click at the far-left pixel maps to logical x = 0 ⇒ before the plot band.
    expect(timeFromPointer(100, rect, g)).toBeCloseTo(timeOfX(0, g), 9);
    // A click at the middle pixel maps to logical x = 500 (plot center-ish).
    expect(timeFromPointer(350, rect, g)).toBeCloseTo(timeOfX(500, g), 9);
  });

  it('degrades to windowStart for a zero-width rect (jsdom)', () => {
    const g = geometry();
    expect(timeFromPointer(300, { left: 0, width: 0 }, g)).toBe(g.windowStart);
  });
});

describe('trailHandlePlacement', () => {
  const simTime = 5.0;

  it('sits at the trail start when the trail fits inside the past span', () => {
    const g = geometry(); // pastSpan = 0.9 s
    const placement = trailHandlePlacement(simTime, 0.5, g);
    expect(placement.pinned).toBe(false);
    expect(placement.x).toBeCloseTo(xOfTime(simTime - 0.5, g), 9);
    expect(placement.x).toBeGreaterThan(g.plotLeft);
  });

  it('pins to the left edge once the trail exceeds the past span', () => {
    const g = geometry(); // pastSpan = 0.9 s
    const placement = trailHandlePlacement(simTime, 1.5, g);
    expect(placement.pinned).toBe(true);
    expect(placement.x).toBe(g.plotLeft);
  });

  it('pin threshold scales with the window (larger window ⇒ larger past span)', () => {
    const wide = geometry({ timelineWindow: 10 }); // pastSpan = 3 s
    expect(trailHandlePlacement(simTime, 2.5, wide).pinned).toBe(false);
    expect(trailHandlePlacement(simTime, 3.5, wide).pinned).toBe(true);
  });
});

describe('clampSimTime', () => {
  it('clamps to t ≥ 0', () => {
    expect(clampSimTime(-2)).toBe(0);
    expect(clampSimTime(0)).toBe(0);
    expect(clampSimTime(4.2)).toBe(4.2);
  });
});

describe('flightMarksInWindow (mini-ladder clipping fix)', () => {
  // A visible window [5.0, 8.0] (windowStart 5, windowEnd 8).
  const start = 5.0;
  const end = 8.0;

  it('draws both marks when both endpoints are inside the window', () => {
    expect(flightMarksInWindow(5.5, 7.5, start, end)).toEqual({ showThrow: true, showCatch: true });
  });

  it('drops a throw tick thrown before the track start (no dots before the start)', () => {
    // Thrown at 4.6 (before windowStart), lands at 6.0 (inside): only the catch shows.
    expect(flightMarksInWindow(4.6, 6.0, start, end)).toEqual({ showThrow: false, showCatch: true });
  });

  it('drops a catch ring landing after the track end (no dots persisting past the end)', () => {
    // Thrown at 7.8 (inside), lands at 8.6 (after windowEnd): only the throw shows.
    expect(flightMarksInWindow(7.8, 8.6, start, end)).toEqual({ showThrow: true, showCatch: false });
  });

  it('drops both marks for a flight entirely outside the window', () => {
    expect(flightMarksInWindow(3.0, 4.0, start, end)).toEqual({ showThrow: false, showCatch: false });
    expect(flightMarksInWindow(9.0, 10.0, start, end)).toEqual({ showThrow: false, showCatch: false });
  });

  it('treats the window edges as inclusive', () => {
    expect(flightMarksInWindow(start, end, start, end)).toEqual({ showThrow: true, showCatch: true });
  });
});
