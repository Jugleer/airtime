import { describe, expect, it } from 'vitest';
import { validateNotation, validatePattern } from '../core/siteswap';
import type { TimelineParams } from '../core/timeline';
import {
  buildSimulation,
  currentBeatIndex,
  defaultKinematicsConfig,
  extendedIfNeeded,
  firstBeatAtOrAfter,
  HORIZON_CHUNK_BEATS,
  INITIAL_BEATS,
  minimalHorizon,
  neededHorizonTime,
  RETAIN_PAST_BEATS,
  upsertEpoch,
  upsertKinematicsEpoch,
} from './simulation';
import { circleHandGeometry } from '../core/kinematics';

const BASE: TimelineParams = { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 };

function valuesOf(text: string): number[] {
  const result = validatePattern(text);
  if (!result.ok) {
    throw new Error(`fixture ${text} invalid`);
  }
  return result.values;
}

describe('buildSimulation', () => {
  it('produces timeline + kinematics for the cascade 3', () => {
    const sim = buildSimulation(valuesOf('3'), '3', BASE, [], 40);
    expect(sim.ballCount).toBe(3);
    expect(sim.spatialPeriodBeats).toBe(2); // 3 at n_h=2 repeats every 2 beats
    expect(sim.timeline.flights.length).toBeGreaterThan(0);
    // Three physical balls in a 3-cascade.
    expect(sim.kinematics.ballIds()).toHaveLength(3);
  });

  it('threads held carries for 522', () => {
    const sim = buildSimulation(valuesOf('522'), '522', BASE, [], 40);
    expect(sim.timeline.carries.some((carry) => carry.held)).toBe(true);
  });
});

describe('extendedIfNeeded', () => {
  it('returns the same object when the horizon already covers simTime', () => {
    const sim = buildSimulation(valuesOf('3'), '3', BASE, [], INITIAL_BEATS);
    // INITIAL_BEATS covers ~40 s; simTime 5 s is well inside.
    expect(extendedIfNeeded(sim, BASE, [], 5)).toBe(sim);
  });

  it('extends the horizon in chunks as simTime advances past it', () => {
    const sim = buildSimulation(valuesOf('3'), '3', BASE, [], 20); // ~5 s only
    const grown = extendedIfNeeded(sim, BASE, [], 30);
    expect(grown).not.toBe(sim);
    expect(grown.beatCount).toBeGreaterThanOrEqual(20 + HORIZON_CHUNK_BEATS);
    // Horizon now covers the requested time; beatTime does not throw.
    expect(grown.timeline.beatTime(grown.beatCount)).toBeGreaterThanOrEqual(neededHorizonTime(30));
  });
});

describe('firstBeatAtOrAfter', () => {
  const sim = buildSimulation(valuesOf('3'), '3', BASE, [], 40);

  it('returns 0 for non-positive sim time', () => {
    expect(firstBeatAtOrAfter(sim.timeline, -1)).toBe(0);
    expect(firstBeatAtOrAfter(sim.timeline, 0)).toBe(0);
  });

  it('returns the next beat boundary at or after a mid-beat time', () => {
    // Uniform 0.25 grid: beat 5 starts at 1.25 s.
    expect(firstBeatAtOrAfter(sim.timeline, 1.26)).toBe(6);
    expect(firstBeatAtOrAfter(sim.timeline, 1.25)).toBe(5);
  });
});

describe('upsertEpoch', () => {
  it('inserts a new epoch sorted by beat', () => {
    const a = upsertEpoch([], 6, { beatPeriod: 0.5 });
    const b = upsertEpoch(a, 3, { dwellTime: 0.2 });
    expect(b.map((epoch) => epoch.beat)).toEqual([3, 6]);
  });

  it('coalesces (merges) changes made at the same beat', () => {
    const a = upsertEpoch([], 6, { beatPeriod: 0.5 });
    const b = upsertEpoch(a, 6, { dwellTime: 0.2 });
    expect(b).toHaveLength(1);
    expect(b[0]?.params).toEqual({ beatPeriod: 0.5, dwellTime: 0.2 });
  });
});

describe('upsertKinematicsEpoch', () => {
  it('inserts kinematics epochs sorted by time', () => {
    const a = upsertKinematicsEpoch([], 1.5, { gravity: 4 });
    const b = upsertKinematicsEpoch(a, 0.5, { holdDepth: 0.2 });
    expect(b.map((epoch) => epoch.time)).toEqual([0.5, 1.5]);
  });

  it('coalesces (merges) edits at the same time', () => {
    const a = upsertKinematicsEpoch([], 1.0, { gravity: 4 });
    const b = upsertKinematicsEpoch(a, 1.0, { holdDepth: 0.2 });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ time: 1.0, gravity: 4, holdDepth: 0.2 });
  });
});

describe('buildSimulation with a kinematics config', () => {
  it('threads gravity / geometry into the kinematics (default omits to today behavior)', () => {
    const values = valuesOf('531');
    const config = { ...defaultKinematicsConfig(3), gravity: 4.2, geometry: circleHandGeometry(3) };
    const sim = buildSimulation(values, '531', { ...BASE, handCount: 3 }, [], 24, config);
    expect(sim.kinematics.gravity).toBeCloseTo(4.2, 12);
    expect(sim.kinematics.handCount).toBe(3);
    // A default build (no config arg) keeps the DESIGN §7 default gravity.
    const plain = buildSimulation(values, '531', BASE, [], 24);
    expect(plain.kinematics.gravity).toBeCloseTo(9.81, 12);
  });
});

