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
