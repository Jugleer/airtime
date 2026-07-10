import { beforeEach, describe, expect, it } from 'vitest';
import {
  BALL_RADIUS_MAX,
  BALL_RADIUS_MIN,
  DEFAULT_BALL_COLOR,
  DEFAULT_BALL_RADIUS,
  DEFAULT_BEAT_PERIOD,
  DEFAULT_CHART_AXIS_MODE,
  DEFAULT_CHARTS_VISIBLE,
  DEFAULT_DWELL_TIME,
  DEFAULT_GHOSTS_ENABLED,
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HAND_COUNT,
  DEFAULT_HOLD_DEPTH_VALUE,
  DEFAULT_ORBIT_COLORING,
  DEFAULT_TRAIL_LENGTH,
  GRAVITY_MAX,
  GRAVITY_MIN,
  HOLD_DEPTH_MAX,
  HOLD_DEPTH_MIN,
  TRAIL_LENGTH_MAX,
  TRAIL_LENGTH_MIN,
  carryPathOf,
  dwellCap,
  presetGeometry,
  sampleHandPoints,
  useAppStore,
} from './index';
import {
  DEFAULT_TIMELINE_WINDOW,
  TIMELINE_WINDOW_MAX,
  TIMELINE_WINDOW_MIN,
  buildSimulation,
  horizonTime,
  neededHorizonTime,
  windowSpans,
} from './simulation';
import { validatePattern } from '../core/siteswap';

function valuesOf(text: string): number[] {
  const result = validatePattern(text);
  if (!result.ok) {
    throw new Error(`fixture ${text} invalid`);
  }
  return result.values;
}

// The store is a module singleton; reset it to defaults before each test.
beforeEach(() => {
  useAppStore.setState({
    beatPeriod: DEFAULT_BEAT_PERIOD,
    dwellTime: DEFAULT_DWELL_TIME,
    playbackSpeed: 1,
    handCount: DEFAULT_HAND_COUNT,
    simTime: 0,
    playing: true,
    epochs: [],
    baseParams: {
      beatPeriod: DEFAULT_BEAT_PERIOD,
      dwellTime: DEFAULT_DWELL_TIME,
      handCount: DEFAULT_HAND_COUNT,
    },
  });
  useAppStore.setState({
    ballRadius: DEFAULT_BALL_RADIUS,
    orbitColoring: DEFAULT_ORBIT_COLORING,
    ballColor: DEFAULT_BALL_COLOR,
    timelineWindow: DEFAULT_TIMELINE_WINDOW,
    trailLength: DEFAULT_TRAIL_LENGTH,
    ghostsEnabled: DEFAULT_GHOSTS_ENABLED,
    chartsVisible: DEFAULT_CHARTS_VISIBLE,
    chartAxisMode: DEFAULT_CHART_AXIS_MODE,
  });
  const geometry = presetGeometry('line', DEFAULT_HAND_COUNT);
  const points = sampleHandPoints(geometry, DEFAULT_HAND_COUNT);
  useAppStore.setState({
    gravity: DEFAULT_GRAVITY_VALUE,
    holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
    carryPathKind: 'quintic',
    handThrowPoints: points.throwPoints,
    handCatchPoints: points.catchPoints,
    handPreset: 'line',
    positionsEditorOpen: false,
    baseKinematics: {
      gravity: DEFAULT_GRAVITY_VALUE,
      holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
      carryPath: carryPathOf('quintic'),
      geometry,
    },
    kinematicsEpochs: [],
  });
  useAppStore.getState().setPattern('3'); // rebuild a clean sim from defaults
});

describe('clock', () => {
  it('advances simTime by wallDelta × playbackSpeed while playing', () => {
    useAppStore.setState({ playbackSpeed: 2 });
    useAppStore.getState().tick(0.5);
    expect(useAppStore.getState().simTime).toBeCloseTo(1.0, 9);
  });

  it('freezes simTime while paused', () => {
    useAppStore.getState().tick(0.5);
    const frozen = useAppStore.getState().simTime;
    useAppStore.setState({ playing: false });
    useAppStore.getState().tick(0.5);
    expect(useAppStore.getState().simTime).toBeCloseTo(frozen, 9);
  });

  it('togglePlaying flips the flag; restart zeroes simTime', () => {
    useAppStore.getState().togglePlaying();
    expect(useAppStore.getState().playing).toBe(false);
    useAppStore.setState({ simTime: 3 });
    useAppStore.getState().restart();
    expect(useAppStore.getState().simTime).toBe(0);
  });
});

