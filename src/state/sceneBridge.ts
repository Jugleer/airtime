// src/state/sceneBridge — a non-reactive bridge between the 3D scene and the
// save/share features (DESIGN.md §6). The live camera (a user free-orbits without
// touching the store) and the WebGL canvas element live inside the r3f <Canvas>;
// the "Copy share link" and "Save PNG" buttons live in the plain-DOM UI. This
// module holds those two runtime handles so the UI can read them ON DEMAND without
// the store re-rendering every frame and without the state layer importing
// render3d (the scene registers into here; the direction stays render3d → state).
//
// Nothing here is serialized or part of the store: it is transient wiring, cleared
// when the scene unmounts.

import type { CameraPose } from './codec';

type CameraSampler = () => CameraPose;

let cameraSampler: CameraSampler | null = null;
let canvasElement: HTMLCanvasElement | null = null;

/** The scene registers a getter for the live camera pose (null to clear on unmount). */
export function setCameraSampler(sampler: CameraSampler | null): void {
  cameraSampler = sampler;
}

/**
 * The current camera pose: the live OrbitControls view when the scene is mounted,
 * else `fallback` (the store's cameraView — e.g. in tests with no Canvas).
 */
export function sampleCamera(fallback: CameraPose): CameraPose {
  if (cameraSampler === null) {
    return fallback;
  }
  try {
    return cameraSampler();
  } catch {
    return fallback;
  }
}

/** The scene registers its WebGL canvas element (null to clear on unmount). */
export function setCanvasElement(element: HTMLCanvasElement | null): void {
  canvasElement = element;
}

/** The WebGL canvas element for PNG capture, or null when the scene is unmounted. */
export function getCanvasElement(): HTMLCanvasElement | null {
  return canvasElement;
}
