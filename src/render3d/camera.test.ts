import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_DISTANCE,
  CAMERA_PRESETS,
  CAMERA_PRESET_LABELS,
  CAMERA_TARGET_MAX,
  CAMERA_TARGET_MIN,
  clampCameraView,
  presetView,
  type CameraPreset,
  type CameraView,
} from './camera';

// Pure preset geometry — testable without a Canvas (the Phase 4 jsdom/WebGL
// caution). Presets are tuned for hands near y ≈ 1.0 (NOTATION.md).

describe('camera presets (render3d layer)', () => {
  it('exposes the four DESIGN.md §6 presets with full-word labels', () => {
    expect([...CAMERA_PRESETS]).toEqual(['front', 'side', 'top', 'juggler']);
    expect(CAMERA_PRESET_LABELS.juggler).toBe('Juggler POV');
    for (const preset of CAMERA_PRESETS) {
      expect(CAMERA_PRESET_LABELS[preset].length).toBeGreaterThan(0);
    }
  });

  it('returns a finite eye + target for every preset', () => {
    for (const preset of CAMERA_PRESETS) {
      const view = presetView(preset);
      for (const value of [...view.position, ...view.target]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('front looks down +z at the centered working area', () => {
    const view = presetView('front');
    expect(view.position[2]).toBeGreaterThan(0); // eye in front (+z)
    expect(view.target[0]).toBeCloseTo(0, 9); // centered on x
    expect(view.target[1]).toBeGreaterThan(1); // a touch above hand height
  });

  it('side looks along +x (profile view)', () => {
    const view = presetView('side');
    expect(view.position[0]).toBeGreaterThan(0);
    expect(Math.abs(view.position[2])).toBeLessThan(0.01);
  });

  it('top looks straight down from well above the pattern', () => {
    const view = presetView('top');
    const others: CameraPreset[] = ['front', 'side', 'juggler'];
    for (const other of others) {
      expect(view.position[1]).toBeGreaterThan(presetView(other).position[1]);
    }
    expect(view.position[1]).toBeGreaterThan(view.target[1]);
  });

  it('juggler POV sits behind the pattern (−z) at hand height', () => {
    const view = presetView('juggler');
    expect(view.position[2]).toBeLessThan(0); // behind the balls
    expect(view.position[1]).toBeGreaterThan(0.7); // near hand height y ≈ 1
    expect(view.position[1]).toBeLessThan(1.4);
    expect(view.target[2]).toBeGreaterThan(view.position[2]); // looks forward (+z)
  });
});

// --- Camera bounds (clampCameraView) -----------------------------------------

/** Eye-to-target distance of a view. */
function distanceOf(view: CameraView): number {
  return Math.hypot(
    view.position[0] - view.target[0],
    view.position[1] - view.target[1],
    view.position[2] - view.target[2],
  );
}

describe('clampCameraView (camera bounds)', () => {
  it('is the exact identity on every preset (presets never fight the clamp)', () => {
    for (const preset of CAMERA_PRESETS) {
      const view = presetView(preset);
      expect(clampCameraView(view)).toBe(view);
    }
  });

  it('boxes an out-of-bounds target (the pan / shared-URL escape)', () => {
    const wandered: CameraView = { position: [0, 1002, 3], target: [50, 1000, -7] };
    const clamped = clampCameraView(wandered);
    expect(clamped.target).toEqual([
      CAMERA_TARGET_MAX[0],
      CAMERA_TARGET_MAX[1],
      CAMERA_TARGET_MIN[2],
    ]);
  });

  it('pulls a far eye in to the max distance, preserving the viewing direction', () => {
    const far: CameraView = { position: [0, 1.35, 500], target: [0, 1.35, 0] };
    const clamped = clampCameraView(far);
    expect(distanceOf(clamped)).toBeCloseTo(CAMERA_MAX_DISTANCE, 9);
    // Direction preserved: still looking down +z at the same target.
    expect(clamped.target).toEqual([0, 1.35, 0]);
    expect(clamped.position[0]).toBeCloseTo(0, 9);
    expect(clamped.position[1]).toBeCloseTo(1.35, 9);
    expect(clamped.position[2]).toBeCloseTo(CAMERA_MAX_DISTANCE, 9);
  });

  it('pushes a too-close eye out to the min distance along the same ray', () => {
    const near: CameraView = { position: [0.1, 1.35, 0], target: [0, 1.35, 0] };
    const clamped = clampCameraView(near);
    expect(distanceOf(clamped)).toBeCloseTo(CAMERA_MIN_DISTANCE, 9);
    expect(clamped.position[0]).toBeCloseTo(CAMERA_MIN_DISTANCE, 9); // ray = +x
    expect(clamped.position[1]).toBeCloseTo(1.35, 9);
    expect(clamped.position[2]).toBeCloseTo(0, 9);
  });

  it('yields a finite valid pose for the degenerate eye == target', () => {
    const degenerate: CameraView = { position: [1, 2, 1], target: [1, 2, 1] };
    const clamped = clampCameraView(degenerate);
    for (const value of [...clamped.position, ...clamped.target]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(distanceOf(clamped)).toBeCloseTo(CAMERA_MIN_DISTANCE, 9);
  });

  it('property: any finite view clamps to an in-box target and an in-range distance', () => {
    const coord = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
    const viewArb: fc.Arbitrary<CameraView> = fc.record({
      position: fc.tuple(coord, coord, coord),
      target: fc.tuple(coord, coord, coord),
    });
    fc.assert(
      fc.property(viewArb, (view) => {
        const clamped = clampCameraView(view);
        for (let axis = 0; axis < 3; axis++) {
          expect(clamped.target[axis]!).toBeGreaterThanOrEqual(CAMERA_TARGET_MIN[axis]!);
          expect(clamped.target[axis]!).toBeLessThanOrEqual(CAMERA_TARGET_MAX[axis]!);
          expect(Number.isFinite(clamped.position[axis]!)).toBe(true);
        }
        // Distance tolerance: rescaling a very long/short ray loses a few ulps.
        const distance = distanceOf(clamped);
        expect(distance).toBeGreaterThanOrEqual(CAMERA_MIN_DISTANCE * (1 - 1e-9));
        expect(distance).toBeLessThanOrEqual(CAMERA_MAX_DISTANCE * (1 + 1e-9));
        // Idempotent to FP precision: re-clamping never walks the pose away.
        const twice = clampCameraView(clamped);
        expect(twice.target).toEqual(clamped.target);
        for (let axis = 0; axis < 3; axis++) {
          expect(Math.abs(twice.position[axis]! - clamped.position[axis]!)).toBeLessThanOrEqual(
            1e-9 * Math.max(1, Math.abs(clamped.position[axis]!)),
          );
        }
      }),
    );
  });
});