describe('pattern input', () => {
  it('rebuilds the simulation for a valid pattern', () => {
    useAppStore.getState().setPattern('531');
    const state = useAppStore.getState();
    expect(state.validation.ok).toBe(true);
    expect(state.sim.patternText).toBe('531');
    expect(state.sim.ballCount).toBe(3);
  });

  it('keeps the last valid simulation running when the input is invalid', () => {
    useAppStore.getState().setPattern('531'); // valid baseline
    useAppStore.getState().setPattern('52'); // collision + non-integer average
    const state = useAppStore.getState();
    expect(state.pattern).toBe('52'); // input text reflects what was typed
    expect(state.validation.ok).toBe(false); // error surfaced
    expect(state.sim.patternText).toBe('531'); // sim unchanged
  });
});

describe('slider wiring', () => {
  it('clamps the dwell slider to 0.9·n_h·τ_b', () => {
    useAppStore.getState().setDwellTime(5); // absurdly large
    const cap = dwellCap(DEFAULT_HAND_COUNT, DEFAULT_BEAT_PERIOD);
    expect(useAppStore.getState().dwellTime).toBeCloseTo(cap, 9);
    expect(cap).toBeCloseTo(0.45, 9);
  });

  it('re-clamps dwell when a smaller beat period shrinks the cap', () => {
    useAppStore.getState().setDwellTime(0.4); // fits at τ_b = 0.25 (cap 0.45)
    useAppStore.getState().setBeatPeriod(0.1); // cap becomes 0.9·2·0.1 = 0.18
    expect(useAppStore.getState().dwellTime).toBeCloseTo(0.18, 9);
  });

  it('playback speed changes never rebuild the simulation', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().setPlaybackSpeed(1.75);
    expect(useAppStore.getState().sim).toBe(before);
    expect(useAppStore.getState().playbackSpeed).toBe(1.75);
  });
});

describe('3D scene view settings', () => {
  it('has the DESIGN.md §7 defaults (per-ball coloring ON by owner decision)', () => {
    expect(DEFAULT_BALL_RADIUS).toBeCloseTo(0.035, 9);
    expect(BALL_RADIUS_MIN).toBeCloseTo(0.01, 9);
    expect(BALL_RADIUS_MAX).toBeCloseTo(0.1, 9);
    // Owner decision 2026-07-10: per-ball coloring is the day-to-day default.
    expect(DEFAULT_ORBIT_COLORING).toBe(true);
    const state = useAppStore.getState();
    expect(state.ballRadius).toBeCloseTo(DEFAULT_BALL_RADIUS, 9);
    expect(state.orbitColoring).toBe(true);
    expect(state.ballColor).toBe(DEFAULT_BALL_COLOR);
  });

  it('clamps ball radius to [0.01, 0.1] m', () => {
    useAppStore.getState().setBallRadius(5);
    expect(useAppStore.getState().ballRadius).toBeCloseTo(BALL_RADIUS_MAX, 9);
    useAppStore.getState().setBallRadius(0);
    expect(useAppStore.getState().ballRadius).toBeCloseTo(BALL_RADIUS_MIN, 9);
    useAppStore.getState().setBallRadius(0.05);
    expect(useAppStore.getState().ballRadius).toBeCloseTo(0.05, 9);
  });

  it('toggles per-ball coloring and sets the ball color, never rebuilding the sim', () => {
    const before = useAppStore.getState().sim;
    // Default is ON; the first toggle turns per-ball coloring off.
    useAppStore.getState().toggleOrbitColoring();
    expect(useAppStore.getState().orbitColoring).toBe(false);
    useAppStore.getState().setBallColor('#ff8800');
    expect(useAppStore.getState().ballColor).toBe('#ff8800');
    // View settings are presentation-only (DESIGN.md §2): the sim is untouched.
    expect(useAppStore.getState().sim).toBe(before);
  });
});

describe('runtime parameter epochs (past immutable)', () => {
  it('applies a τ_b change as an epoch at the next beat, leaving the past bit-identical', () => {
    const before = useAppStore.getState().sim;
    const beat2Before = before.timeline.beatTime(2); // 0.5 s on the default grid
    const beat20Before = before.timeline.beatTime(20);

    useAppStore.setState({ simTime: 1.26 }); // between beat 5 (1.25) and beat 6 (1.50)
    useAppStore.getState().setBeatPeriod(0.5);

    const after = useAppStore.getState();
    expect(after.beatPeriod).toBe(0.5);
    expect(after.epochs).toHaveLength(1);
    expect(after.epochs[0]?.beat).toBe(6);
    // Past beats unchanged; future beats spread out (slew toward the larger τ_b).
    expect(after.sim.timeline.beatTime(2)).toBeCloseTo(beat2Before, 12);
    expect(after.sim.timeline.beatTime(20)).toBeGreaterThan(beat20Before);
  });

  it('folds a change at beat 0 into the base params (no epoch)', () => {
    useAppStore.setState({ simTime: 0 });
    useAppStore.getState().setBeatPeriod(0.5);
    const state = useAppStore.getState();
    expect(state.epochs).toHaveLength(0);
    expect(state.baseParams.beatPeriod).toBe(0.5);
  });
});

