// src/render3d/tracers — pure sampling geometry for 3D ball trails + ghosts
// (DESIGN.md §6). No three.js, no React: just the arithmetic of "how many points
// and at what times", so the hot-path component (Tracers.tsx) can preallocate
// buffers and fill them in place with zero per-frame allocation.
//
// A tracer is a polyline of `position(t)` (DESIGN.md §2): a trail samples the
// trailing window [simTime − trailLength, simTime]; a ghost samples the forward
// span [simTime, simTime + GHOST_SPAN_SECONDS]. Both resample the exact analytic
// path every frame (not a recorded history), so they follow flight parabolas and
// carry splines exactly and stay correct under scrubbing.

/**
 * Target sample spacing in seconds (~12 ms ≈ sub-frame at 60 fps). Fine enough
 * that a ~0.5 s flight parabola gets ~40 points (visually exact) and a short
 * carry spline stays smooth; coarse enough to bound the point count.
 */
export const TRAIL_SAMPLE_DT = 0.012;

/** Forward span of the dashed ghost paths in seconds (DESIGN.md §6, fixed). */
export const GHOST_SPAN_SECONDS = 1.5;

/**
 * Number of samples for a span of `spanSeconds`, spaced ~`dt` apart and capped at
 * `maxPoints` (the preallocated buffer capacity). Returns 0 for a non-positive
 * span (draw nothing), else at least 2 (a polyline needs two endpoints).
 */
export function trailPointCount(spanSeconds: number, dt: number, maxPoints: number): number {
  if (spanSeconds <= 0) {
    return 0;
  }
  const n = Math.floor(spanSeconds / dt) + 1;
  return Math.max(2, Math.min(n, maxPoints));
}

/**
 * The time of sample `index` of `count`, uniformly spanning [start, end]. Index 0
 * is exactly `start` and index `count−1` is exactly `end` — so a trail's last
 * point sits on the ball (`end = simTime`) and a ghost's first point does too,
 * connecting the polylines to the sphere with no gap.
 */
export function sampleTimeAt(index: number, count: number, start: number, end: number): number {
  if (count <= 1) {
    return end;
  }
  return start + (end - start) * (index / (count - 1));
}

/** Buffer capacity (points) for the longest possible trail at spacing `dt`. */
export function maxTrailPoints(maxTrailSeconds: number, dt: number = TRAIL_SAMPLE_DT): number {
  return Math.max(2, Math.floor(maxTrailSeconds / dt) + 1);
}

/** Buffer capacity (points) for a ghost path at spacing `dt`. */
export function maxGhostPoints(dt: number = TRAIL_SAMPLE_DT): number {
  return Math.max(2, Math.floor(GHOST_SPAN_SECONDS / dt) + 1);
}
