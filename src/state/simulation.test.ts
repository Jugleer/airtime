import { describe, expect, it } from 'vitest';
import { validatePattern } from '../core/siteswap';
import type { TimelineParams } from '../core/timeline';
import {
  buildSimulation,
  defaultKinematicsConfig,
  extendedIfNeeded,
  firstBeatAtOrAfter,
  HORIZON_CHUNK_BEATS,
  INITIAL_BEATS,
  neededHorizonTime,
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
