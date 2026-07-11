// src/workspace — the hand-workspace geometry + containment lab (owner feature,
// 2026-07-11): a configurable bounding volume each hand may move within. This
// module is PURE — no React, no three.js, no zustand, no side effects — mirroring
// the src/core discipline (CLAUDE.md hard rule 1) so it is fully unit- and
// property-testable without a DOM or a WebGL context. It is NOT under src/core, so
// the core ESLint fence does not apply to it, but it is held to the same bar.
//
// It owns three things:
//   1. The workspace SPEC (shape kind + per-axis display-frame scale + enabled).
//   2. Closed-form CONTAINMENT for the primitives (sphere/ellipsoid, cube/box,
//      regular tetrahedron) and ray-parity containment for an uploaded STL mesh.
//   3. The VIOLATION computation: given a hand path sampled over one spatial period,
//      what fraction lies OUTSIDE the volume, and which contiguous spans (for the
//      red overlay). This is advisory only — it never alters any path (orchestrator
//      ruling 1); it visualizes the volume and flags where the hand leaves it.
//
// Frames (orchestrator ruling 3): every user-facing scale/label is in the DISPLAY
// frame (right-handed, Z-up: X along the hands' line, Y front↔back, Z up — see
// src/render3d/displayFrame.ts). The sim/three world is natively y-up. This module
// stores scales in the display frame and converts sim-frame points into a
// display-aligned LOCAL frame (centered on the hand anchor) for every test.

/** A 3-point (meters). Structurally compatible with core's Vec3, kept local so the
 *  workspace module has no upstream dependency. */
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The four workspace shapes: three primitives + an uploaded STL mesh. */
export type WorkspaceShapeKind = 'sphere' | 'cube' | 'tetra' | 'stl';

/** The three primitive kinds (codec-encoded; STL is session-only, ruling 4). */
export const WORKSPACE_PRIMITIVE_KINDS = ['sphere', 'cube', 'tetra'] as const;

/** Per-axis half-extent (semi-axis) in the DISPLAY frame, meters. X = along the
 *  hand line, Y = front↔back, Z = up. */
export interface WorkspaceScale {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * ONE shared workspace spec (orchestrator ruling 2), instantiated per hand centered
 * on that hand's anchor. Per-hand overrides are future work (see the report).
 */
export interface WorkspaceConfig {
  readonly kind: WorkspaceShapeKind;
  /** Per-axis half-extents (display frame, meters). */
  readonly scale: WorkspaceScale;
  /** Advisory overlay + violation flagging on/off (ruling 1). */
  readonly enabled: boolean;
}

// --- Defaults & slider ranges (orchestrator ruling 5; reversible — see report) ---

/** Scale slider bounds (m). Half-extents ~0.1–2 m cover a fingertip flick to a full
 *  arm sweep. */
export const WORKSPACE_SCALE_MIN = 0.1;
export const WORKSPACE_SCALE_MAX = 2;

/** Default per-axis half-extent (m): a modest, isotropic ~0.8 m box around the hand. */
export const DEFAULT_WORKSPACE_SCALE: WorkspaceScale = { x: 0.4, y: 0.4, z: 0.4 };

/** Default shape and off-by-default (advisory feature; opt-in so a fresh boot is clean). */
export const DEFAULT_WORKSPACE_KIND: WorkspaceShapeKind = 'sphere';
export const DEFAULT_WORKSPACE_ENABLED = false;

/** The fresh-boot workspace spec. */
export const DEFAULT_WORKSPACE: WorkspaceConfig = {
  kind: DEFAULT_WORKSPACE_KIND,
  scale: DEFAULT_WORKSPACE_SCALE,
  enabled: DEFAULT_WORKSPACE_ENABLED,
};

/** Clamp one scale value into the slider range (guards NaN → min). */
export function clampScaleValue(value: number): number {
  if (!Number.isFinite(value)) {
    return WORKSPACE_SCALE_MIN;
  }
  return Math.min(WORKSPACE_SCALE_MAX, Math.max(WORKSPACE_SCALE_MIN, value));
}

/** Clamp every axis of a scale into range. */
export function clampScale(scale: WorkspaceScale): WorkspaceScale {
  return { x: clampScaleValue(scale.x), y: clampScaleValue(scale.y), z: clampScaleValue(scale.z) };
}

// --- Frame conversion (sim y-up → display-aligned local, ruling 3) --------------

/**
 * Map a sim-frame (y-up) offset from the hand anchor into the DISPLAY-aligned local
 * frame (right-handed, Z-up), as an [X, Y, Z] tuple. This is exactly
 * render3d/displayFrame.simToDisplay: display X = sim x, display Y = −sim z, display
 * Z = sim y. Kept inline (with a test asserting agreement) so the workspace module
 * stays self-contained and pure — no render3d dependency.
 */
export function simOffsetToLocal(dx: number, dy: number, dz: number): [number, number, number] {
  return [dx, -dz, dy];
}

// --- Canonical regular tetrahedron (apex up, circumradius 1, display-local) ------
// One vertex on +Z (the apex, "apex up" per ruling 3); the opposite face is the
// horizontal base below. Centroid at the origin. Per-axis scale stretches it (it is
// only regular under a uniform scale — accepted, ruling 3).

const TETRA_BASE_Z = -1 / 3;
const TETRA_BASE_R = (2 * Math.SQRT2) / 3; // √(1 − 1/9), the base circumradius

/** The four canonical tetra vertices (display-local X/Y/Z), apex first. */
export const TETRA_VERTICES: readonly (readonly [number, number, number])[] = [
  [0, 0, 1], // apex (up)
  [0, TETRA_BASE_R, TETRA_BASE_Z],
  [TETRA_BASE_R * (-Math.sqrt(3) / 2), TETRA_BASE_R * (-1 / 2), TETRA_BASE_Z],
  [TETRA_BASE_R * (Math.sqrt(3) / 2), TETRA_BASE_R * (-1 / 2), TETRA_BASE_Z],
];

/** Vertex-index triples for the four faces (for both containment and mesh building). */
export const TETRA_FACES: readonly (readonly [number, number, number])[] = [
  [1, 2, 3], // base
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 1],
];

