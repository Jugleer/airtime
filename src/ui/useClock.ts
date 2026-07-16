// src/ui/useClock — the single wall-clock loop that drives the store's simTime.
//
// This is the ONLY place in the app that reads the wall clock (DESIGN.md §2: the
// rAF / performance.now coupling is allowed in ui/state, banned only in core, and
// kept in one place). One requestAnimationFrame loop measures wall-time deltas and
// hands them to the store's `tick`; the store decides whether to advance simTime
// (it only does while `playing`). Playback speed is applied inside `tick`.

import { useEffect } from 'react';
import { useAppStore } from '../state';

/**
 * Upper bound on a single frame's advance (s). A hidden tab pauses rAF, so the
 * first callback after the tab is refocused reports the ENTIRE away-time (seconds
 * to hours) as one delta. Unclamped, that lurches simTime forward and forces a
 * massive synchronous horizon extension — which can exceed the extension guard and
 * spiral (every subsequent frame re-attempts it), freezing / OOM-crashing the tab.
 * Clamping means a return simply RESUMES from where playback was (the correct
 * behaviour for a scrubbable visualizer — it does not fast-forward while hidden).
 * 0.1 s is far above any real frame (even ~10 fps) yet far below any background gap.
 */
const MAX_TICK_DELTA_SECONDS = 0.1;

/** Mount once (in <App>) to run the global clock while the app is open. */
export function useClock(): void {
  useEffect(() => {
    // Guard for non-browser test environments without requestAnimationFrame.
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }
    let frame = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const wallDeltaSeconds = Math.min((now - last) / 1000, MAX_TICK_DELTA_SECONDS);
      last = now;
      // Read the action fresh each frame; zustand actions are stable but this
      // also keeps the closure free of stale state.
      useAppStore.getState().tick(wallDeltaSeconds);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
}
