// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { formatState, groundState } from '../core/stategraph';
import {
  DEFAULT_BEAT_PERIOD,
  DEFAULT_DWELL_TIME,
  DEFAULT_GRAPH_MAX_HEIGHT,
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HAND_COUNT,
  DEFAULT_HOLD_DEPTH_VALUE,
  carryPathOf,
  presetGeometry,
  sampleHandPoints,
  useAppStore,
} from '../state';
import { StateGraph } from './StateGraph';

beforeEach(() => {
  const geometry = presetGeometry('line', DEFAULT_HAND_COUNT);
  const points = sampleHandPoints(geometry, DEFAULT_HAND_COUNT);
  useAppStore.setState({
    simTime: 0,
    playing: true,
    epochs: [],
    handCount: DEFAULT_HAND_COUNT,
    beatPeriod: DEFAULT_BEAT_PERIOD,
    dwellTime: DEFAULT_DWELL_TIME,
    gravity: DEFAULT_GRAVITY_VALUE,
    holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
    carryPathKind: 'quintic',
    handPreset: 'line',
    handThrowPoints: points.throwPoints,
    handCatchPoints: points.catchPoints,
    baseParams: {
      beatPeriod: DEFAULT_BEAT_PERIOD,
      dwellTime: DEFAULT_DWELL_TIME,
      handCount: DEFAULT_HAND_COUNT,
    },
    baseKinematics: {
      gravity: DEFAULT_GRAVITY_VALUE,
      holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
      carryPath: carryPathOf('quintic'),
      geometry,
    },
    kinematicsEpochs: [],
    graphMaxHeight: DEFAULT_GRAPH_MAX_HEIGHT,
    graphVisible: true,
    transition: null,
    graphNotice: null,
  });
  act(() => {
    useAppStore.getState().navigateToPattern('3');
    useAppStore.getState().hardReset(); // clean periodic '3' at t = 0
  });
});
afterEach(cleanup);

describe('StateGraph panel (ui layer)', () => {
  it('renders the collapsible panel with N stepper, hard reset, and the graph SVG', () => {
    render(<StateGraph />);
    expect(screen.getByText('State graph')).toBeTruthy();
    expect(screen.getByLabelText('Max throw N').textContent).toBe(
      String(DEFAULT_GRAPH_MAX_HEIGHT),
    );
    expect(screen.getByLabelText('Hard reset')).toBeTruthy();
    // C(7,3) = 35 state nodes, each a clickable circle.
    const ground = formatState(groundState(3), DEFAULT_GRAPH_MAX_HEIGHT);
    expect(screen.getByLabelText(`State ${ground}`)).toBeTruthy();
    expect(screen.getAllByLabelText(/^State [01]+$/)).toHaveLength(35);
    // The marker sits on the ground state at t = 0.
    expect(screen.getByLabelText('Current state marker')).toBeTruthy();
    // On the pattern, the status line names it.
    expect(screen.getByRole('status').textContent).toContain('on pattern 3');
  });

  it('collapses the body via the toggle (nothing derived or drawn)', () => {
    render(<StateGraph />);
    fireEvent.click(screen.getByLabelText('Toggle state graph panel'));
    expect(useAppStore.getState().graphVisible).toBe(false);
    expect(screen.queryByLabelText('Current state marker')).toBeNull();
    fireEvent.click(screen.getByLabelText('Toggle state graph panel'));
    expect(screen.getByLabelText('Current state marker')).toBeTruthy();
  });

  it('clicking a bare state navigates: transition status + new running pattern', () => {
    render(<StateGraph />);
    // 10101 (padded to N = 7) is a 3-ball state off the cascade's cycle.
    const label = '1010100';
    fireEvent.click(screen.getByLabelText(`State ${label}`));
    const state = useAppStore.getState();
    expect(state.sim.patternText).not.toBe('3');
    expect(state.transition).not.toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/transitioning to .* \(\d+ beats?\)/);
  });

  it('steps N and shows the density warning at N ≥ 9', () => {
    render(<StateGraph />);
    expect(screen.queryByText(/grows combinatorially/)).toBeNull();
    const increase = screen.getByLabelText('Max throw N increase');
    fireEvent.click(increase); // 8
    fireEvent.click(increase); // 9
    expect(useAppStore.getState().graphMaxHeight).toBe(9);
    expect(screen.getByText(/grows combinatorially/)).toBeTruthy();
  });

  it('shows the unavailable notice for a pattern beyond the graph cap', () => {
    render(<StateGraph />);
    act(() => {
      useAppStore.getState().navigateToPattern('c'); // max throw 12 > 11
    });
    expect(screen.getByText(/unavailable for this pattern \(max throw 12/)).toBeTruthy();
    expect(screen.queryByLabelText('Current state marker')).toBeNull();
    // The store notice (hard reset) is surfaced too.
    expect(useAppStore.getState().graphNotice).toMatch(/unavailable/i);
  });

  it('hard reset button restarts clean at t = 0', () => {
    render(<StateGraph />);
    act(() => {
      useAppStore.setState({ simTime: 1.2 });
      useAppStore.getState().navigateToPattern('51');
    });
    expect(useAppStore.getState().sim.schedule).toBeDefined();
    fireEvent.click(screen.getByLabelText('Hard reset'));
    const state = useAppStore.getState();
    expect(state.simTime).toBe(0);
    expect(state.transition).toBeNull();
    expect(state.sim.schedule).toBeUndefined();
  });

  it('a Close button dismisses the open overlay', () => {
    render(<StateGraph />); // beforeEach opens the overlay
    expect(screen.getByLabelText('Current state marker')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close state graph'));
    expect(useAppStore.getState().graphVisible).toBe(false);
    expect(screen.queryByLabelText('Current state marker')).toBeNull();
  });
});

describe('StateGraph minimap (always-visible corner preview)', () => {
  it('shows a non-interactive minimap when the overlay is closed and expands on click', () => {
    useAppStore.setState({ graphVisible: false, graphMinimap: true });
    render(<StateGraph />);
    // The overlay controls are gone; the minimap + its own marker are present.
    expect(screen.queryByLabelText('Max throw N')).toBeNull();
    expect(screen.queryByLabelText('Current state marker')).toBeNull();
    expect(screen.getByLabelText('State graph minimap')).toBeTruthy();
    expect(screen.getByLabelText('State minimap marker')).toBeTruthy();
    // The minimap draws no interactive per-node buttons (labels off, non-interactive).
    expect(screen.queryAllByLabelText(/^State [01]+$/)).toHaveLength(0);
    // Clicking it opens the full overlay.
    fireEvent.click(screen.getByLabelText('Expand state graph'));
    expect(useAppStore.getState().graphVisible).toBe(true);
    expect(screen.getByLabelText('Max throw N')).toBeTruthy();
  });

  it('hides the minimap entirely when graphMinimap is off (toggle still opens the overlay)', () => {
    useAppStore.setState({ graphVisible: false, graphMinimap: false });
    render(<StateGraph />);
    expect(screen.queryByLabelText('State graph minimap')).toBeNull();
    expect(screen.queryByLabelText('State minimap marker')).toBeNull();
    // The persistent toggle button still opens the overlay.
    fireEvent.click(screen.getByLabelText('Toggle state graph panel'));
    expect(useAppStore.getState().graphVisible).toBe(true);
  });
});