interface Plane {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** Inside iff n·p ≤ offset (offset ≥ 0, so the origin/centroid is inside). */
  readonly offset: number;
}

/** Outward face planes of the canonical tetra, oriented so the centroid is inside. */
const TETRA_PLANES: readonly Plane[] = TETRA_FACES.map(([i, j, k]) => {
  const a = TETRA_VERTICES[i]!;
  const b = TETRA_VERTICES[j]!;
  const c = TETRA_VERTICES[k]!;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  let offset = nx * a[0] + ny * a[1] + nz * a[2];
  if (offset < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
    offset = -offset;
  }
  return { nx, ny, nz, offset };
});

/** Small tolerance so points exactly on a boundary count as inside (closed volume). */
const BOUNDARY_EPS = 1e-9;

// --- Primitive containment (closed-form, display-local, unit canonical shape) ----

/** Whether a display-local point (already offset from the anchor) is inside a
 *  primitive of the given per-axis half-extents. `local` = [X, Y, Z]. */
function pointInsidePrimitive(
  kind: 'sphere' | 'cube' | 'tetra',
  scale: WorkspaceScale,
  local: readonly [number, number, number],
): boolean {
  // Normalize by the per-axis half-extent so the test is against the unit canonical
  // shape. A non-positive scale degenerates the axis to a slab of zero width.
  const sx = scale.x > 0 ? scale.x : Infinity;
  const sy = scale.y > 0 ? scale.y : Infinity;
  const sz = scale.z > 0 ? scale.z : Infinity;
  const qx = local[0] / sx;
  const qy = local[1] / sy;
  const qz = local[2] / sz;
  if (kind === 'sphere') {
    return qx * qx + qy * qy + qz * qz <= 1 + BOUNDARY_EPS;
  }
  if (kind === 'cube') {
    return (
      Math.abs(qx) <= 1 + BOUNDARY_EPS &&
      Math.abs(qy) <= 1 + BOUNDARY_EPS &&
      Math.abs(qz) <= 1 + BOUNDARY_EPS
    );
  }
  // Tetra: inside iff on the inner side of all four canonical face planes.
  for (const plane of TETRA_PLANES) {
    if (plane.nx * qx + plane.ny * qy + plane.nz * qz > plane.offset + BOUNDARY_EPS) {
      return false;
    }
  }
  return true;
}