describe('runtime physics params (kinematics epochs, DESIGN.md §4.6)', () => {
  it('gravity slider clamps to [0.5, 30] and folds into base at beat 0', () => {
    useAppStore.setState({ simTime: 0 });
    useAppStore.getState().setGravity(100);
    expect(useAppStore.getState().gravity).toBe(GRAVITY_MAX);
    useAppStore.getState().setGravity(0);
    expect(useAppStore.getState().gravity).toBe(GRAVITY_MIN);
    useAppStore.getState().setGravity(4.2);
    const state = useAppStore.getState();
    expect(state.gravity).toBeCloseTo(4.2, 9);
    // At beat 0 the change folds into base (no epoch) and the sim reflects it.
    expect(state.kinematicsEpochs).toHaveLength(0);
    expect(state.baseKinematics.gravity).toBeCloseTo(4.2, 9);
    expect(state.sim.kinematics.gravity).toBeCloseTo(4.2, 9);
  });

  it('gravity change while running creates a future-only kinematics epoch (past base intact)', () => {
    const before = useAppStore.getState().sim;
    useAppStore.setState({ simTime: 1.26 }); // between beat 5 (1.25) and beat 6 (1.50)
    useAppStore.getState().setGravity(2);
    const state = useAppStore.getState();
    expect(state.gravity).toBe(2);
    expect(state.kinematicsEpochs).toHaveLength(1);
    // Base gravity (t = 0) stays 9.81 — the change is future-only.
    expect(state.baseKinematics.gravity).toBeCloseTo(DEFAULT_GRAVITY_VALUE, 9);
    expect(state.sim.kinematics.gravity).toBeCloseTo(DEFAULT_GRAVITY_VALUE, 9);
    expect(state.sim).not.toBe(before); // the sim was rebuilt with the epoch
  });

  it('hold-depth slider clamps to [0, 0.4] m', () => {
    useAppStore.setState({ simTime: 0 });
    useAppStore.getState().setHoldDepth(5);
    expect(useAppStore.getState().holdDepth).toBe(HOLD_DEPTH_MAX);
    useAppStore.getState().setHoldDepth(-1);
    expect(useAppStore.getState().holdDepth).toBe(HOLD_DEPTH_MIN);
    useAppStore.getState().setHoldDepth(0.2);
    expect(useAppStore.getState().sim.kinematics.holdDepth).toBeCloseTo(0.2, 9);
  });

  it('carry-path toggle switches the kinematics carry path (quintic ↔ cubic)', () => {
    useAppStore.setState({ simTime: 0 });
    expect(useAppStore.getState().sim.kinematics.carryPath.name).toBe('quintic-via');
    useAppStore.getState().setCarryPathKind('cubic');
    const state = useAppStore.getState();
    expect(state.carryPathKind).toBe('cubic');
    expect(state.sim.kinematics.carryPath.name).toBe('cubic-bezier');
  });
});

