// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { validatePattern } from '../core/siteswap';
import {
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HAND_COUNT,
  DEFAULT_HOLD_DEPTH_VALUE,
  carryPathOf,
  presetGeometry,
  sampleHandPoints,
  useAppStore,
} from '../state';
import { Controls } from './Controls';

beforeEach(() => {
  const geometry = presetGeometry('line', DEFAULT_HAND_COUNT);
  const points = sampleHandPoints(geometry, DEFAULT_HAND_COUNT);
  useAppStore.setState({
    simTime: 0,
    playing: true,
    epochs: [],
    orbitColoring: false,
    handCount: DEFAULT_HAND_COUNT,
    gravity: DEFAULT_GRAVITY_VALUE,
    holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
    carryPathKind: 'quintic',
    handPreset: 'line',
    positionsEditorOpen: false,
    handThrowPoints: points.throwPoints,
    handCatchPoints: points.catchPoints,
    baseParams: { beatPeriod: 0.25, dwellTime: 0.3, handCount: DEFAULT_HAND_COUNT },
    baseKinematics: {
      gravity: DEFAULT_GRAVITY_VALUE,
      holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
      carryPath: carryPathOf('quintic'),
      geometry,
    },
    kinematicsEpochs: [],
  });
  useAppStore.getState().setPattern('3');
});
afterEach(cleanup);

describe('Controls (ui layer)', () => {
  it('shows the core beat-accurate error verbatim and keeps the last valid sim', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)');
    fireEvent.change(input, { target: { value: '52' } });

    const parsed = validatePattern('52');
    const expectedMessage = parsed.ok ? '' : (parsed.errors[0]?.message ?? '');
    expect(expectedMessage).not.toBe('');
    expect(screen.getByRole('alert').textContent).toContain(expectedMessage);

    // Invalid input keeps the last valid simulation running (DESIGN.md §6).
    expect(useAppStore.getState().sim.patternText).toBe('3');
  });

  // Redesign 2026-07-10: play/pause + restart moved to ui/Transport (docked in the
  // timeline strip). The store-wiring assertion moved to Transport.test — see there.

  it('renders the ball-count readout for a valid pattern', () => {
    render(<Controls />);
    expect(screen.getByText(/3 balls/)).toBeTruthy();
  });

  // Redesign 2026-07-10: the 3D view controls (ball radius, ball color, per-ball
  // coloring) moved to the Settings drawer. Those assertions moved to Settings.test.

  it('exposes the runtime physics sliders (gravity, hold depth) in the sidebar', () => {
    render(<Controls />);
    expect(screen.getByLabelText('Gravity')).toBeTruthy();
    expect(screen.getByLabelText('Hold depth')).toBeTruthy();
    // Tempo & physics live in the sidebar; playback speed (viewing) lives in
    // Settings — the two are never on the same panel (see Settings.test).
    expect(screen.getByText('Tempo & physics')).toBeTruthy();
  });

  it('steps the hand count through the store (full rebuild)', () => {
    render(<Controls />);
    expect(useAppStore.getState().handCount).toBe(2);
    fireEvent.click(screen.getByLabelText('Hand count increase'));
    expect(useAppStore.getState().handCount).toBe(3);
    expect(useAppStore.getState().sim.kinematics.handCount).toBe(3);
  });

  it('toggles the carry path to the cubic comparison and shows the caveat note', () => {
    render(<Controls />);
    fireEvent.click(screen.getByLabelText('Carry path: Cubic'));
    expect(useAppStore.getState().carryPathKind).toBe('cubic');
    expect(screen.getByText(/velocity-matched only/i)).toBeTruthy();
  });

  it('opens the hand-positions editor, exposing the numeric x/z table', () => {
    render(<Controls />);
    expect(screen.queryByLabelText('Hand 0 catch x')).toBeNull();
    fireEvent.click(screen.getByLabelText('Edit hand positions'));
    expect(useAppStore.getState().positionsEditorOpen).toBe(true);
    expect(screen.getByLabelText('Hand 0 catch x')).toBeTruthy();
  });

  it('shows the held-2 note only when a 2-pattern runs at a non-2 hand count', () => {
    render(<Controls />);
    // Default (3 at n_h = 2): no note.
    expect(screen.queryByText(/Held 2s are only physically meaningful/)).toBeNull();
    // A held 2 at n_h = 3 is the pending case — the note appears.
    act(() => {
      useAppStore.getState().setHandCount(3);
      useAppStore.getState().setPattern('522');
    });
    expect(screen.getByText(/Held 2s are only physically meaningful/)).toBeTruthy();
  });
});
