import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  airTime,
  buildBeatSchedule,
  clampDwell,
  DEFAULT_SLEW_TIME_CONSTANT,
  effectiveDwell,
  guardBeatPeriod,
  slewBeatPeriod,
  throwKind,
} from './index';

describe('effectiveDwell (NOTATION identity 4)', () => {
  it('returns the full dwell when it is not clamped', () => {
    // beta * h * tau_b = 0.75 * 3 * 0.25 = 0.5625 > 0.3
    expect(effectiveDwell(0.3, 3, 0.25)).toBeCloseTo(0.3, 12);
  });

  it('clamps dwell on small throws so air time stays positive', () => {
    // h = 1: 0.75 * 1 * 0.25 = 0.1875 < 0.3
    expect(effectiveDwell(0.3, 1, 0.25)).toBeCloseTo(0.1875, 12);
  });
});

describe('clampDwell', () => {
  it('caps dwell below n_h * tau_b so the hand finishes its throw', () => {
    // cap = 0.9 * 2 * 0.25 = 0.45
    expect(clampDwell(0.3, 2, 0.25)).toBeCloseTo(0.3, 12);
    expect(clampDwell(0.9, 2, 0.25)).toBeCloseTo(0.45, 12);
  });
});

describe('throwKind', () => {
  it('classifies idle, hold and flight values', () => {
    expect(throwKind(0)).toBe('idle');
    expect(throwKind(2)).toBe('hold');
    expect(throwKind(1)).toBe('flight');
    expect(throwKind(3)).toBe('flight');
    expect(throwKind(9)).toBe('flight');
  });
});

describe('airTime (NOTATION identity 1)', () => {
  it('is h*tau_b - t_d_eff for airborne throws', () => {
    // h=3: 3*0.25 - min(0.3, 0.5625) = 0.75 - 0.3 = 0.45
    expect(airTime(3, 0.25, 0.3)).toBeCloseTo(0.45, 12);
    // h=1: 0.25 - 0.1875 = 0.0625
    expect(airTime(1, 0.25, 0.3)).toBeCloseTo(0.0625, 12);
  });

  it('is zero for held (2) and idle (0) values', () => {
    expect(airTime(2, 0.25, 0.3)).toBe(0);
    expect(airTime(0, 0.25, 0.3)).toBe(0);
  });

  it('is strictly positive for every airborne throw (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 35 }),
        fc.double({ min: 0.08, max: 1.0, noNaN: true }),
        fc.double({ min: 0.02, max: 5.0, noNaN: true }),
        (throwValue, beatPeriod, dwellTime) => {
          expect(airTime(throwValue, beatPeriod, dwellTime)).toBeGreaterThan(0);
        },
      ),
    );
    // The h=1 case (tightest) too.
    fc.assert(
      fc.property(fc.double({ min: 0.08, max: 1.0, noNaN: true }), (beatPeriod) => {
        expect(airTime(1, beatPeriod, 10)).toBeGreaterThan(0);
      }),
    );
  });
});

describe('slewBeatPeriod', () => {
  it('is a fixed point at the target', () => {
    expect(slewBeatPeriod(0.5, 0.5, 0.25)).toBeCloseTo(0.5, 12);
  });

  it('moves monotonically toward the target without overshoot', () => {
    let current = 0.25;
    const target = 0.5;
    for (let i = 0; i < 50; i++) {
      const next = slewBeatPeriod(current, target, current);
      expect(next).toBeGreaterThanOrEqual(current);
      expect(next).toBeLessThanOrEqual(target + 1e-12);
      current = next;
    }
    expect(current).toBeCloseTo(target, 3);
  });

  it('jumps straight to target for a non-positive time constant', () => {
    expect(slewBeatPeriod(0.25, 0.5, 0.25, 0)).toBe(0.5);
  });

  it('matches the closed-form exponential (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.08, max: 1, noNaN: true }),
        fc.double({ min: 0.08, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 2, noNaN: true }),
        (current, target, elapsed) => {
          const decay = Math.exp(-elapsed / DEFAULT_SLEW_TIME_CONSTANT);
          expect(slewBeatPeriod(current, target, elapsed)).toBeCloseTo(
            target + (current - target) * decay,
            12,
          );
        },
      ),
    );
  });
});

describe('guardBeatPeriod', () => {
  it('leaves the period alone when no arrival would be late', () => {
    expect(guardBeatPeriod(0.25, 1.0, [1.1, 1.2])).toBeCloseTo(0.25, 12);
  });

  it('lengthens the period so the next beat lands after every arrival', () => {
    // currentBeatTime 1.0, an arrival at 1.4 needs a period >= 0.4.
    expect(guardBeatPeriod(0.25, 1.0, [1.2, 1.4])).toBeCloseTo(0.4, 12);
  });

  it('never shortens below the proposed period', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { maxLength: 8 }),
        (proposed, currentBeatTime, arrivals) => {
          const guarded = guardBeatPeriod(proposed, currentBeatTime, arrivals);
          expect(guarded).toBeGreaterThanOrEqual(proposed - 1e-12);
          for (const arrival of arrivals) {
            expect(currentBeatTime + guarded).toBeGreaterThanOrEqual(arrival - 1e-9);
          }
        },
      ),
    );
  });
});

describe('buildBeatSchedule', () => {
  it('is a uniform grid at constant tempo', () => {
    const schedule = buildBeatSchedule({ beatCount: 4, initialBeatPeriod: 0.25 });
    expect(schedule.beatTimes).toEqual([0, 0.25, 0.5, 0.75, 1.0]);
    expect(schedule.beatPeriods).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('honors a start time offset', () => {
    const schedule = buildBeatSchedule({
      beatCount: 2,
      initialBeatPeriod: 0.5,
      startTime: 10,
    });
    expect(schedule.beatTimes).toEqual([10, 10.5, 11]);
  });

  it('slews the period toward a changed target', () => {
    const schedule = buildBeatSchedule({
      beatCount: 20,
      initialBeatPeriod: 0.25,
      targetFor: () => 0.5,
    });
    // Periods increase monotonically toward the 0.5 target.
    for (let i = 1; i < schedule.beatPeriods.length; i++) {
      expect(schedule.beatPeriods[i] as number).toBeGreaterThanOrEqual(
        schedule.beatPeriods[i - 1] as number,
      );
    }
    expect(schedule.beatPeriods.at(-1) as number).toBeGreaterThan(0.4);
    // Beat times are the running sum of periods.
    for (let i = 0; i < schedule.beatPeriods.length; i++) {
      expect(schedule.beatTimes[i + 1] as number).toBeCloseTo(
        (schedule.beatTimes[i] as number) + (schedule.beatPeriods[i] as number),
        12,
      );
    }
  });
});
