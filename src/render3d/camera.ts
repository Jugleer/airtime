// src/render3d/camera — camera presets for the 3D scene (DESIGN.md §6).
//
// Pure geometry (no three.js, no React) so the preset math is unit-testable
// without mounting a Canvas (the jsdom/WebGL caution in the Phase 4 plan). The
// scene is meters, y-up (NOTATION.md); hands live near y ≈ 1.0 and balls arc
// above them, so every preset frames a point a little above hand height.

/** A camera placement: eye position and the point it looks at (orbit target). */
export interface CameraView {
  /** Eye position [x, y, z] in meters. */
  readonly position: readonly [number, number, number];
  /** Look-at / orbit target [x, y, z] in meters. */
  readonly target: readonly [number, number, number];
}

/** The four camera presets (DESIGN.md §6). */
export type CameraPreset = 'front' | 'side' | 'top' | 'juggler';

/** Preset order for the button row. */
export const CAMERA_PRESETS: readonly CameraPreset[] = ['front', 'side', 'top', 'juggler'];

/** Full-word labels for the preset buttons (NOTATION.md: full words in UI). */
export const CAMERA_PRESET_LABELS: Record<CameraPreset, string> = {
  front: 'Front',
  side: 'Side',
  top: 'Top',
  juggler: 'Juggler POV',
};

/**
 * The point every non-juggler preset orbits: a touch above hand height (y ≈ 1),
 * centered on the working area (x = z = 0). Chosen so a default cascade and the
 * taller `531`/`441` throws both sit comfortably in frame.
 */
const SCENE_TARGET: readonly [number, number, number] = [0, 1.35, 0];

/**
 * Eye position + look-at target for a preset (DESIGN.md §6). Tuned for the
 * default line geometry (hands at y ≈ 1.0, throws x = ±0.10 m, catches ±0.30 m):
 *
 * - front   — audience view down the +z axis: sees the left↔right / up↔down plane
 *             (the classic cascade silhouette).
 * - side    — profile view along +x: sees the depth (z) ↔ height plane.
 * - top     — plan view looking straight down: sees the x↔z footprint.
 * - juggler — behind the pattern at hand height looking forward and slightly up,
 *             i.e. the juggler's own eye line onto their throws.
 */
export function presetView(preset: CameraPreset): CameraView {
  switch (preset) {
    case 'front':
      return { position: [0, 1.35, 3.2], target: SCENE_TARGET };
    case 'side':
      return { position: [3.2, 1.35, 0], target: SCENE_TARGET };
    case 'top':
      // A hair off-axis in z so the up-vector never degenerates looking straight down.
      return { position: [0, 4.2, 0.001], target: SCENE_TARGET };
    case 'juggler':
      // Eye at hand height, behind the balls (−z), looking forward (+z) and up.
      return { position: [0, 1.05, -1.5], target: [0, 1.6, 0.8] };
  }
}

// --- Camera bounds ------------------------------------------------------------
// The camera must never wander far from the juggling. Zoom distance is clamped
// by OrbitControls' min/maxDistance, but a PAN moves the orbit TARGET, and the
// distance limits are relative to the target — so an unclamped target lets the
// camera drift arbitrarily far (or a shared URL place it there). The target is
// therefore boxed around the pattern's working area (hands at y ≈ 1, extents
// well under ±0.5 m for both geometry presets), with room to re-center on any
// hand layout. Tall throws (a legal `z` at slow tempo apexes in the kilometers)
// simply exit the top of frame; the bounds frame the action, not the apexes.

/** Closest the eye may come to the orbit target (m); clears near plane + balls. */
export const CAMERA_MIN_DISTANCE = 0.4;
/** Farthest the eye may recede from the orbit target (m); frames tall patterns. */
export const CAMERA_MAX_DISTANCE = 20;
/** Orbit-target box, minimum corner [x, y, z] (m). y ≥ 0 keeps it above ground. */
export const CAMERA_TARGET_MIN: readonly [number, number, number] = [-2, 0, -2];
/** Orbit-target box, maximum corner [x, y, z] (m). Contains every preset target. */
export const CAMERA_TARGET_MAX: readonly [number, number, number] = [2, 3, 2];

function clampScalar(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Below this eye-to-target distance (m) the viewing direction is numerically
 * meaningless (subnormal offsets normalize badly), so the pose is treated as
 * degenerate and rebuilt on the front preset's +z axis at the min distance.
 */
const DEGENERATE_DISTANCE = 1e-6;

/**
 * Clamp a camera view to the scene bounds: the target into the
 * {@link CAMERA_TARGET_MIN}/{@link CAMERA_TARGET_MAX} box, then the eye onto the
 * same viewing ray at a distance within [{@link CAMERA_MIN_DISTANCE},
 * {@link CAMERA_MAX_DISTANCE}] (direction preserved). A degenerate eye ≈ target
 * falls back to the front preset's +z viewing axis at the min distance so the
 * result is always a valid finite pose. In-bounds views (every preset) are
 * returned unchanged, so applying a preset or a well-formed shared URL is
 * exactly the identity.
 */
export function clampCameraView(view: CameraView): CameraView {
  const target: readonly [number, number, number] = [
    clampScalar(view.target[0], CAMERA_TARGET_MIN[0], CAMERA_TARGET_MAX[0]),
    clampScalar(view.target[1], CAMERA_TARGET_MIN[1], CAMERA_TARGET_MAX[1]),
    clampScalar(view.target[2], CAMERA_TARGET_MIN[2], CAMERA_TARGET_MAX[2]),
  ];
  const dx = view.position[0] - target[0];
  const dy = view.position[1] - target[1];
  const dz = view.position[2] - target[2];
  const distance = Math.hypot(dx, dy, dz);
  const targetUnchanged =
    target[0] === view.target[0] && target[1] === view.target[1] && target[2] === view.target[2];
  if (targetUnchanged && distance >= CAMERA_MIN_DISTANCE && distance <= CAMERA_MAX_DISTANCE) {
    return view; // in bounds — exact identity (presets, well-formed URLs)
  }
  if (distance < DEGENERATE_DISTANCE) {
    // Eye (nearly) on the target: no usable direction — front axis, min distance.
    return { position: [target[0], target[1], target[2] + CAMERA_MIN_DISTANCE], target };
  }
  // Rescale via the normalized direction (never a raw scale factor, which
  // overflows for subnormal distances): eye = target + unit · clampedDistance.
  const clampedDistance = clampScalar(distance, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE);
  const unitX = dx / distance;
  const unitY = dy / distance;
  const unitZ = dz / distance;
  return {
    position: [
      target[0] + unitX * clampedDistance,
      target[1] + unitY * clampedDistance,
      target[2] + unitZ * clampedDistance,
    ],
    target,
  };
}
