// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { validatePattern } from '../core/siteswap';
import {
  DEFAULT_BALL_RADIUS,
  DEFAULT_BEAT_PERIOD,
  DEFAULT_DWELL_TIME,
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HAND_COUNT,
  DEFAULT_HOLD_DEPTH_VALUE,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_TRAIL_LENGTH,
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
    theme: 'dark',
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

  it('hints that synchronous/multiplex/passing notation is unsupported', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)');
    // A valid vanilla pattern: no unsupported-notation note.
    expect(screen.queryByText(/aren.t supported yet/i)).toBeNull();
    // Synchronous notation triggers the friendly nudge (alongside the parse error).
    fireEvent.change(input, { target: { value: '(4,4)' } });
    expect(screen.getByText(/aren.t supported yet/i)).toBeTruthy();
    // Multiplex too.
    fireEvent.change(input, { target: { value: '[33]' } });
    expect(screen.getByText(/aren.t supported yet/i)).toBeTruthy();
    // But a high vanilla throw using a letter (x = 33) is NOT flagged.
    fireEvent.change(input, { target: { value: '3x' } });
    expect(screen.queryByText(/aren.t supported yet/i)).toBeNull();
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

// Draft pattern entry (redesign 2026-07-11): typing edits a local draft and the
// running sim only changes on Enter or the Go button. Escape reverts; external
// changes (library pick) re-seed the input.
describe('Controls draft pattern entry', () => {
  it('does not apply a typed pattern until Enter (the sim keeps running)', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '531' } });
    // Draft echoes the typed text but the sim is untouched.
    expect(input.value).toBe('531');
    expect(useAppStore.getState().sim.patternText).toBe('3');
    // Enter applies it through navigation.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAppStore.getState().sim.patternText).toBe('531');
  });

  it('applies the draft when the Go button is clicked', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)');
    fireEvent.change(input, { target: { value: '441' } });
    expect(useAppStore.getState().sim.patternText).toBe('3'); // not yet applied
    fireEvent.click(screen.getByRole('button', { name: 'Apply pattern' }));
    expect(useAppStore.getState().sim.patternText).toBe('441');
  });

  it('reverts the draft to the running pattern on Escape', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '52' } });
    expect(input.value).toBe('52');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('3');
    expect(useAppStore.getState().sim.patternText).toBe('3');
  });

  it('syncs the input when the pattern changes externally (library pick)', () => {
    render(<Controls />);
    const input = screen.getByLabelText('Pattern (siteswap)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '52' } }); // a dirty, unapplied draft
    fireEvent.change(screen.getByLabelText('Pattern library'), { target: { value: '441' } });
    // The pick applies immediately and re-seeds the input.
    expect(useAppStore.getState().sim.patternText).toBe('441');
    expect(input.value).toBe('441');
  });

  it('groups the library dropdown by ball count', () => {
    render(<Controls />);
    const select = screen.getByLabelText('Pattern library');
    const groups = select.querySelectorAll('optgroup');
    const labels = [...groups].map((group) => group.getAttribute('label'));
    expect(labels).toContain('2 balls');
    expect(labels).toContain('7 balls');
  });
});

// Reset-to-defaults (redesign 2026-07-11): per-control ↺ and a section "Reset all".
describe('Controls reset-to-defaults', () => {
  it('per-control ↺ restores a physics default and hides the affordance', () => {
    render(<Controls />);
    act(() => useAppStore.getState().setGravity(4));
    expect(useAppStore.getState().gravity).toBeCloseTo(4, 9);
    fireEvent.click(screen.getByLabelText('Reset Gravity'));
    expect(useAppStore.getState().gravity).toBeCloseTo(DEFAULT_GRAVITY_VALUE, 9);
    expect(screen.queryByLabelText('Reset Gravity')).toBeNull();
  });

  it('Reset all restores the whole Tempo & physics group', () => {
    render(<Controls />);
    act(() => {
      useAppStore.getState().setBeatPeriod(0.5);
      useAppStore.getState().setGravity(3);
      useAppStore.getState().setHoldDepth(0.3);
      useAppStore.getState().setCarryPathKind('cubic');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all tempo and physics' }));
    const state = useAppStore.getState();
    expect(state.beatPeriod).toBeCloseTo(DEFAULT_BEAT_PERIOD, 9);
    expect(state.dwellTime).toBeCloseTo(DEFAULT_DWELL_TIME, 9);
    expect(state.gravity).toBeCloseTo(DEFAULT_GRAVITY_VALUE, 9);
    expect(state.holdDepth).toBeCloseTo(DEFAULT_HOLD_DEPTH_VALUE, 9);
    expect(state.carryPathKind).toBe('quintic');
  });
});

// The View group + theme moved from the deleted Settings drawer into the sidebar
// (2026-07-11 owner requirement: no Settings menu). These are the relocated Settings
// assertions — now always visible, no drawer to open first (an honest relocation).
describe('Controls view group (relocated from Settings)', () => {
  it('exposes the view controls always-visible in the sidebar', () => {
    render(<Controls />);
    expect(screen.getByLabelText('Playback speed')).toBeTruthy();
    expect(screen.getByLabelText('Ball radius')).toBeTruthy();
    expect(screen.getByLabelText('Ball color')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
  });

  it('toggles per-ball coloring through the store', () => {
    render(<Controls />);
    const toggle = screen.getByLabelText('Colour balls individually');
    expect(useAppStore.getState().orbitColoring).toBe(false); // fixture baseline
    fireEvent.click(toggle);
    expect(useAppStore.getState().orbitColoring).toBe(true);
  });

  it('switches the theme (dark ↔ light) through the store', () => {
    render(<Controls />);
    expect(useAppStore.getState().theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Light' }));
    expect(useAppStore.getState().theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    expect(useAppStore.getState().theme).toBe('dark');
  });
});

describe('Controls view reset-to-defaults', () => {
  it('per-control ↺ restores a view default and hides the affordance', () => {
    render(<Controls />);
    act(() => useAppStore.getState().setBallRadius(0.08));
    fireEvent.click(screen.getByLabelText('Reset Ball radius'));
    expect(useAppStore.getState().ballRadius).toBeCloseTo(DEFAULT_BALL_RADIUS, 9);
    expect(screen.queryByLabelText('Reset Ball radius')).toBeNull();
  });

  it('Reset all restores the whole View group', () => {
    render(<Controls />);
    act(() => {
      useAppStore.getState().setBallRadius(0.08);
      useAppStore.getState().setPlaybackSpeed(1.5);
      useAppStore.getState().setTrailLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all view settings' }));
    const state = useAppStore.getState();
    expect(state.ballRadius).toBeCloseTo(DEFAULT_BALL_RADIUS, 9);
    expect(state.playbackSpeed).toBeCloseTo(DEFAULT_PLAYBACK_SPEED, 9);
    expect(state.trailLength).toBeCloseTo(DEFAULT_TRAIL_LENGTH, 9);
  });
});
