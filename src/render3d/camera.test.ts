import { describe, expect, it } from 'vitest';
import {
  CAMERA_PRESETS,
  CAMERA_PRESET_LABELS,
  presetView,
  type CameraPreset,
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
