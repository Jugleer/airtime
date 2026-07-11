// State-graph navigation through the store (DESIGN.md §5): typed patterns and
// node clicks splice the running timeline — past bit-identical, balls unmoved at
// the swap instant (the glitch-free morph) — and different-b / beyond-cap
// patterns hard-reset with a visible notice.

import { beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_MAX_N, GRAPH_WARN_N, groundState, stateToBits } from '../core/stategraph';
import {
  DEFAULT_BALL_COLOR,
  DEFAULT_BALL_RADIUS,
  DEFAULT_BEAT_PERIOD,
  DEFAULT_DWELL_TIME,
  DEFAULT_GRAPH_MAX_HEIGHT,
  DEFAULT_GRAVITY_VALUE,
  DEFAULT_HAND_COUNT,
  DEFAULT_HOLD_DEPTH_VALUE,
  GRAPH_N_MIN,
  carryPathOf,
  presetGeometry,
  sampleHandPoints,
  useAppStore,
} from './index';
import {
  earliestGlitchFreeSpliceBeat,
  currentBeatIndex,
  firstBeatAtOrAfter,
  transitionStatusOf,
} from './simulation';
import type { TimelineEvent } from '../core/timeline';

const eventTime = (event: TimelineEvent): number =>
  event.kind === 'hold' ? event.startTime : event.time;

// The store is a module singleton; reset it to defaults before each test.
beforeEach(() => {
  const geometry = presetGeometry('line', DEFAULT_HAND_COUNT);
  const points = sampleHandPoints(geometry, DEFAULT_HAND_COUNT);
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
    gravity: DEFAULT_GRAVITY_VALUE,
    holdDepth: DEFAULT_HOLD_DEPTH_VALUE,
    carryPathKind: 'quintic',
    handThrowPoints: points.throwPoints,
    handCatchPoints: points.catchPoints,
    handPreset: 'line',
    ballRadius: DEFAULT_BALL_RADIUS,
    ballColor: DEFAULT_BALL_COLOR,
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
  useAppStore.getState().hardReset();
  useAppStore.getState().navigateToPattern('3');
  useAppStore.getState().hardReset(); // clean periodic '3' at t = 0
});

