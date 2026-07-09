import { beforeEach, describe, expect, it } from 'vitest';
import {
  BALL_RADIUS_MAX,
  BALL_RADIUS_MIN,
  DEFAULT_BALL_COLOR,
  DEFAULT_BALL_RADIUS,
  DEFAULT_BEAT_PERIOD,
  DEFAULT_DWELL_TIME,
  DEFAULT_GHOSTS_ENABLED,
  DEFAULT_HAND_COUNT,
  DEFAULT_ORBIT_COLORING,
  DEFAULT_TRAIL_LENGTH,
  TRAIL_LENGTH_MAX,
  TRAIL_LENGTH_MIN,
  dwellCap,
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
  it('has the DESIGN.md §7 defaults', () => {
    expect(DEFAULT_BALL_RADIUS).toBeCloseTo(0.035, 9);
    expect(BALL_RADIUS_MIN).toBeCloseTo(0.01, 9);
    expect(BALL_RADIUS_MAX).toBeCloseTo(0.1, 9);
    expect(DEFAULT_ORBIT_COLORING).toBe(false);
    const state = useAppStore.getState();
    expect(state.ballRadius).toBeCloseTo(DEFAULT_BALL_RADIUS, 9);
    expect(state.orbitColoring).toBe(false);
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

  it('toggles orbit coloring and sets the ball color, never rebuilding the sim', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().toggleOrbitColoring();
    expect(useAppStore.getState().orbitColoring).toBe(true);
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