describe('hand count + geometry (full rebuild, DESIGN.md §6)', () => {
  it('n_h stepper rebuilds with the new hand count and resets geometry to the preset', () => {
    useAppStore.getState().setHandCount(3);
    const state = useAppStore.getState();
    expect(state.handCount).toBe(3);
    expect(state.baseParams.handCount).toBe(3);
    expect(state.sim.kinematics.handCount).toBe(3);
    // Geometry reset to a 3-hand line preset; kinematics epochs cleared.
    expect(state.handThrowPoints).toHaveLength(3);
    expect(state.handCatchPoints).toHaveLength(3);
    expect(state.kinematicsEpochs).toHaveLength(0);
    // '3' at n_h = 3 still has 3 balls but a different spatial period (period
    // changes hands — the acceptance note).
    expect(state.sim.ballCount).toBe(3);
    expect(state.sim.spatialPeriodBeats).toBe(3);
  });

  it('clamps the hand count to [1, 8]', () => {
    useAppStore.getState().setHandCount(99);
    expect(useAppStore.getState().handCount).toBe(8);
    useAppStore.getState().setHandCount(0);
    expect(useAppStore.getState().handCount).toBe(1);
  });

  it('preset picker rebuilds geometry (line ↔ circle) at the current n_h', () => {
    useAppStore.getState().setHandPreset('circle');
    const state = useAppStore.getState();
    expect(state.handPreset).toBe('circle');
    // Circle preset puts catch points on the r = 0.45 m circle (hypot 0.45),
    // unlike the line preset (catch x = ±0.30, on the x axis).
    const point = state.handCatchPoints[0];
    expect(point).toBeDefined();
    if (point) {
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(0.45, 9);
    }
    expect(state.kinematicsEpochs).toHaveLength(0);
  });

  it('setHandPoint at beat 0 folds the moved point into the base geometry', () => {
    useAppStore.setState({ simTime: 0 });
    useAppStore.getState().setHandPoint(0, 'catch', -0.5, 0.2);
    const state = useAppStore.getState();
    expect(state.handCatchPoints[0]?.x).toBeCloseTo(-0.5, 9);
    expect(state.handCatchPoints[0]?.z).toBeCloseTo(0.2, 9);
    expect(state.handCatchPoints[0]?.y).toBeCloseTo(1.0, 9); // y stays fixed
    expect(state.kinematicsEpochs).toHaveLength(0);
    // The base geometry now reflects the moved catch point.
    expect(state.sim.kinematics.geometry.catchPoint(0).x).toBeCloseTo(-0.5, 9);
  });

  it('setHandPoint while running creates a future-only geometry epoch (base intact)', () => {
    useAppStore.setState({ simTime: 1.26 });
    useAppStore.getState().setHandPoint(1, 'throw', 0.4, 0);
    const state = useAppStore.getState();
    expect(state.handThrowPoints[1]?.x).toBeCloseTo(0.4, 9);
    expect(state.kinematicsEpochs).toHaveLength(1);
    // Base geometry (t = 0) is unchanged — the edit is future-only.
    expect(state.sim.kinematics.geometry.throwPoint(1).x).toBeCloseTo(0.1, 9);
  });

  it('ignores a hand-point edit for an out-of-range hand', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().setHandPoint(9, 'catch', 1, 1);
    expect(useAppStore.getState().sim).toBe(before);
  });

  it('toggles the positions editor (gizmo visibility, presentation only)', () => {
    const before = useAppStore.getState().sim;
    expect(useAppStore.getState().positionsEditorOpen).toBe(false);
    useAppStore.getState().togglePositionsEditor();
    expect(useAppStore.getState().positionsEditorOpen).toBe(true);
    expect(useAppStore.getState().sim).toBe(before); // opening the editor never rebuilds
  });
});

describe('timeline-bar settings (DESIGN.md §6)', () => {
  it('has the DESIGN.md §7 defaults', () => {
    expect(DEFAULT_TIMELINE_WINDOW).toBe(3);
    expect(TIMELINE_WINDOW_MIN).toBe(1);
    expect(TIMELINE_WINDOW_MAX).toBe(15);
    const state = useAppStore.getState();
    expect(state.timelineWindow).toBe(3);
    expect(state.trailLength).toBeCloseTo(DEFAULT_TRAIL_LENGTH, 9);
    expect(state.ghostsEnabled).toBe(DEFAULT_GHOSTS_ENABLED);
  });

  it('clamps the timeline window to [1, 15] s', () => {
    useAppStore.getState().setTimelineWindow(100);
    expect(useAppStore.getState().timelineWindow).toBe(TIMELINE_WINDOW_MAX);
    useAppStore.getState().setTimelineWindow(0);
    expect(useAppStore.getState().timelineWindow).toBe(TIMELINE_WINDOW_MIN);
    useAppStore.getState().setTimelineWindow(5);
    expect(useAppStore.getState().timelineWindow).toBe(5);
  });

  it('clamps the trail length to [0, 8] s', () => {
    useAppStore.getState().setTrailLength(100);
    expect(useAppStore.getState().trailLength).toBe(TRAIL_LENGTH_MAX);
    useAppStore.getState().setTrailLength(-1);
    expect(useAppStore.getState().trailLength).toBe(TRAIL_LENGTH_MIN);
  });

  it('toggles ghosts', () => {
    const before = useAppStore.getState().ghostsEnabled;
    useAppStore.getState().toggleGhosts();
    expect(useAppStore.getState().ghostsEnabled).toBe(!before);
    useAppStore.getState().setGhostsEnabled(true);
    expect(useAppStore.getState().ghostsEnabled).toBe(true);
  });

  it('trail + ghost settings never rebuild the simulation (presentation only)', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().setTrailLength(2.5);
    useAppStore.getState().toggleGhosts();
    expect(useAppStore.getState().sim).toBe(before);
  });

  it('changing the window does not rebuild the sim when the horizon already covers it', () => {
    // At startup the horizon spans ~40 s, well beyond the widest window's needs.
    const before = useAppStore.getState().sim;
    useAppStore.getState().setTimelineWindow(TIMELINE_WINDOW_MAX);
    expect(useAppStore.getState().sim).toBe(before);
    expect(useAppStore.getState().timelineWindow).toBe(TIMELINE_WINDOW_MAX);
  });

  it('a wider window extends (never rebuilds) the horizon when it would run dry', () => {
    // Start from a deliberately short horizon so a wide window needs more future.
    const values = valuesOf('3');
    const shortSim = buildSimulation(
      values,
      '3',
      { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 },
      [],
      20, // ~5 s generated
    );
    useAppStore.setState({ sim: shortSim, simTime: 4 });
    const beat2Before = shortSim.timeline.beatTime(2);

    useAppStore.getState().setTimelineWindow(TIMELINE_WINDOW_MAX);
    const after = useAppStore.getState();
    const { futureSpan } = windowSpans(TIMELINE_WINDOW_MAX);
    // Horizon grew to cover the wide window; past beats stay bit-identical.
    expect(horizonTime(after.sim)).toBeGreaterThanOrEqual(neededHorizonTime(4, futureSpan));
    expect(after.sim.timeline.beatTime(2)).toBeCloseTo(beat2Before, 12);
  });
});

