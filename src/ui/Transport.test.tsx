// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAppStore } from '../state';
import { Transport } from './Transport';

// The play/pause store-wiring assertion moved here from Controls.test when the
// transport was relocated out of the sidebar into the timeline strip (redesign
// 2026-07-10). Same behavior, exercised where the control now lives.
beforeEach(() => {
  useAppStore.setState({ simTime: 0, playing: true });
});
afterEach(cleanup);

describe('Transport (ui layer)', () => {
  it('toggles play/pause through the store', () => {
    render(<Transport />);
    // Starts playing → the button's accessible name is "Pause".
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useAppStore.getState().playing).toBe(false);
    // Now paused → the same button reads "Play".
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('restart rebuilds the sim from the current config at t = 0 (not just a seek)', () => {
    // A mid-flight hand-geometry edit is a future-only epoch (owner ruling 2026-07-11):
    // the store field the markers render from moves now, but the t = 0 base does not.
    act(() => {
      useAppStore.setState({ simTime: 1.0 });
      useAppStore.getState().setHandPoint(0, 'throw', 0.9, 0);
    });
    expect(useAppStore.getState().kinematicsEpochs.length).toBeGreaterThan(0);

    render(<Transport />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

    const after = useAppStore.getState();
    expect(after.simTime).toBe(0);
    // Folded into the base at t = 0 — the balls now fly from exactly the marker.
    expect(after.kinematicsEpochs).toHaveLength(0);
    expect(after.sim.kinematics.geometry.throwPoint(0).x).toBeCloseTo(0.9, 9);
  });
});
