import { describe, expect, it } from 'vitest';
import {
  CATCH_TICK_FREQUENCY,
  THROW_TICK_FREQUENCY,
  pruneScheduledKeys,
  ticksInRange,
} from './audio';
import { buildSimulation } from '../state/simulation';
import { validatePattern } from '../core/siteswap';

function simOf(pattern: string) {
  const result = validatePattern(pattern);
  if (!result.ok) {
    throw new Error(`fixture ${pattern} invalid`);
  }
  return buildSimulation(
    result.values,
    pattern,
    { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 },
    [],
    40,
  );
}

describe('audio tick scheduling (ticksInRange)', () => {
  it('returns throw ticks whose sim time falls inside the window', () => {
    const events = simOf('3').timeline.events;
    const ticks = ticksInRange(events, 0.5, 1.5, false);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.kind).toBe('throw');
      expect(tick.frequency).toBe(THROW_TICK_FREQUENCY);
      expect(tick.time).toBeGreaterThanOrEqual(0.5);
      expect(tick.time).toBeLessThan(1.5);
    }
    // Ordered ascending in time.
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.time).toBeGreaterThanOrEqual(ticks[i - 1]!.time);
    }
  });

  it('every throw tick aligns with an actual throw event (times match one-for-one)', () => {
    const events = simOf('531').timeline.events;
    const throwTimes = events
      .filter((event) => event.kind === 'throw')
      .filter((event) => event.time >= 0.5 && event.time < 2.5)
      .map((event) => event.time)
      .sort((a, b) => a - b);
    const tickTimes = ticksInRange(events, 0.5, 2.5, false)
      .map((tick) => tick.time)
      .sort((a, b) => a - b);
    expect(tickTimes).toEqual(throwTimes);
  });

  it('includes catch ticks only when requested', () => {
    const events = simOf('3').timeline.events;
    const withoutCatch = ticksInRange(events, 0, 2, false);
    const withCatch = ticksInRange(events, 0, 2, true);
    expect(withCatch.length).toBeGreaterThan(withoutCatch.length);
    const catchTicks = withCatch.filter((tick) => tick.kind === 'catch');
    expect(catchTicks.length).toBeGreaterThan(0);
    for (const tick of catchTicks) {
      expect(tick.frequency).toBe(CATCH_TICK_FREQUENCY);
    }
  });

  it('assigns each tick a stable, unique identity key', () => {
    const events = simOf('441').timeline.events;
    const ticks = ticksInRange(events, 0, 3, true);
    const keys = new Set(ticks.map((tick) => tick.key));
    expect(keys.size).toBe(ticks.length); // no duplicates → no double-scheduling
  });

  it('returns nothing for an empty or inverted range', () => {
    const events = simOf('3').timeline.events;
    expect(ticksInRange(events, 1, 1, true)).toEqual([]);
    expect(ticksInRange(events, 2, 1, true)).toEqual([]);
    expect(ticksInRange([], 0, 10, true)).toEqual([]);
  });
});

describe('audio de-dupe pruning (pruneScheduledKeys)', () => {
  it('drops keys whose tick time is strictly before minSim, keeping the rest', () => {
    const scheduled = new Map<string, number>([
      ['throw-0-0', 0.1],
      ['throw-1-1', 0.4],
      ['catch-0-2', 0.9],
    ]);
    pruneScheduledKeys(scheduled, 0.5);
    expect([...scheduled.keys()]).toEqual(['catch-0-2']);
    expect(scheduled.get('catch-0-2')).toBe(0.9);
  });

  it('keeps a boundary tick sitting exactly on minSim (dropping only time < minSim)', () => {
    const scheduled = new Map<string, number>([['throw-0-0', 0.5]]);
    pruneScheduledKeys(scheduled, 0.5);
    expect(scheduled.has('throw-0-0')).toBe(true); // not < minSim → retained, no double-fire
  });

  it('stays bounded to a lookahead window under monotone advancing sim time', () => {
    // Simulate the scheduler bookkeeping: add one key per beat as sim advances,
    // pruning behind a cursor. The retained set must not grow without bound.
    const scheduled = new Map<string, number>();
    const tolerance = 0.08;
    let maxSize = 0;
    for (let beat = 0; beat < 1000; beat++) {
      const time = beat * 0.25;
      scheduled.set(`throw-${beat}`, time);
      // Sim cursor trails the just-added tick by ~one lookahead window.
      pruneScheduledKeys(scheduled, time - 0.12 - tolerance);
      maxSize = Math.max(maxSize, scheduled.size);
    }
    expect(maxSize).toBeLessThan(5); // constant, not O(beats)
  });

  it('is a no-op on an empty map', () => {
    const scheduled = new Map<string, number>();
    pruneScheduledKeys(scheduled, 1);
    expect(scheduled.size).toBe(0);
  });
});
