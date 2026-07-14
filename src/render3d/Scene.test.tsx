// @vitest-environment jsdom
// Guards the mobile battery/thermal contract (DESIGN.md §6): the 3D Canvas runs the
// render loop 'always' only while playing, and drops to 'demand' (repaint on request)
// while paused/idle. Scene itself renders a WebGL-less placeholder in jsdom, so the
// frameloop decision is factored into this pure helper to keep it assertable.
import { describe, expect, it } from 'vitest';
import { sceneFrameloop } from './Scene';

describe('sceneFrameloop', () => {
  it('runs the render loop continuously while playing', () => {
    expect(sceneFrameloop(true)).toBe('always');
  });

  it('drops to on-demand repaint while paused (no idle 60Hz redraws)', () => {
    expect(sceneFrameloop(false)).toBe('demand');
  });
});