// --- Memory fix #1: windowed generation + reconciler (genFloor) --------------

/** Max exposed-window ball-state divergence between two sims (should be 0). */
function exposedBallDivergence(
  a: ReturnType<typeof buildSimulation>,
  b: ReturnType<typeof buildSimulation>,
  fromTime: number,
  toTime: number,
): number {
  const ids = a.kinematics.ballIds();
  let worst = 0;
  for (const id of ids) {
    for (let s = 0; s <= 50; s++) {
      const t = fromTime + ((toTime - fromTime) * s) / 50;
      const pa = a.kinematics.ballPosition(id, t);
      const pb = b.kinematics.ballPosition(id, t);
      worst = Math.max(worst, Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y), Math.abs(pa.z - pb.z));
    }
  }
  return worst;
}

describe('memory fix #1: genFloor windowing + reconciler', () => {
  it('a windowed build is bit-identical to the full build on the exposed window', () => {
    const values = valuesOf('531');
    const beatCount = 200;
    const full = buildSimulation(values, '531', BASE, [], beatCount);
    const windowed = buildSimulation(values, '531', BASE, [], beatCount, undefined, undefined, undefined, 100);
    expect(full.genFloor).toBe(0);
    expect(windowed.genFloor).toBe(100);
    const from = full.timeline.beatTime(100);
    const to = full.timeline.beatTime(beatCount);
    expect(exposedBallDivergence(full, windowed, from, to)).toBe(0);
    // The schedule is floor-invariant (same beat grid from beat 0).
    expect(windowed.timeline.schedule.beatTimes).toEqual(full.timeline.schedule.beatTimes);
  });

  it('scrubbing below the floor rebuilds with a lower floor, still bit-identical', () => {
    const values = valuesOf('531');
    // A sim already windowed with a high floor.
    const windowed = buildSimulation(values, '531', BASE, [], 300, undefined, undefined, undefined, 200);
    // Scrub back to t = 0: the reconciler must drop the floor to 0 (deterministic).
    const rebuilt = extendedIfNeeded(windowed, BASE, [], 0);
    expect(rebuilt).not.toBe(windowed);
    expect(rebuilt.genFloor).toBe(0);
    // And it reproduces a fresh genFloor = 0 build exactly on the whole range.
    const fresh = buildSimulation(values, '531', BASE, [], rebuilt.beatCount);
    const to = fresh.timeline.beatTime(Math.min(rebuilt.beatCount, fresh.beatCount));
    expect(exposedBallDivergence(fresh, rebuilt, 0, to)).toBe(0);
  });

  it('forward play advances the floor and bounds the resident band', () => {
    const values = valuesOf('3');
    // ~140 s of horizon; enough beats that the retain floor advances above 0.
    const sim = buildSimulation(values, '3', BASE, [], 560);
    expect(sim.genFloor).toBe(0);
    const simTime = 138;
    const grown = extendedIfNeeded(sim, BASE, [], simTime);
    expect(grown).not.toBe(sim);
    // The floor advanced with the playhead: it trails by RETAIN_PAST_BEATS.
    const expectedFloor = Math.max(0, currentBeatIndex(sim.timeline, simTime) - RETAIN_PAST_BEATS);
    expect(grown.genFloor).toBe(expectedFloor);
    expect(grown.genFloor).toBeGreaterThan(0);
  });

  it('an export-style low floor pin keeps the clip start inside the window', () => {
    const values = valuesOf('531');
    // A running sim whose floor advanced high (as after a long session).
    const running = buildSimulation(values, '531', BASE, [], 300, undefined, undefined, undefined, 200);
    // Export pins the floor LOW (covering the clip start) via the reconciler.
    const pinned = extendedIfNeeded(running, BASE, [], running.timeline.beatTime(260), undefined, undefined, 40);
    expect(pinned.genFloor).toBe(40);
    // Early frames (below the old floor) now render real motion, matching a full build.
    const full = buildSimulation(values, '531', BASE, [], pinned.beatCount);
    const from = full.timeline.beatTime(40);
    const to = full.timeline.beatTime(200);
    expect(exposedBallDivergence(full, pinned, from, to)).toBe(0);
  });

  it('minimalHorizon trims both the future tail and advances the floor', () => {
    const values = valuesOf('3');
    // Inflated future tail (as after an export loop drove simTime far ahead).
    const inflated = buildSimulation(values, '3', BASE, [], 800);
    const trimmed = minimalHorizon(inflated, BASE, [], 4);
    expect(trimmed).not.toBe(inflated);
    expect(trimmed.beatCount).toBeLessThan(inflated.beatCount);
  });

  it('a multiplex sim is carved out (genFloor forced to 0)', () => {
    const analysis = validateNotation('[33]');
    if (!analysis.ok || analysis.vanilla) {
      throw new Error('[33] should compile to an extended multiplex pattern');
    }
    const compiled = analysis.compiled;
    expect(compiled.multiplex).toBe(true);
    const sim = buildSimulation([], compiled.text, BASE, [], 560, undefined, undefined, compiled);
    // Even a forward reconcile keeps the floor at 0 (the multiplex carve-out).
    const grown = extendedIfNeeded(sim, BASE, [], 138);
    expect(grown.genFloor).toBe(0);
  });
});