// --- STL parsing (client-side; binary AND ascii; no external requests) ----------

/** A mesh triangle in the canonical (recentered + normalized) display-local frame. */
export interface Triangle {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly c: readonly [number, number, number];
}

/** A parsed STL, normalized to the canonical unit frame (max half-extent = 1). */
export interface ParsedStl {
  readonly triangles: readonly Triangle[];
  readonly triangleCount: number;
  /** True when every undirected edge is shared by exactly two triangles. */
  readonly watertight: boolean;
  /** Canonical (post-normalization) axis-aligned bounds, [min, max] per axis. */
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  /** A human warning when the mesh is degenerate/non-watertight (else null). */
  readonly warning: string | null;
}

/** A binary STL is exactly 84 + 50·count bytes; use that to disambiguate from ascii. */
function looksBinary(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) {
    return false;
  }
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  return buffer.byteLength === 84 + count * 50;
}

interface RawTriangle {
  readonly a: [number, number, number];
  readonly b: [number, number, number];
  readonly c: [number, number, number];
}

function parseBinaryStl(buffer: ArrayBuffer): RawTriangle[] {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const triangles: RawTriangle[] = [];
  let offset = 84;
  for (let i = 0; i < count; i++) {
    // Skip the 3-float face normal; read the three vertices.
    const v = (base: number): [number, number, number] => [
      view.getFloat32(base, true),
      view.getFloat32(base + 4, true),
      view.getFloat32(base + 8, true),
    ];
    triangles.push({ a: v(offset + 12), b: v(offset + 24), c: v(offset + 36) });
    offset += 50;
  }
  return triangles;
}

function parseAsciiStl(text: string): RawTriangle[] {
  const triangles: RawTriangle[] = [];
  const verts: [number, number, number][] = [];
  // Match "vertex x y z" lines (numbers may be in exponential notation).
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      verts.push([x, y, z]);
    }
  }
  for (let i = 0; i + 2 < verts.length; i += 3) {
    triangles.push({ a: verts[i]!, b: verts[i + 1]!, c: verts[i + 2]! });
  }
  return triangles;
}

/** Quantize a vertex to a grid so coincident vertices merge for the manifold check. */
function edgeKey(p: readonly [number, number, number], q: readonly [number, number, number]): string {
  const round = (v: number): number => Math.round(v * 1e5);
  const kp = `${round(p[0])},${round(p[1])},${round(p[2])}`;
  const kq = `${round(q[0])},${round(q[1])},${round(q[2])}`;
  return kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
}

/** True when every undirected edge is shared by exactly two triangles (closed shell). */
function isWatertight(triangles: readonly Triangle[]): boolean {
  if (triangles.length === 0) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const t of triangles) {
    for (const [p, q] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ] as const) {
      const key = edgeKey(p, q);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const n of counts.values()) {
    if (n !== 2) {
      return false;
    }
  }
  return true;
}

/**
 * Parse an STL file (binary or ascii) into a canonical, hand-centered unit mesh
 * (orchestrator ruling 4): triangles recentered on their bounding-box center and
 * scaled so the largest half-extent is 1 (aspect ratio preserved), so the per-axis
 * scale sliders stretch it exactly like the primitives. Degenerate meshes (no
 * triangles, zero extent) return `triangleCount: 0` with a warning; non-watertight
 * meshes parse but flag `watertight: false` so containment falls back to the
 * bounding box (a safe closed superset).
 */
