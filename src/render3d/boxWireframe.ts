// src/render3d/boxWireframe — a pure builder for an axis-aligned box's 12 edges as a
// flat xyz endpoint buffer (LineSegments layout). Used by the workspace overlay to
// draw the bounding-box wireframe for a NON-watertight STL, whose containment falls
// back to that box (src/workspace pointInsideMesh) even though the drawn mesh is
// open — so the box shows the region actually treated as "inside" (a11y/honesty
// pass 2026-07-11). Kept three-free so it is a trivially testable pure helper.

/**
 * The 12 edges of the axis-aligned box spanning `min`→`max`, as 24 vertices
 * (12 segments × 2 endpoints) in a flat [x,y,z, x,y,z, …] Float32Array — the
 * position layout a three LineSegments consumes directly. Zero-allocation callers
 * memoize the result; this function itself allocates exactly one buffer per call.
 */
export function boxEdgePositions(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Float32Array {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  // 8 corners: 0–3 the z0 face (CCW), 4–7 the z1 face (CCW, same xy order).
  const corners: readonly [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  // 12 edges: the two square faces plus the four verticals joining them.
  const edges: readonly [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0], // z0 face
    [4, 5], [5, 6], [6, 7], [7, 4], // z1 face
    [0, 4], [1, 5], [2, 6], [3, 7], // verticals
  ];
  const out = new Float32Array(edges.length * 2 * 3);
  let i = 0;
  for (const [a, b] of edges) {
    const pa = corners[a]!;
    const pb = corners[b]!;
    out[i++] = pa[0];
    out[i++] = pa[1];
    out[i++] = pa[2];
    out[i++] = pb[0];
    out[i++] = pb[1];
    out[i++] = pb[2];
  }
  return out;
}
