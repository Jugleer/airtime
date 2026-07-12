// src/ui/timelineBar — pure geometry for the timeline bar (DESIGN.md §6).
//
// No React, no DOM state: just the maps between sim time and the bar's horizontal
// pixel/logical axis, the detachable trail-handle placement (and its pin rule),
// and the pointer→time inverse used by the scrub gesture. Keeping this pure makes
// the window/playhead/handle math unit-testable without mounting a component.
//
// The window scroll policy is the anchored-playhead one shared with the ladder
// (see src/state/simulation `windowSpans`): the simTime cursor sits a fixed
// fraction of the window from the left, so `windowStart = simTime − pastSpan`.
// The timeline bar freezes `windowStart` only during an active scrub (so the
// playhead tracks the pointer instead of the content sliding under it).

import { windowSpans } from '../state/simulation';

/** The bar's logical horizontal layout (SVG user units) + the current window. */
export interface BarGeometry {
  /** Logical SVG width (the viewBox width). */
  readonly svgWidth: number;
  /** Left edge of the plot band (logical units). */
  readonly plotLeft: number;
  /** Width of the plot band (logical units). */
  readonly plotWidth: number;
  /** Sim time at the plot's left edge. */
  readonly windowStart: number;
  /** Visible window width in seconds. */
  readonly timelineWindow: number;
}

/** Logical x for a sim time (may fall outside the plot band). */
export function xOfTime(time: number, geometry: BarGeometry): number {
  return (
    geometry.plotLeft + ((time - geometry.windowStart) / geometry.timelineWindow) * geometry.plotWidth
  );
}

/** Sim time for a logical x (inverse of {@link xOfTime}). */
export function timeOfX(x: number, geometry: BarGeometry): number {
  return geometry.windowStart + ((x - geometry.plotLeft) / geometry.plotWidth) * geometry.timelineWindow;
}

/**
 * Sim time under a pointer at client x `clientX`, given the SVG element's bounding
 * rect. Maps the pixel position across the rendered width to a logical x, then
 * inverts {@link xOfTime}. `geometry.svgWidth` is the bar's own measured container
 * width (real CSS pixels, 1:1 with the viewBox — TimelineBar's ResizeObserver keeps
 * it in sync), so `rect.width` and `geometry.svgWidth` are normally equal and this
 * reduces to an identity map; the explicit ratio stays here defensively for any
 * transient mismatch between a stale rect and the latest measured width. Returns
 * `windowStart` for a zero-width rect (jsdom) so callers degrade gracefully rather
 * than producing NaN.
 */
export function timeFromPointer(
  clientX: number,
  rect: { readonly left: number; readonly width: number },
  geometry: BarGeometry,
): number {
  if (rect.width <= 0) {
    return geometry.windowStart;
  }
  const logicalX = ((clientX - rect.left) / rect.width) * geometry.svgWidth;
  return timeOfX(logicalX, geometry);
}

/** Placement of the detachable trail handle (DESIGN.md §6). */
export interface TrailHandlePlacement {
  /** True when the trail is longer than the past span: handle pins to the left edge. */
  readonly pinned: boolean;
  /** Logical x of the handle (the left edge when pinned). */
  readonly x: number;
}

/**
 * Where the trail-length handle sits. Unpinned it marks the trail's start time
 * `simTime − trailLength`; once the trail exceeds the window's past span (the
 * region left of the playhead, `timelineWindow · CURSOR_FRACTION`) it can't be
 * shown in the window, so it pins to the plot's left edge and the caller shows a
 * numeric readout of the true length instead (DESIGN.md §6).
 */
export function trailHandlePlacement(
  simTime: number,
  trailLength: number,
  geometry: BarGeometry,
): TrailHandlePlacement {
  const { pastSpan } = windowSpans(geometry.timelineWindow);
  if (trailLength > pastSpan) {
    return { pinned: true, x: geometry.plotLeft };
  }
  return { pinned: false, x: xOfTime(simTime - trailLength, geometry) };
}

/** Clamp a scrubbed sim time to the valid domain (t ≥ 0, DESIGN.md §2). */
export function clampSimTime(time: number): number {
  return Math.max(0, time);
}

/** Which endpoints of one flight fall inside the visible window (DESIGN.md §6). */
export interface FlightMarksInWindow {
  /** Draw the throw tick (its time is inside the window). */
  readonly showThrow: boolean;
  /** Draw the catch ring (its time is inside the window). */
  readonly showCatch: boolean;
}

/**
 * Decide, per endpoint, whether a flight's throw tick / catch ring lies inside the
 * visible window `[windowStart, windowEnd]` (inclusive). This is the fix for the
 * mini-ladder clipping bug: the old code kept a flight whenever ANY part of it
 * overlapped the window and then drew BOTH marks unconditionally, so a throw tick
 * could render before the track's left edge and a catch ring could linger past the
 * right edge. Testing each endpoint independently drops the out-of-range mark and
 * keeps the in-range one. Pure — no React/DOM — so it is unit-testable.
 */
export function flightMarksInWindow(
  throwTime: number,
  arrivalTime: number,
  windowStart: number,
  windowEnd: number,
): FlightMarksInWindow {
  return {
    showThrow: throwTime >= windowStart && throwTime <= windowEnd,
    showCatch: arrivalTime >= windowStart && arrivalTime <= windowEnd,
  };
}