describe('charts & energy panel settings (DESIGN.md §6)', () => {
  it('has the presentation-only defaults', () => {
    // Redesign 2026-07-10: the bottom charts dock starts COLLAPSED (was `true`) so
    // the scene/ladder get full height and no per-frame sampling runs at boot.
    expect(DEFAULT_CHARTS_VISIBLE).toBe(false);
    expect(DEFAULT_CHART_AXIS_MODE).toBe('magnitude');
    const state = useAppStore.getState();
    expect(state.chartsVisible).toBe(false);
    expect(state.chartAxisMode).toBe('magnitude');
  });

  it('toggles visibility and sets the axis mode', () => {
    // beforeEach resets chartsVisible to DEFAULT_CHARTS_VISIBLE (false, redesign
    // 2026-07-10: the dock starts collapsed). Toggle flips it, set overrides it.
    expect(useAppStore.getState().chartsVisible).toBe(false);
    useAppStore.getState().toggleCharts();
    expect(useAppStore.getState().chartsVisible).toBe(true);
    useAppStore.getState().setChartsVisible(false);
    expect(useAppStore.getState().chartsVisible).toBe(false);
    useAppStore.getState().setChartAxisMode('y');
    expect(useAppStore.getState().chartAxisMode).toBe('y');
  });

  it('never rebuilds the simulation (presentation only)', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().toggleCharts();
    useAppStore.getState().setChartAxisMode('z');
    expect(useAppStore.getState().sim).toBe(before);
  });
});

describe('scrub (setSimTime)', () => {
  it('sets simTime directly and clamps to t ≥ 0', () => {
    useAppStore.getState().setSimTime(2.5);
    expect(useAppStore.getState().simTime).toBeCloseTo(2.5, 9);
    useAppStore.getState().setSimTime(-3);
    expect(useAppStore.getState().simTime).toBe(0);
  });

  it('works while paused (does not depend on the playing flag)', () => {
    useAppStore.setState({ playing: false });
    useAppStore.getState().setSimTime(1.75);
    expect(useAppStore.getState().simTime).toBeCloseTo(1.75, 9);
    expect(useAppStore.getState().playing).toBe(false);
  });

  it('scrubbing forward past the horizon extends it (never rebuilds the past)', () => {
    const values = valuesOf('3');
    const shortSim = buildSimulation(
      values,
      '3',
      { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 },
      [],
      20, // ~5 s generated
    );
    useAppStore.setState({ sim: shortSim, simTime: 0, timelineWindow: DEFAULT_TIMELINE_WINDOW });
    const beat2Before = shortSim.timeline.beatTime(2);

    useAppStore.getState().setSimTime(30); // far past the short horizon
    const after = useAppStore.getState();
    expect(after.simTime).toBe(30);
    expect(horizonTime(after.sim)).toBeGreaterThanOrEqual(neededHorizonTime(30));
    expect(after.sim.timeline.beatTime(2)).toBeCloseTo(beat2Before, 12);
  });
});
