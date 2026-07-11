// src/render3d/displayFrame — the user-facing coordinate frame (owner decision,
// 2026-07-11). The core sim and three.js stay natively y-up (CLAUDE.md hard rule);
// this module is the ONE place that maps between that internal sim frame and the
// right-handed, Z-UP display frame every user-facing surface speaks (the axis
// triad, Controls' axis labels, any coordinate readout).
//
// Pure: plain tuple math, no three.js and no React — unit-testable without a
// Canvas (round-trip + handedness), like ./camera and ./gizmos.
//
// The frame (owner-ratified):
//   display X = sim x   — the line the hands sit along (left ↔ right)
//   display Y = −sim z  — front ↔ back (sign chosen to keep the frame right-handed)
//   display Z = sim y   — up (vertical)
//
// Why display Y = −sim z and not +sim z: with display X = sim x and display Z =
// sim y fixed, right-handedness (X × Y = Z) forces display Y onto −sim z —
//   sim x × (−sim z) = −(sim x × sim z) = −(−sim y) = sim y = display Z.
// (+sim z would give a left-handed frame.) The mapping is a proper rotation
// (determinant +1), so it preserves orientation/handedness — verified in the test.

// A 3-vector as an [x, y, z] tuple (frame-agnostic; the functions carry meaning).
// Defined once in core/math and re-exported here so existing importers keep working.
import type { Vec3Tuple } from '../core/math';
export type { Vec3Tuple };

/** Map a sim-frame (y-up) vector or point to the display frame (right-handed Z-up). */
export function simToDisplay([x, y, z]: Vec3Tuple): [number, number, number] {
  return [x, -z, y];
}

/** Map a display-frame (right-handed Z-up) vector or point back to the sim frame (y-up). */
export function displayToSim([x, y, z]: Vec3Tuple): [number, number, number] {
  return [x, z, -y];
}

/** The display-frame axis names, in order. */
export type DisplayAxisName = 'X' | 'Y' | 'Z';

/** One display axis: its label, color, and the SIM-frame direction it points along. */
export interface DisplayAxis {
  /** Axis label shown on the triad / in readouts. */
  readonly name: DisplayAxisName;
  /** Axis color (conventional: X red, Y green, Z blue). */
  readonly color: string;
  /**
   * The direction, expressed in the SIM (three.js world, y-up) frame, that this
   * display axis points along — i.e. `displayToSim` of the display unit axis (the
   * code below builds each with `displayToSim`). The triad draws each arrow along
   * this world direction so it renders correctly in the natively-y-up scene while
   * labeling the display convention.
   */
  readonly simDirection: Vec3Tuple;
}

/** Conventional axis colors (X red, Y green, Z blue) — shared by the triad + labels. */
export const DISPLAY_AXIS_COLORS: Record<DisplayAxisName, string> = {
  X: '#e5484d', // red
  Y: '#30a46c', // green
  Z: '#4c8bf5', // blue
};

/**
 * The three display axes with their sim-frame directions. Ordering is X, Y, Z.
 * `simDirection` = simToDisplay-inverse of the display unit axis, i.e. where the
 * display axis points in the y-up world:
 *   display +X → sim (+1, 0, 0)   (right, along the hand line)
 *   display +Y → sim ( 0, 0, −1)  (toward the front / audience)
 *   display +Z → sim ( 0, 1, 0)   (up)
 */
export const DISPLAY_AXES: readonly DisplayAxis[] = [
  { name: 'X', color: DISPLAY_AXIS_COLORS.X, simDirection: displayToSim([1, 0, 0]) },
  { name: 'Y', color: DISPLAY_AXIS_COLORS.Y, simDirection: displayToSim([0, 1, 0]) },
  { name: 'Z', color: DISPLAY_AXIS_COLORS.Z, simDirection: displayToSim([0, 0, 1]) },
];
