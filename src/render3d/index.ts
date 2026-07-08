import { Vector3 } from 'three';
import type * as ReactThreeFiber from '@react-three/fiber';
import type * as Drei from '@react-three/drei';
import { apexHeight } from '../core/kinematics';

// Phase 0 placeholder (DESIGN.md §2 "src/render3d", §6 3D scene). The r3f scene,
// balls, tracers, ghosts and camera arrive from Phase 4. These type-only smoke
// references make the toolchain resolve r3f + drei now, so a broken install
// surfaces in Phase 0 rather than mid-Phase-4.
export type ReactThreeFiberExports = keyof typeof ReactThreeFiber;
export type DreiExports = keyof typeof Drei;

/** Default throw point for hand 0 at n_h = 2 (DESIGN.md §7): x = +0.10 m, y = 1.00 m, z = 0. */
export function defaultThrowPoint(): Vector3 {
  return new Vector3(0.1, 1.0, 0);
}

/** Sample apex height of a 0.5 s flight (DESIGN.md identity 3), smoke value only. */
export const sampleApexHeight = apexHeight(0.5);