describe('navigateToPattern — same b (smooth transition)', () => {
  it('splices to 51 with a bridge, past events bit-identical, transition status live', () => {
    useAppStore.setState({ simTime: 2.13 });
    const before = useAppStore.getState().sim;
    useAppStore.getState().navigateToPattern('51');

    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('51');
    expect(state.sim.ballCount).toBe(3);
    expect(state.sim.schedule).toBeDefined();
    expect(state.graphNotice).toBeNull();

    // A ground-to-51 entry needs a bridge (the ground state is not on 51's cycle).
    expect(state.transition).not.toBeNull();
    const transition = state.transition;
    if (!transition) {
      return;
    }
    expect(transition.targetText).toBe('51');
    expect(transition.endBeat).toBeGreaterThan(transition.startBeat);

    // Past events strictly before the splice are bit-identical (incl. ballId).
    const spliceTime = state.sim.timeline.beatTime(transition.startBeat);
    const isBefore = (e: TimelineEvent): boolean =>
      e.kind !== 'hold' && eventTime(e) < spliceTime - 1e-9;
    expect(state.sim.timeline.events.filter(isBefore)).toEqual(
      before.timeline.events.filter(isBefore),
    );

    // Status line: "transitioning to 51 (k beats)" while the playhead is inside.
    const status = transitionStatusOf(state.sim, transition, 2.13);
    expect(status?.targetText).toBe('51');
    expect(status && status.beatsRemaining).toBeGreaterThan(0);
    // Past the transition's end beat the status clears.
    const doneTime = state.sim.timeline.beatTime(transition.endBeat) + 0.01;
    expect(transitionStatusOf(state.sim, transition, doneTime)).toBeNull();
  });

  it('does not move any ball at the swap instant (glitch-free morph)', () => {
    const t0 = 2.13; // mid-pattern, balls in flight and in hand
    useAppStore.setState({ simTime: t0 });
    const before = useAppStore.getState().sim;
    const ids = before.kinematics.ballIds();
    const positionsBefore = ids.map((id) => before.kinematics.ballState(id, t0).position);

    useAppStore.getState().navigateToPattern('51');
    const after = useAppStore.getState().sim;
    expect(after.kinematics.ballIds()).toEqual(ids);
    ids.forEach((id, index) => {
      const p = after.kinematics.ballState(id, t0).position;
      const q = positionsBefore[index];
      expect(q).toBeDefined();
      if (q) {
        expect(p.x).toBeCloseTo(q.x, 9);
        expect(p.y).toBeCloseTo(q.y, 9);
        expect(p.z).toBeCloseTo(q.z, 9);
      }
    });
  });

  it('the splice beat clears every carry active at the playhead', () => {
    const t0 = 2.13;
    useAppStore.setState({ simTime: t0 });
    const sim = useAppStore.getState().sim;
    const spliceBeat = earliestGlitchFreeSpliceBeat(sim, t0);
    expect(spliceBeat).toBeGreaterThanOrEqual(firstBeatAtOrAfter(sim.timeline, t0));
    for (const carry of sim.timeline.carries) {
      if (carry.startTime < t0 && t0 < carry.endTime) {
        expect(spliceBeat).toBeGreaterThan(carry.endBeat);
      }
    }
  });

  it('horizon extension mid-transition re-derives the same splice (bit-identical)', () => {
    useAppStore.setState({ simTime: 1.6 });
    useAppStore.getState().navigateToPattern('51');
    const spliced = useAppStore.getState().sim;
    const transition = useAppStore.getState().transition;
    expect(transition).not.toBeNull();

    useAppStore.getState().setSimTime(38); // far past the initial horizon
    const extended = useAppStore.getState().sim;
    expect(extended.beatCount).toBeGreaterThan(spliced.beatCount);
    expect(extended.schedule).toEqual(spliced.schedule);
    // Every event of the pre-extension window reappears identically (extension
    // appends beats; events for beats already in the window are bit-identical).
    const inOldWindow = (e: TimelineEvent): boolean =>
      e.kind !== 'hold' && e.beat < spliced.beatCount;
    expect(extended.timeline.events.filter(inOldWindow)).toEqual(
      spliced.timeline.events.filter(inOldWindow),
    );
  });

  it('typing the running pattern again is a no-bridge splice (no transition)', () => {
    useAppStore.setState({ simTime: 1.0 });
    useAppStore.getState().navigateToPattern('3');
    const state = useAppStore.getState();
    expect(state.transition).toBeNull();
    expect(state.sim.patternText).toBe('3');
  });

  it('auto-expands N to fit the target pattern (cap 11, warn threshold exported)', () => {
    // 9111: a valid b = 3 pattern with max throw 9 — same b as '3', so this is a
    // genuine transition that must raise N from the default 7 to 9.
    useAppStore.setState({ simTime: 0.9 });
    useAppStore.getState().navigateToPattern('9111');
    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('9111');
    expect(state.sim.ballCount).toBe(3);
    expect(state.graphMaxHeight).toBe(9);
    expect(state.graphNotice).toBeNull(); // a transition, not a hard reset
    expect(GRAPH_WARN_N).toBe(9);
    expect(GRAPH_MAX_N).toBe(11);
  });
});

describe('navigateToPattern — transition into an all-2 hand (no double-draw)', () => {
  const speedOf = (v: { x: number; y: number; z: number }): number =>
    Math.hypot(v.x, v.y, v.z);

  it('3 -> 42 renders exactly b balls and stays stable under horizon extension', () => {
    useAppStore.setState({ simTime: 1.6 });
    useAppStore.getState().navigateToPattern('42');
    const before = useAppStore.getState().sim;
    expect(before.patternText).toBe('42');
    expect(before.ballCount).toBe(3);
    // The ball that settled into hand 1 renders dynamically, so NO synthetic hold
    // is added — the pre-fix bug drew a static hold here on top of it (4 balls).
    expect(before.kinematics.staticHolds()).toEqual([]);
    const idsBefore = before.kinematics.ballIds();
    expect(idsBefore.length + before.kinematics.staticHolds().length).toBe(3);

    // A steady-state beat midpoint, well past the splice; find the resting held ball.
    const beat = 24;
    const tSteady = (before.timeline.beatTime(beat) + before.timeline.beatTime(beat + 1)) / 2;
    const resting = idsBefore.filter(
      (id) => speedOf(before.kinematics.ballState(id, tSteady).velocity) < 1e-9,
    );
    expect(resting).toHaveLength(1); // exactly one held ball, not two (no ghost)
    const heldId = resting[0] as number;
    const posBefore = before.kinematics.ballState(heldId, tSteady).position;

    // Extend the horizon far past the initial generation (append-only rebuild).
    useAppStore.getState().setSimTime(38);
    const after = useAppStore.getState().sim;
    expect(after.beatCount).toBeGreaterThan(before.beatCount);
    // Suppression does not flip as the window grows: same ids, still no holds.
    expect(after.kinematics.ballIds()).toEqual(idsBefore);
    expect(after.kinematics.staticHolds()).toEqual([]);
    // The held ball keeps its identity and rests at the same position.
    expect(speedOf(after.kinematics.ballState(heldId, tSteady).velocity)).toBeLessThan(1e-9);
    const posAfter = after.kinematics.ballState(heldId, tSteady).position;
    expect(posAfter.x).toBeCloseTo(posBefore.x, 9);
    expect(posAfter.y).toBeCloseTo(posBefore.y, 9);
    expect(posAfter.z).toBeCloseTo(posBefore.z, 9);
  });
});

