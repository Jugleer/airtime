// src/render3d/captureBridge — a non-reactive bridge exposing the live r3f render
// handles (renderer, scene, camera, the manual `advance` step, frameloop control)
// to the offline exporter (src/export/capture). It mirrors ./sceneBridge: the
// scene registers into it, the plain-DOM exporter reads it on demand, and it holds
// nothing serialized — transient wiring cleared when the scene unmounts.
//
// The exporter needs to DRIVE the render loop frame-by-frame (set sim time → run
// the frame callbacks that move the balls → grab pixels), which only the r3f root
// store can do; this is the "small hook to reach the gl/scene handles" the
// orchestration fence allows in render3d. Kept minimal + allocation-free.

import type { Camera, Scene, WebGLRenderer } from 'three';

/** The subset of r3f's RootState the capture loop drives (structurally compatible). */
export interface CaptureRootState {
  readonly gl: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  /** Run one render-loop step: fires every useFrame subscriber, then renders. */
  readonly advance: (timestamp: number, runGlobalEffects?: boolean) => void;
  /** Switch the render loop mode (we pin it to 'never' while stepping manually). */
  readonly setFrameloop: (frameloop: 'always' | 'demand' | 'never') => void;
  readonly frameloop: 'always' | 'demand' | 'never';
}

let getRootState: (() => CaptureRootState) | null = null;

/** The scene registers r3f's `get` (its store getState) here; null clears on unmount. */
export function setCaptureRoot(getter: (() => CaptureRootState) | null): void {
  getRootState = getter;
}

/** The live r3f render handles for offline capture, or null when the scene is unmounted. */
export function getCaptureRoot(): CaptureRootState | null {
  return getRootState === null ? null : getRootState();
}
