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
    graphThrowLabels: true,
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

  // --- Draw-layer redesign (graphics designer's spec, 2026-07-12) ---------------
  // Arrowheads are now absolute-size barbed POLYGONS (not stroke-coupled <marker>s),
  // gated on NODE COUNT (≤ 42), not the old backwards node-radius gate.
  const cubicPaths = (container: HTMLElement): Element[] =>
    [...container.querySelectorAll('path')].filter((p) => (p.getAttribute('d') ?? '').includes(' C '));
  const arcPaths = (container: HTMLElement): Element[] =>
    [...container.querySelectorAll('path')].filter((p) => (p.getAttribute('d') ?? '').includes(' Q '));
  const BASE_ARROW_FILL = '#7488a6'; // graphColors.baseArrow (dark theme)

  it('gates base arrowheads on node count ≤ 42 (barbed polygons, not stroke markers)', () => {
    // The old <marker> defs are gone entirely; arrowheads are polygons.
    const { container } = render(<StateGraph />); // '3' → 35 nodes (≤ 42)
    expect(container.querySelector('marker')).toBeNull();
    // 35-node graph is under the density limit → base edges carry a barbed head.
    const baseHeads = [...container.querySelectorAll('polygon')].filter(
      (p) => p.getAttribute('fill') === BASE_ARROW_FILL,
    );
    expect(baseHeads.length).toBeGreaterThan(0);
  });

  it('drops base arrowheads above the density limit (84-node graph), keeping cycle arrows', () => {
    const { container } = render(<StateGraph />);
    act(() => useAppStore.getState().setGraphMaxHeight(9)); // '3' at N=9 → 84 nodes (> 42)
    // No base arrowheads at all; base edges are bare lines.
    const baseHeads = [...container.querySelectorAll('polygon')].filter(
      (p) => p.getAttribute('fill') === BASE_ARROW_FILL,
    );
    expect(baseHeads.length).toBe(0);
    // Cycle arrows (the ground 3-loop) still render (some polygon remains).
    expect(container.querySelectorAll('polygon').length).toBeGreaterThan(0);
  });

  it('draws base self-loops as teardrops (were never drawn before) — pattern 531', () => {
    const { container } = render(<StateGraph />);
    act(() => useAppStore.getState().navigateToPattern('531'));
    // 531 leaves the ground 3-cascade self-loop OFF the cycle → a BASE self-loop, now
    // drawn as a cubic teardrop in the base-edge colour (previously: not drawn at all).
    const loops = cubicPaths(container);
    expect(loops.length).toBe(1);
    expect(loops[0]?.getAttribute('stroke')).toBe('#42546f'); // baseEdge, not cycle blue
  });

  it('splits bidirectional pairs into two opposite arcs (not one overlapping line)', () => {
    // The '3' graph has 6 directed edges with a reverse twin (3 pairs) — each drawn as
    // its own quadratic arc, so both directions read (topological, layout-independent).
    const { container } = render(<StateGraph />);
    expect(arcPaths(container).length).toBe(6);
  });

  it('auto-downgrades throw labels to cycle-only above the density limit', () => {
    // Throw labels default ON. Chips are the only <rect>s in the SVG, so count them.
    const { container } = render(<StateGraph />);
    const sparseChips = container.querySelectorAll('rect').length; // '3' 35 nodes → all throws
    expect(sparseChips).toBeGreaterThan(1);
    act(() => useAppStore.getState().setGraphMaxHeight(9)); // 84 nodes → cycle-only
    const denseChips = container.querySelectorAll('rect').length;
    expect(denseChips).toBeLessThan(sparseChips);
    expect(denseChips).toBe(1); // just the ground 3-loop's cycle label
  });

  it('drops all throw labels when the overlay toggle is off', () => {
    useAppStore.setState({ graphThrowLabels: false });
    const { container } = render(<StateGraph />);
    expect(container.querySelectorAll('rect').length).toBe(0);
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

  it('labels the minimap "click to expand" (owner 2026-07-11, replacing the arrow glyph)', () => {
    useAppStore.setState({ graphVisible: false, graphMinimap: true });
    render(<StateGraph />);
    expect(screen.getByText('click to expand')).toBeTruthy();
    // The old ⤢ arrow glyph is gone.
    expect(screen.queryByText('⤢')).toBeNull();
  });

  it('draws light rim arrows in the minimap but no throw labels or glow (owner req. 2026-07-12)', () => {
    useAppStore.setState({ graphVisible: false, graphMinimap: true });
    const { container } = render(<StateGraph />);
    // Owner said yes to rim arrows for small graphs: barbed polygons show in the box...
    expect(container.querySelectorAll('polygon').length).toBeGreaterThan(0);
    // ...but the minimap stays clean/cheap: no throw-label chips, no soft-glow filter,
    // and (like the overlay) no legacy <marker> defs at all.
    expect(container.querySelectorAll('rect').length).toBe(0);
    expect(container.querySelector('filter')).toBeNull();
    expect(container.querySelector('marker')).toBeNull();
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