export function parseStl(buffer: ArrayBuffer): ParsedStl {
  const empty: ParsedStl = {
    triangles: [],
    triangleCount: 0,
    watertight: false,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    warning: 'That STL contained no triangles — nothing to use as a workspace.',
  };
  let raw: RawTriangle[];
  try {
    raw = looksBinary(buffer) ? parseBinaryStl(buffer) : parseAsciiStl(new TextDecoder().decode(buffer));
  } catch {
    return { ...empty, warning: 'That file could not be parsed as an STL.' };
  }
  if (raw.length === 0) {
    return empty;
  }

  // Bounding box in the STL's native coordinates.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const t of raw) {
    for (const p of [t.a, t.b, t.c]) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
  }
  const cx = 0.5 * (minX + maxX);
  const cy = 0.5 * (minY + maxY);
  const cz = 0.5 * (minZ + maxZ);
  const halfX = 0.5 * (maxX - minX);
  const halfY = 0.5 * (maxY - minY);
  const halfZ = 0.5 * (maxZ - minZ);
  const maxHalf = Math.max(halfX, halfY, halfZ);
  if (!(maxHalf > 0) || !Number.isFinite(maxHalf)) {
    return { ...empty, warning: 'That STL is degenerate (zero size) — cannot use it as a workspace.' };
  }
  const inv = 1 / maxHalf;
  const norm = (p: [number, number, number]): [number, number, number] => [
    (p[0] - cx) * inv,
    (p[1] - cy) * inv,
    (p[2] - cz) * inv,
  ];
  const triangles: Triangle[] = raw.map((t) => ({ a: norm(t.a), b: norm(t.b), c: norm(t.c) }));
  const watertight = isWatertight(triangles);
  const bx = halfX * inv;
  const by = halfY * inv;
  const bz = halfZ * inv;
  return {
    triangles,
    triangleCount: triangles.length,
    watertight,
    bounds: { min: [-bx, -by, -bz], max: [bx, by, bz] },
    warning: watertight
      ? null
      : 'That mesh is not watertight — containment falls back to its bounding box (approximate).',
  };
}

// --- STL containment (ray parity; bbox fallback for non-watertight meshes) -------

/** A fixed, slightly skewed ray direction so a cast rarely grazes an edge/vertex. */
const RAY_DX = 0.5773502691896258;
const RAY_DY = 0.5567764362830022;
const RAY_DZ = 0.5971385352263199;
const RAY_EPS = 1e-9;

/** Möller–Trumbore: does the ray from `o` along the fixed direction cross this tri
 *  at t > 0? Counts a forward crossing for the parity test. */
function rayCrossesTriangle(ox: number, oy: number, oz: number, t: Triangle): boolean {
  const e1x = t.b[0] - t.a[0];
  const e1y = t.b[1] - t.a[1];
  const e1z = t.b[2] - t.a[2];
  const e2x = t.c[0] - t.a[0];
  const e2y = t.c[1] - t.a[1];
  const e2z = t.c[2] - t.a[2];
  // p = d × e2
  const px = RAY_DY * e2z - RAY_DZ * e2y;
  const py = RAY_DZ * e2x - RAY_DX * e2z;
  const pz = RAY_DX * e2y - RAY_DY * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -RAY_EPS && det < RAY_EPS) {
    return false; // ray parallel to the triangle
  }
  const invDet = 1 / det;
  const tx = ox - t.a[0];
  const ty = oy - t.a[1];
  const tz = oz - t.a[2];
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) {
    return false;
  }
  // q = t × e1
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (RAY_DX * qx + RAY_DY * qy + RAY_DZ * qz) * invDet;
  if (v < 0 || u + v > 1) {
    return false;
  }
  const tt = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return tt > RAY_EPS;
}

/** Whether a canonical-frame point is inside the mesh (odd crossing count), or —
 *  when the mesh is not watertight — inside its bounding box. */
function pointInsideMesh(mesh: ParsedStl, q: readonly [number, number, number]): boolean {
  if (mesh.triangleCount === 0) {
    return true; // no volume to violate
  }
  if (!mesh.watertight) {
    const { min, max } = mesh.bounds;
    return (
      q[0] >= min[0] - BOUNDARY_EPS &&
      q[0] <= max[0] + BOUNDARY_EPS &&
      q[1] >= min[1] - BOUNDARY_EPS &&
      q[1] <= max[1] + BOUNDARY_EPS &&
      q[2] >= min[2] - BOUNDARY_EPS &&
      q[2] <= max[2] + BOUNDARY_EPS
    );
  }
  let crossings = 0;
  for (const t of mesh.triangles) {
    if (rayCrossesTriangle(q[0], q[1], q[2], t)) {
      crossings++;
    }
  }
  return (crossings & 1) === 1;
}

// --- Top-level containment ------------------------------------------------------

