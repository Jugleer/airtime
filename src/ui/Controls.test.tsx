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

  it('toggles play/pause through the store', () => {
    render(<Controls />);
    // Starts playing → button reads "Pause".
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useAppStore.getState().playing).toBe(false);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('renders the ball-count readout for a valid pattern', () => {
    render(<Controls />);
    expect(screen.getByText(/3 balls/)).toBeTruthy();
  });

  it('exposes the 3D scene controls and toggles orbit coloring through the store', () => {
    render(<Controls />);
    expect(screen.getByLabelText('Ball radius')).toBeTruthy();
    expect(screen.getByLabelText('Ball color')).toBeTruthy();

    const toggle = screen.getByLabelText('Orbit coloring');
    expect(useAppStore.getState().orbitColoring).toBe(false);
    fireEvent.click(toggle);
    expect(useAppStore.getState().orbitColoring).toBe(true);
  });

  it('exposes the runtime physics sliders (gravity, hold depth) distinct from playback', () => {
    render(<Controls />);
    expect(screen.getByLabelText('Gravity')).toBeTruthy();
    expect(screen.getByLabelText('Hold depth')).toBeTruthy();
    // Tempo and playback speed are in separately labeled sections.
    expect(screen.getByText('Tempo & physics')).toBeTruthy();
    expect(screen.getByText('Playback speed & view')).toBeTruthy();
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
