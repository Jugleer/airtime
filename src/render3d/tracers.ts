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

// --- Boundary-anchored sampling (no-flash fix) ------------------------------
//
// The old trail/ghost sampled a UNIFORM comb of `count` points spanning the
// window [start, end] (sampleTimeAt). Because that comb is anchored to the
// (moving) playhead, it slides every frame; a short carry then gets a jittering
// number of interior samples and its dip vertex is usually clipped, so the drawn
// depth flickers frame-to-frame (owner: "splits and flashes between two low-poly
// curves"). The fix builds each frame's sample-time list as the union of three
// DETERMINISTIC sets, sorted + deduped (buildSampleTimes):
//   (a) the two window endpoints (head stays glued to the ball),
//   (b) the ABSOLUTE-anchored interior grid m·dt strictly inside the window
//       (fixed in sim time — does not slide as the playhead moves), and
//   (c) every ball segment-boundary time strictly inside the window (so catches,
//       throws and internal carry joints — the dip vertex among them — are always
//       sampled exactly).
// The result is invariant under sub-dt playhead motion, so the depth no longer
// flickers, and it stays within a preallocated buffer (zero per-frame allocation).

/** Dedupe tolerance (s): collapse coincident grid/boundary/endpoint times so no
 * zero-length polyline edge is emitted (LineDashedMaterial arc length degenerates
 * on a zero-length edge). */
export const SAMPLE_DEDUP_EPS = 1e-9;

/**
 * Extra buffer capacity, in points, reserved for segment-boundary samples beyond
 * the uniform-grid cap. Ball boundaries are densest for value-1 patterns at the
 * minimum beat period (a ball caught/thrown every beat); over the longest trail
 * that is a few hundred boundaries — comfortably inside this headroom — but the
 * merge additionally hard-clamps to the buffer length so it can NEVER overrun
 * (dropping uniform-grid points before boundary points if the cap ever binds).
 */
export const BOUNDARY_HEADROOM = 512;

/** Trail buffer capacity (points): the uniform-grid cap plus boundary headroom. */
export function trailBufferCapacity(maxTrailSeconds: number, dt: number = TRAIL_SAMPLE_DT): number {
  return maxTrailPoints(maxTrailSeconds, dt) + BOUNDARY_HEADROOM;
}

/** Ghost buffer capacity (points): the uniform-grid cap plus boundary headroom. */
export function ghostBufferCapacity(dt: number = TRAIL_SAMPLE_DT): number {
  return maxGhostPoints(dt) + BOUNDARY_HEADROOM;
}

/**
 * Sorted, deduped segment-boundary times for an ordered, contiguous segment list
 * (a ball's flights + carry pieces). These are the catches, throws and internal
 * carry joints — precompute ONCE per sim identity and reuse every frame (never
 * call `ballSegments` inside useFrame — it allocates). Robust to the core carry
 * construction growing the segment count: it reads whatever boundaries exist.
 */
export function segmentBoundaryTimes(
  segments: readonly { readonly startTime: number; readonly endTime: number }[],
): number[] {
  if (segments.length === 0) {
    return [];
  }
  const raw: number[] = [];
  for (const segment of segments) {
    raw.push(segment.startTime);
  }
  raw.push((segments[segments.length - 1] as { readonly endTime: number }).endTime);
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of raw) {
    if (out.length === 0 || t - (out[out.length - 1] as number) > SAMPLE_DEDUP_EPS) {
      out.push(t);
    }
  }
  return out;
}

/** First index `i` with `arr[i] > x` (upper bound over a sorted array). */
function firstIndexGreater(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((arr[mid] as number) > x) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/** First index `i` with `arr[i] >= x` (lower bound over a sorted array). */
function firstIndexAtOrAfter(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((arr[mid] as number) >= x) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * Build the sorted, deduped sample-time list for a window [start, end] into the
 * preallocated `out` buffer, returning the number of times written. The list is
 * the union of: the two endpoints (`out[0] = start`, `out[count-1] = end`), the
 * absolute-anchored interior grid `m·dt ∈ (start, end)`, and the `boundaries`
 * (already sorted) strictly inside `(start, end)`.
 *
 * Capacity is hard-clamped to `out.length`: boundary points are preferred over
 * uniform-grid points, and the endpoints are always emitted, so the merge can
 * never write past the buffer even for the densest pattern (value 1 at the
 * minimum beat period over the longest trail).
 */
export function buildSampleTimes(
  start: number,
  end: number,
  dt: number,
  boundaries: readonly number[],
  out: Float64Array,
): number {
  const cap = out.length;
  if (cap <= 0) {
    return 0;
  }
  if (!(end > start)) {
    out[0] = end; // degenerate window → a single point
    return 1;
  }

  // Interior grid m·dt strictly inside (start, end), absolute-anchored.
  const mLo = Math.floor(start / dt) + 1;
  const mHi = Math.ceil(end / dt) - 1;
  const gridCount = Math.max(0, mHi - mLo + 1);

  // Boundaries strictly inside (start, end): indices [bStart, bEnd).
  const bStart = firstIndexGreater(boundaries, start);
  const bEnd = firstIndexAtOrAfter(boundaries, end);
  const boundaryCount = Math.max(0, bEnd - bStart);

  // Budget (endpoints excluded): boundaries win, grid is subsampled to fit. The
  // strides only bias WHICH points are dropped under cap pressure; the per-write
  // guard below is the true overrun guarantee, so a rounded stride is fine.
  const interiorCap = Math.max(0, cap - 2);
  let boundaryStride = 1;
  let keptBoundaries = boundaryCount;
  if (boundaryCount > interiorCap && interiorCap > 0) {
    boundaryStride = Math.ceil(boundaryCount / interiorCap);
    keptBoundaries = Math.ceil(boundaryCount / boundaryStride);
  } else if (interiorCap === 0) {
    keptBoundaries = 0;
    boundaryStride = boundaryCount + 1;
  }
  let gridStride = 1;
  const gridBudget = interiorCap - keptBoundaries;
  if (gridCount > gridBudget) {
    gridStride = gridBudget > 0 ? Math.ceil(gridCount / gridBudget) : gridCount + 1;
  }

  let count = 0;
  out[count++] = start;
  // Two-pointer merge of the (strided) grid and (strided) boundary streams,
  // inlined (no per-call closure — this runs in the useFrame hot path). The final
  // buffer slot is reserved for `end`, so interior stops at cap − 1.
  let gi = 0;
  let bi = bStart;
  while ((gi < gridCount || bi < bEnd) && count < cap - 1) {
    const gTime = gi < gridCount ? (mLo + gi) * dt : Infinity;
    const bTime = bi < bEnd ? (boundaries[bi] as number) : Infinity;
    let t: number;
    if (gTime <= bTime) {
      t = gTime;
      gi += gridStride;
    } else {
      t = bTime;
      bi += boundaryStride;
    }
    if (t - (out[count - 1] as number) > SAMPLE_DEDUP_EPS) {
      out[count++] = t; // else collapse a coincident grid/boundary point
    }
  }
  // Head stays glued to the ball: if the last interior sample coincides with the
  // endpoint, snap it to exactly `end`; otherwise append `end`.
  if (end - (out[count - 1] as number) <= SAMPLE_DEDUP_EPS) {
    out[count - 1] = end;
  } else if (count < cap) {
    out[count++] = end;
  }
  return count;
}
