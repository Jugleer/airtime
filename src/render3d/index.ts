import { Vector3 } from 'three';
import type * as ReactThreeFiber from '@react-three/fiber';
import type * as Drei from '@react-three/drei';
import { apexHeight } from '../core/kinematics';

// Public render3d surface (DESIGN.md §6). <Scene> is the main 3D view; the
// camera-preset helpers are pure and unit-tested (the jsdom/WebGL caution keeps
// the Canvas itself out of tests). Ball colors come from state/ballColors via
// useBallColorResolver — the same rule the ladder uses.
export { Scene, type SceneColors } from './Scene';
export { Balls } from './Balls';
export { Tracers } from './Tracers';
export { Hands, HandPaths } from './Hands';
export { HandGizmos } from './HandGizmos';
export { useBallColorResolver } from './useBallColors';
export {
  HAND_CUP_RADIUS_FACTOR,
  HAND_PATH_MAX_PERIOD_BEATS,
  HAND_PATH_PALETTE,
  handCupRadius,
  handPathColor,
  handPathPeriodBeats,
  handPathPointCount,
  handPathStartBeat,
  maxHandPathPoints,
} from './hands';
export {
  GHOST_SPAN_SECONDS,
  TRAIL_SAMPLE_DT,
  maxGhostPoints,
  maxTrailPoints,
  sampleTimeAt,
  trailPointCount,
} from './tracers';
export {
  CAMERA_PRESETS,
  CAMERA_PRESET_LABELS,
  presetView,
  type CameraPreset,
  type CameraView,
} from './camera';
export {
  GIZMO_HIT_RADIUS,
  GIZMO_HOVER_SCALE,
  GIZMO_LABEL_RENDER_ORDER,
  GIZMO_MARKER_RADIUS,
  GIZMO_RENDER_ORDER,
  markerColorOf,
  markerLabel,
} from './gizmos';

// Type-only smoke references kept from Phase 0 so a broken r3f + drei install
// still surfaces at the module level (belt-and-suspenders alongside <Scene>).
export type ReactThreeFiberExports = keyof typeof ReactThreeFiber;
export type DreiExports = keyof typeof Drei;

/** Default throw point for hand 0 at n_h = 2 (DESIGN.md §7): x = +0.10 m, y = 1.00 m, z = 0. */
export function defaultThrowPoint(): Vector3 {
  return new Vector3(0.1, 1.0, 0);
}

/** Sample apex height of a 0.5 s flight (DESIGN.md identity 3), smoke value only. */
export const sampleApexHeight = apexHeight(0.5);