describe('navigateToPattern — hard-reset paths (notice, no transition)', () => {
  it('different b hard-rebuilds with a visible notice', () => {
    useAppStore.setState({ simTime: 1.4 });
    useAppStore.getState().navigateToPattern('40'); // b = 2 from b = 3
    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('40');
    expect(state.sim.ballCount).toBe(2);
    expect(state.transition).toBeNull();
    expect(state.sim.schedule).toBeUndefined();
    expect(state.graphNotice).toMatch(/ball count changed/i);
  });

  it('a pattern with max throw > 11 runs via hard rebuild and flags the graph unavailable', () => {
    useAppStore.getState().navigateToPattern('c'); // h = 12 > 11, b = 12
    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('c');
    expect(state.transition).toBeNull();
    expect(state.graphNotice).toMatch(/unavailable/i);
    expect(state.graphNotice).toMatch(/max throw 12/);
    // Typing a small pattern afterwards is also a hard reset (source off-graph).
    useAppStore.getState().navigateToPattern('c');
    expect(useAppStore.getState().graphNotice).toMatch(/unavailable/i);
  });

  it('invalid input only surfaces the error (sim keeps running)', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().navigateToPattern('54');
    const state = useAppStore.getState();
    expect(state.validation.ok).toBe(false);
    expect(state.sim).toBe(before);
  });
});

describe('navigateToState', () => {
  it('clicking a bare state holds the shortest cycle through it (becomes the pattern)', () => {
    // From '3' (ground 111), click the excited state 10101 (N = 7: 1010100...).
    const target = stateToBits([true, false, true, false, true, false, false]);
    useAppStore.setState({ simTime: 1.1 });
    useAppStore.getState().navigateToState(target);
    const state = useAppStore.getState();
    // The shortest cycle through 10101 is a valid 3-ball pattern; it became the
    // running pattern and the input text shows it.
    expect(state.sim.ballCount).toBe(3);
    expect(state.pattern).toBe(state.sim.patternText);
    expect(state.pattern).not.toBe('3');
    expect(state.sim.schedule).toBeDefined();
    expect(state.transition).not.toBeNull();
  });

  it('an on-cycle node is still the goal — settles into its shortest cycle, not the running pattern', () => {
    // Owner 2026-07-11: clicking a node the running pattern already flows
    // through must behave like any other click (make it the goal, establish the
    // minimum loop), NOT silently keep the running pattern. Juggle 441 (cycle
    // 1110000 → 1101000 → 1011000) and click the ground node, whose shortest
    // cycle is the 3-cascade '3' — a strictly shorter, different pattern.
    useAppStore.getState().navigateToPattern('441');
    useAppStore.getState().hardReset(); // clean periodic 441 at t = 0
    useAppStore.setState({ simTime: 1.1 });
    useAppStore.getState().navigateToState(groundState(3));
    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('3'); // shortest cycle through the ground node
    expect(state.pattern).toBe('3');
    expect(state.sim.ballCount).toBe(3);
    expect(state.sim.schedule).toBeDefined();
  });

  it('a different on-cycle node settles into that node\'s own shortest cycle', () => {
    // The 1101000 node of 441 has shortest cycle '24' (also shorter than 441),
    // proving the goal is the CLICKED node, not a fixed re-entry into 441.
    useAppStore.getState().navigateToPattern('441');
    useAppStore.getState().hardReset();
    useAppStore.setState({ simTime: 1.1 });
    // 1101000 = bits 0,1,3 set.
    useAppStore.getState().navigateToState(
      stateToBits([true, true, false, true, false, false, false]),
    );
    expect(useAppStore.getState().sim.patternText).toBe('24');
  });

  it('clicking the current node whose shortest cycle IS the running pattern is idempotent (timeline intact)', () => {
    // Edge case (b): on '3', the ground node's shortest cycle is '3' itself —
    // the splice reproduces the pattern and must not corrupt the (bit-identical)
    // past.
    const t0 = 2.13; // mid-pattern
    useAppStore.setState({ simTime: t0 });
    const before = useAppStore.getState().sim;
    useAppStore.getState().navigateToState(groundState(3));
    const state = useAppStore.getState();
    expect(state.sim.patternText).toBe('3');
    expect(state.pattern).toBe('3');
    // Past events strictly before the splice are bit-identical.
    const spliceBeat = earliestGlitchFreeSpliceBeat(before, t0);
    const spliceTime = before.timeline.beatTime(spliceBeat);
    const isBefore = (e: TimelineEvent): boolean =>
      e.kind !== 'hold' && eventTime(e) < spliceTime - 1e-9;
    expect(state.sim.timeline.events.filter(isBefore)).toEqual(
      before.timeline.events.filter(isBefore),
    );
  });

  it('clicking mid-flight keeps the past bit-identical (edge case c — splice timing reused)', () => {
    // The clicked instant is mid-beat; earliestGlitchFreeSpliceBeat picks the
    // safe boundary. Juggle 441, click the ground node mid-flight.
    useAppStore.getState().navigateToPattern('441');
    useAppStore.getState().hardReset();
    const t0 = 2.37;
    useAppStore.setState({ simTime: t0 });
    const before = useAppStore.getState().sim;
    useAppStore.getState().navigateToState(groundState(3));
    const after = useAppStore.getState().sim;
    const spliceBeat = earliestGlitchFreeSpliceBeat(before, t0);
    const spliceTime = before.timeline.beatTime(spliceBeat);
    const isBefore = (e: TimelineEvent): boolean =>
      e.kind !== 'hold' && eventTime(e) < spliceTime - 1e-9;
    expect(after.timeline.events.filter(isBefore)).toEqual(
      before.timeline.events.filter(isBefore),
    );
    expect(after.patternText).toBe('3');
  });

  it('ignores a click on a non-node (wrong popcount)', () => {
    const before = useAppStore.getState().sim;
    useAppStore.getState().navigateToState(stateToBits([true, true, false, false, false]));
    expect(useAppStore.getState().sim).toBe(before); // b = 2 ≠ 3 — not a node
  });
});