/**
 * Whether `point` (sim frame, y-up) lies inside the workspace of the shape/scale in
 * `config`, centered on `center` (sim frame — the hand's catch↔throw anchor). The
 * STL mesh is required only for kind 'stl'; a null mesh there yields `true` (no
 * volume ⇒ no violation, so a missing upload never paints the path red).
 */
export function pointInsideWorkspace(
  config: WorkspaceConfig,
  mesh: ParsedStl | null,
  center: Point3,
  point: Point3,
): boolean {
  const local = simOffsetToLocal(point.x - center.x, point.y - center.y, point.z - center.z);
  if (config.kind === 'stl') {
    if (!mesh || mesh.triangleCount === 0) {
      return true;
    }
    const q: [number, number, number] = [
      local[0] / (config.scale.x > 0 ? config.scale.x : Infinity),
      local[1] / (config.scale.y > 0 ? config.scale.y : Infinity),
      local[2] / (config.scale.z > 0 ? config.scale.z : Infinity),
    ];
    return pointInsideMesh(mesh, q);
  }
  return pointInsidePrimitive(config.kind, config.scale, local);
}

// --- Violation computation (advisory, ruling 1) ---------------------------------

/** The outcome of testing a sampled hand path against a workspace volume. */
export interface ViolationResult {
  /** Fraction of samples OUTSIDE the volume, in [0, 1] (the per-hand badge value). */
  readonly outsideFraction: number;
  /** Per-sample inside flags (parallel to the input samples). */
  readonly insideFlags: readonly boolean[];
  /**
   * Contiguous index runs [startInclusive, endInclusive] where the path is OUTSIDE.
   * On a closed loop a run wrapping the seam is emitted as a single run whose end
   * index is < its start index (the renderer draws it modulo the sample count).
   */
  readonly outsideSpans: readonly (readonly [number, number])[];
}

/** Contiguous runs of `false` (outside) in `insideFlags`. When `closed`, a run
 *  touching both ends is merged across the seam (wrap-around). */
export function outsideSpans(
  insideFlags: readonly boolean[],
  closed = true,
): (readonly [number, number])[] {
  const n = insideFlags.length;
  const spans: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const outside = !insideFlags[i];
    if (outside && start < 0) {
      start = i;
    } else if (!outside && start >= 0) {
      spans.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) {
    spans.push([start, n - 1]);
  }
  // Merge a leading and trailing outside run around the closed-loop seam.
  if (closed && spans.length > 1) {
    const first = spans[0]!;
    const last = spans[spans.length - 1]!;
    if (first[0] === 0 && last[1] === n - 1) {
      spans.pop();
      spans[0] = [last[0], first[1]]; // end < start ⇒ wraps the seam
    }
  }
  return spans;
}

/**
 * Test a hand path (a list of sim-frame sample points over one spatial period)
 * against the workspace volume centered on `center`, returning the outside fraction
 * and the outside spans for the red overlay. Computed ONCE per (sim identity,
 * workspace config) by the caller — never per frame (orchestrator ruling 6).
 */
export function violationOverSamples(
  config: WorkspaceConfig,
  mesh: ParsedStl | null,
  center: Point3,
  samples: readonly Point3[],
  closed = true,
): ViolationResult {
  const n = samples.length;
  if (n === 0) {
    return { outsideFraction: 0, insideFlags: [], outsideSpans: [] };
  }
  const insideFlags: boolean[] = new Array(n);
  let outsideCount = 0;
  for (let i = 0; i < n; i++) {
    const inside = pointInsideWorkspace(config, mesh, center, samples[i]!);
    insideFlags[i] = inside;
    if (!inside) {
      outsideCount++;
    }
  }
  return {
    outsideFraction: outsideCount / n,
    insideFlags,
    outsideSpans: outsideSpans(insideFlags, closed),
  };
}

/**
 * The per-hand badge text (orchestrator ruling 1), e.g. "H0 · 12%". Hand indices are
 * 0-based, matching the rest of the app (gizmo labels "0C/0T", the hand table).
 */
export function violationBadge(hand: number, outsideFraction: number): string {
  return `H${hand} · ${Math.round(outsideFraction * 100)}%`;
}