describe('hardReset', () => {
  it('restarts clean: t = 0, periodic schedule, epochs cleared, transition cleared', () => {
    useAppStore.setState({ simTime: 1.3 });
    useAppStore.getState().setBeatPeriod(0.4); // creates an epoch
    useAppStore.getState().navigateToPattern('51'); // creates a transition
    expect(useAppStore.getState().sim.schedule).toBeDefined();

    useAppStore.getState().hardReset();
    const state = useAppStore.getState();
    expect(state.simTime).toBe(0);
    expect(state.transition).toBeNull();
    expect(state.graphNotice).toBeNull();
    expect(state.sim.schedule).toBeUndefined();
    expect(state.epochs).toHaveLength(0);
    expect(state.kinematicsEpochs).toHaveLength(0);
    expect(state.sim.patternText).toBe('51'); // the running pattern is kept
    // The current slider value folded into the base params.
    expect(state.baseParams.beatPeriod).toBeCloseTo(0.4, 9);
  });
});

describe('setGraphMaxHeight', () => {
  it('clamps to [3, 11] and never drops below the running pattern max throw', () => {
    useAppStore.getState().setGraphMaxHeight(99);
    expect(useAppStore.getState().graphMaxHeight).toBe(GRAPH_MAX_N);
    useAppStore.getState().setGraphMaxHeight(1);
    // Running pattern '3' has max throw 3 → floor is max(GRAPH_N_MIN, 3) = 3.
    expect(useAppStore.getState().graphMaxHeight).toBe(Math.max(GRAPH_N_MIN, 3));

    // With 9111 running (max throw 9), N cannot be stepped below 9.
    useAppStore.getState().navigateToPattern('9111');
    expect(useAppStore.getState().sim.patternText).toBe('9111');
    useAppStore.getState().setGraphMaxHeight(3);
    expect(useAppStore.getState().graphMaxHeight).toBe(9);
  });
});

describe('currentBeatIndex', () => {
  it('is the beat the playhead is inside (marker semantics)', () => {
    const sim = useAppStore.getState().sim;
    expect(currentBeatIndex(sim.timeline, 0)).toBe(0);
    expect(currentBeatIndex(sim.timeline, 0.26)).toBe(1); // beat 1 = [0.25, 0.5)
    expect(currentBeatIndex(sim.timeline, 0.25)).toBe(1);
    expect(currentBeatIndex(sim.timeline, 0.24)).toBe(0);
  });
});
