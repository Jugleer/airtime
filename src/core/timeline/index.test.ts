import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { airTime, clampDwell } from '../timing';
import { orbits, stateAt, validatePattern } from '../siteswap';
import {
  bitsToState,
  buildStateGraph,
  maxThrowOf,
  patternCycle,
  planTransition,
  shortestCycle,
  stateAtBits,
  type StateBits,
} from '../stategraph';
import {
  buildTimeline,
  periodicSchedule,
  spliceSchedule,
  valueFromSchedule,
  type Carry,
  type CatchEvent,
  type Epoch,
  type HoldEvent,
  type PatternSchedule,
  type ThrowEvent,
  type TimelineEvent,
  type TimelineParams,
} from './index';

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

const DEFAULT_PARAMS: TimelineParams = {
  beatPeriod: 0.25,
  dwellTime: 0.3,
  handCount: 2,
};

function parse(text: string): number[] {
  const result = validatePattern(text);
  if (!result.ok) {
    throw new Error(`fixture pattern ${text} is invalid`);
  }
  return result.values;
}

const eventTime = (event: TimelineEvent): number =>
  event.kind === 'hold' ? event.startTime : event.time;

// --- Example patterns --------------------------------------------------------

describe('buildTimeline — cascade 3', () => {
  const timeline = buildTimeline(parse('3'), { beatCount: 12, params: DEFAULT_PARAMS });

  it('emits one throw and one catch per beat, alternating hands', () => {
    const throws = timeline.events.filter((e): e is ThrowEvent => e.kind === 'throw');
    expect(throws).toHaveLength(12);
    for (const t of throws) {
      expect(t.value).toBe(3);
      expect(t.hand).toBe(t.beat % 2);
      expect(t.landingHand).toBe((t.beat + 3) % 2);
    }
    const catches = timeline.events.filter((e) => e.kind === 'catch');
    expect(catches).toHaveLength(12);
  });

  it('has no hold or idle events', () => {
    expect(timeline.events.some((e) => e.kind === 'hold')).toBe(false);
    expect(timeline.events.some((e) => e.kind === 'idle')).toBe(false);
  });

  it('places throws on the uniform beat grid', () => {
    const throw0 = timeline.events.find((e) => e.kind === 'throw' && e.beat === 4);
    expect(throw0 && eventTime(throw0)).toBeCloseTo(4 * 0.25, 12);
  });
});

describe('buildTimeline — held and idle patterns', () => {
  it('40 idles the empty hand and never holds', () => {
    const timeline = buildTimeline(parse('40'), { beatCount: 12, params: DEFAULT_PARAMS });
    const idles = timeline.events.filter((e) => e.kind === 'idle');
    expect(idles).toHaveLength(6); // odd beats 1,3,5,7,9,11
    for (const idle of idles) {
      expect(idle.beat % 2).toBe(1);
    }
    expect(timeline.events.some((e) => e.kind === 'hold')).toBe(false);
  });

  it('522 merges the two consecutive 2s into one 4-beat carry', () => {
    const timeline = buildTimeline(parse('522'), { beatCount: 18, params: DEFAULT_PARAMS });
    const holds = timeline.events.filter((e): e is HoldEvent => e.kind === 'hold');
    expect(holds.length).toBeGreaterThan(0);
    for (const hold of holds) {
      // The ball is held from a catch (after a 5) through both 2s to the rethrow.
      expect(hold.beatSpan).toBe(4);
      expect(hold.endBeat - hold.startBeat).toBe(4);
      expect(hold.endTime).toBeGreaterThan(hold.startTime);
    }
  });

  it('423 holds the single 2 for a 2-beat carry', () => {
    const timeline = buildTimeline(parse('423'), { beatCount: 18, params: DEFAULT_PARAMS });
    const holds = timeline.events.filter((e): e is HoldEvent => e.kind === 'hold');
    expect(holds.length).toBeGreaterThan(0);
    for (const hold of holds) {
      expect(hold.beatSpan).toBe(2);
    }
  });

  it('501 treats the 1 as an airborne flight (no hold)', () => {
    const timeline = buildTimeline(parse('501'), { beatCount: 18, params: DEFAULT_PARAMS });
    expect(timeline.events.some((e) => e.kind === 'hold')).toBe(false);
    const ones = timeline.events.filter((e) => e.kind === 'throw' && e.value === 1);
    expect(ones.length).toBeGreaterThan(0);
    // Idle on the 0-beats (beat ≡ 1 mod 3).
    const idles = timeline.events.filter((e) => e.kind === 'idle');
    for (const idle of idles) {
      expect(idle.beat % 3).toBe(1);
    }
  });

  it('60 is a 3-ball one-handed pattern with idle on the empty hand', () => {
    const timeline = buildTimeline(parse('60'), { beatCount: 12, params: DEFAULT_PARAMS });
    const idles = timeline.events.filter((e) => e.kind === 'idle');
    expect(idles).toHaveLength(6);
  });
});

// --- Slew & guard ------------------------------------------------------------

describe('buildTimeline — slew-limited tempo', () => {
  it('spreads beat times when slowing down, with no negative dwell', () => {
    const epochs: Epoch[] = [{ beat: 4, params: { beatPeriod: 0.5 } }];
    const timeline = buildTimeline(parse('3'), {
      beatCount: 24,
      params: DEFAULT_PARAMS,
      epochs,
    });
    // Periods grow after the epoch and every carry keeps a non-negative dwell.
    const periods = timeline.schedule.beatPeriods;
    expect(periods[20] as number).toBeGreaterThan(periods[4] as number);
    for (const carry of timeline.carries) {
      expect(carry.endTime).toBeGreaterThanOrEqual(carry.startTime);
    }
  });
});

// --- Slew & guard: long-horizon stability -------------------------------------
//
// The guard-ratchet regression (BUILD_LOG): air time computed from the GUARDED
// period of a throw beat couples the guard back into throw height — a guard
// stretch δ inflates that throw's air time by h·δ, forcing a ≈(h−1)·δ guard h
// beats later. On a tempo speed-up with h ≥ ~6 the loop gain exceeds 1 and the
// schedule diverges (periods overflow to Infinity/NaN within a few thousand
// beats). Throws must be aimed with the PRE-guard (slewed) tempo; the guard's
// stretch lands in dwell (DESIGN.md §4.6 "dwell absorbs the slack"). These tests
// pin steady-state exactness, post-epoch convergence, and the exact runaway
// examples that used to overflow.

/** Reuse-me helper: min/max air time per throw value over a window of flights. */
function airTimeRangeByValue(
  flights: readonly { throwBeat: number; throwTime: number; arrivalTime: number; value: number }[],
  fromBeat: number,
  toBeat: number,
): Map<number, { min: number; max: number }> {
  const byValue = new Map<number, { min: number; max: number }>();
  for (const flight of flights) {
    if (flight.throwBeat < fromBeat || flight.throwBeat >= toBeat) {
      continue;
    }
    const air = flight.arrivalTime - flight.throwTime;
    const range = byValue.get(flight.value);
    if (range === undefined) {
      byValue.set(flight.value, { min: air, max: air });
    } else {
      range.min = Math.min(range.min, air);
      range.max = Math.max(range.max, air);
    }
  }
  return byValue;
}

// Long-horizon builds are slow on constrained hardware: these three suites use
// FEW runs with LONG horizons (the ratchet's onset needs thousands of beats to
// surface) and explicit timeouts, rather than many short runs that miss it.
const LONG_HORIZON_TIMEOUT = 120_000;

describe('property: constant params are exactly periodic over long horizons', () => {
  it(
    'beatPeriods identical and per-value air times constant over ~2000 beats',
    () => {
      fc.assert(
        fc.property(validPatternArb, (values) => {
          const beatCount = 2000;
          const timeline = buildTimeline(values, { beatCount, params: DEFAULT_PARAMS });
          // With target == base the slew is a fixed point and the guard can never
          // engage (a landing ball always arrives t_d_eff before its rethrow), so
          // every beat period is EXACTLY the base period — no drift, ever.
          for (const period of timeline.schedule.beatPeriods) {
            expect(period).toBe(DEFAULT_PARAMS.beatPeriod);
          }
          // Per-throw-value air time is constant across the whole window (float
          // noise from beat-time summation only — far below any visible height).
          for (const [, range] of airTimeRangeByValue(timeline.flights, 0, beatCount)) {
            expect(range.max - range.min).toBeLessThan(1e-12);
          }
        }),
        { numRuns: 25 },
      );
    },
    LONG_HORIZON_TIMEOUT,
  );
});

describe('property: a tempo epoch converges (no guard ratchet)', () => {
  it(
    'finite schedule, tail at target, dwell ≥ 0, air times at h·target − t_d_eff',
    () => {
      fc.assert(
        fc.property(
          validPatternArb,
          fc.double({ min: 0.08, max: 1.0, noNaN: true }),
          (values, target) => {
            const beatCount = 3000;
            const epochBeat = 40;
            const timeline = buildTimeline(values, {
              beatCount,
              params: DEFAULT_PARAMS,
              epochs: [{ beat: epochBeat, params: { beatPeriod: target } }],
            });
            // The whole generated schedule stays finite (pre-fix, speed-ups with
            // h ≥ ~6 overflowed to Infinity/NaN within a few thousand beats).
            for (const time of timeline.schedule.beatTimes) {
              expect(Number.isFinite(time)).toBe(true);
            }
            // Long after the epoch the slew has converged and the guard is silent:
            // the tail runs exactly at the slider target.
            const periods = timeline.schedule.beatPeriods;
            for (let beat = beatCount - 100; beat < beatCount; beat++) {
              expect(Math.abs((periods[beat] as number) - target)).toBeLessThan(1e-9);
            }
            // The guard's stretch lands in dwell, which never goes negative.
            for (const carry of timeline.carries) {
              expect(carry.endTime).toBeGreaterThanOrEqual(carry.startTime - 1e-9);
            }
            // Tail air times equal the steady-state identity at the NEW tempo:
            // t_air(h) = h·target − t_d_eff(h, target) (NOTATION identities 1, 4).
            const dwell = clampDwell(DEFAULT_PARAMS.dwellTime, DEFAULT_PARAMS.handCount, target);
            for (const [value, range] of airTimeRangeByValue(
              timeline.flights,
              beatCount - 100,
              beatCount,
            )) {
              const expected = airTime(value, target, dwell);
              expect(Math.abs(range.min - expected)).toBeLessThan(1e-9);
              expect(Math.abs(range.max - expected)).toBeLessThan(1e-9);
            }
          },
        ),
        { numRuns: 25 },
      );
    },
    LONG_HORIZON_TIMEOUT,
  );
});

describe('guard ratchet regressions: speed-ups that used to overflow', () => {
  // Pre-fix these three diverged (beat periods reached ~1e307, then beatTimes
  // went Infinity/NaN, freezing the app via NaN horizon checks). Post-fix they
  // converge to the target with the documented steady-state air times.
  const cases: readonly { pattern: string; target: number }[] = [
    { pattern: '744', target: 0.15 },
    { pattern: '567', target: 0.12 },
    { pattern: '9', target: 0.15 },
  ];
  for (const { pattern, target } of cases) {
    it(
      `${pattern} sped up to ${target} s stays finite and converges`,
      () => {
        const beatCount = 4000;
        const timeline = buildTimeline(parse(pattern), {
          beatCount,
          params: DEFAULT_PARAMS,
          epochs: [{ beat: 40, params: { beatPeriod: target } }],
        });
        for (const time of timeline.schedule.beatTimes) {
          expect(Number.isFinite(time)).toBe(true);
        }
        const periods = timeline.schedule.beatPeriods;
        for (let beat = beatCount - 100; beat < beatCount; beat++) {
          expect(Math.abs((periods[beat] as number) - target)).toBeLessThan(1e-9);
        }
        const dwell = clampDwell(DEFAULT_PARAMS.dwellTime, DEFAULT_PARAMS.handCount, target);
        const maxValue = Math.max(...parse(pattern));
        const tail = airTimeRangeByValue(timeline.flights, beatCount - 200, beatCount);
        const range = tail.get(maxValue);
        expect(range).toBeDefined();
        const expected = airTime(maxValue, target, dwell);
        expect(Math.abs((range as { min: number }).min - expected)).toBeLessThan(1e-9);
        expect(Math.abs((range as { max: number }).max - expected)).toBeLessThan(1e-9);
      },
      LONG_HORIZON_TIMEOUT,
    );
  }
});

// --- Property tests ----------------------------------------------------------

/** Argsort-derived permutation of [0..L-1]. */
function permutationFromKeys(keys: number[]): number[] {
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.index);
}

/** Arbitrary valid siteswap value array (collision-free, integer average). */
const validPatternArb = fc.integer({ min: 1, max: 6 }).chain((length) =>
  fc
    .record({
      keys: fc.array(fc.nat(), { minLength: length, maxLength: length }),
      extra: fc.array(fc.integer({ min: 0, max: 2 }), {
        minLength: length,
        maxLength: length,
      }),
    })
    .map(({ keys, extra }) => {
      const permutation = permutationFromKeys(keys);
      return permutation.map((target, index) => {
        const base = (((target - index) % length) + length) % length;
        return base + length * (extra[index] as number);
      });
    }),
);

describe('property: landing schedule matches the state-vector semantics', () => {
  it('timeline.landingScheduleAt == siteswap.stateAt for every beat', () => {
    fc.assert(
      fc.property(validPatternArb, fc.integer({ min: 1, max: 4 }), (values, handCount) => {
        const beatCount = 16;
        const maxHeight = Math.max(...values, 1) + 2;
        const timeline = buildTimeline(values, {
          beatCount,
          params: { ...DEFAULT_PARAMS, handCount },
        });
        for (let beat = 0; beat < beatCount; beat++) {
          expect(timeline.landingScheduleAt(beat, maxHeight)).toEqual(
            stateAt(values, beat, maxHeight),
          );
        }
      }),
    );
  });
});

describe('property: every catch precedes its throw', () => {
  it('each carry has startTime < endTime (positive dwell)', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const timeline = buildTimeline(values, { beatCount: 20, params: DEFAULT_PARAMS });
        for (const carry of timeline.carries) {
          expect(carry.endTime).toBeGreaterThan(carry.startTime - 1e-12);
        }
        // And every catch event precedes the same ball's next throw event.
        // Select the rethrow structurally — the same ball's earliest throw at or
        // after the catch beat (an immutable beat ordering, NOT a time filter) —
        // then assert its scheduled time did not regress before the catch. This
        // genuinely fails if a throw's time were computed ahead of its catch.
        const catches = timeline.events.filter((e): e is CatchEvent => e.kind === 'catch');
        const throws = timeline.events.filter((e): e is ThrowEvent => e.kind === 'throw');
        for (const c of catches) {
          const nextThrow = throws
            .filter((t) => t.ballId === c.ballId && t.beat >= c.beat)
            .sort((a, b) => a.beat - b.beat)[0];
          if (nextThrow) {
            expect(nextThrow.time).toBeGreaterThanOrEqual(c.time - 1e-9);
          }
        }
      }),
    );
  });
});

describe('property: per hand at most one ball held at all times', () => {
  it('carries assigned to the same hand never overlap (n_h = 2)', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const timeline = buildTimeline(values, { beatCount: 24, params: DEFAULT_PARAMS });
        const byHand = new Map<number, Carry[]>();
        for (const carry of timeline.carries) {
          const bucket = byHand.get(carry.hand) ?? [];
          bucket.push(carry);
          byHand.set(carry.hand, bucket);
        }
        for (const carriesForHand of byHand.values()) {
          const sorted = [...carriesForHand].sort((a, b) => a.startTime - b.startTime);
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1] as Carry;
            const curr = sorted[i] as Carry;
            // Non-overlapping: the next catch is no earlier than the prev throw.
            expect(curr.startTime).toBeGreaterThanOrEqual(prev.endTime - 1e-9);
          }
        }
      }),
    );
  });
});

describe('property: balls are conserved', () => {
  it('active flights + active carries == b at every interior instant', () => {
    fc.assert(
      fc.property(validPatternArb, (values) => {
        const result = validatePattern(values);
        if (!result.ok) {
          throw new Error('generated an invalid pattern');
        }
        const b = result.ballCount;
        if (b === 0) {
          return; // all-zero pattern: nothing to conserve.
        }
        // A held-forever orbit (a σ-cycle whose slots are all 2s) keeps a ball
        // in the hand forever — no departing flight, so the bounded carry model
        // represents no segment for it. Such patterns are excluded from the
        // ball-conservation check (a documented v1 edge, not juggling).
        if (orbits(values).some((cycle) => cycle.every((i) => values[i] === 2))) {
          return;
        }
        const beatCount = 28;
        const timeline = buildTimeline(values, { beatCount, params: DEFAULT_PARAMS });
        // Sample midpoints between consecutive beats, well inside the window.
        for (let beat = 6; beat < beatCount - 6; beat++) {
          const t = (timeline.beatTime(beat) + timeline.beatTime(beat + 1)) / 2;
          let active = 0;
          for (const flight of timeline.flights) {
            if (flight.throwTime < t && t < flight.arrivalTime) {
              active++;
            }
          }
          for (const carry of timeline.carries) {
            if (carry.startTime < t && t < carry.endTime) {
              active++;
            }
          }
          expect(active, `balls active at t=${t} (beat ${beat})`).toBe(b);
        }
      }),
    );
  });
});

describe('property: epoch immutability', () => {
  it('past instantaneous events are bit-identical after any parameter change', () => {
    const changeArb = fc.record({
      beatPeriod: fc.double({ min: 0.1, max: 0.6, noNaN: true }),
      dwellTime: fc.double({ min: 0.05, max: 0.4, noNaN: true }),
    });
    fc.assert(
      fc.property(
        validPatternArb,
        fc.integer({ min: 3, max: 12 }),
        changeArb,
        (values, epochBeat, change) => {
          const beatCount = 28;
          const baseline = buildTimeline(values, {
            beatCount,
            params: DEFAULT_PARAMS,
          });
          const changed = buildTimeline(values, {
            beatCount,
            params: DEFAULT_PARAMS,
            epochs: [{ beat: epochBeat, params: change }],
          });
          const epochTime = baseline.beatTime(epochBeat);

          // Schedule up to the epoch is unchanged.
          for (let beat = 0; beat <= epochBeat; beat++) {
            expect(changed.beatTime(beat)).toBeCloseTo(baseline.beatTime(beat), 12);
          }

          // Instantaneous events strictly before the epoch are identical.
          const before = (e: TimelineEvent): boolean =>
            e.kind !== 'hold' && e.time < epochTime - 1e-9;
          const baseBefore = baseline.events.filter(before);
          const changedBefore = changed.events.filter(before);
          expect(changedBefore).toEqual(baseBefore);
        },
      ),
    );
  });
});

// --- Pattern schedule (state-graph transitions) ------------------------------

describe('schedule helpers', () => {
  it('periodicSchedule reproduces values[beat mod L]', () => {
    const schedule = periodicSchedule([5, 3, 1]);
    for (let beat = -6; beat < 9; beat++) {
      expect(valueFromSchedule(schedule, beat)).toBe([5, 3, 1][floorMod(beat, 3)]);
    }
  });

  it('spliceSchedule keeps the prefix, inserts the bridge, then phases the target', () => {
    const schedule = spliceSchedule(periodicSchedule([3]), 4, [5, 5], [5, 1], 0);
    // Prehistory + beats < 4 are the prefix 3.
    expect(valueFromSchedule(schedule, -1)).toBe(3);
    expect(valueFromSchedule(schedule, 3)).toBe(3);
    // Bridge at beats 4,5.
    expect(valueFromSchedule(schedule, 4)).toBe(5);
    expect(valueFromSchedule(schedule, 5)).toBe(5);
    // Target 51 from beat 6, phase 0 → 5,1,5,1,...
    expect(valueFromSchedule(schedule, 6)).toBe(5);
    expect(valueFromSchedule(schedule, 7)).toBe(1);
    expect(valueFromSchedule(schedule, 8)).toBe(5);
  });

  it('spliceSchedule with an empty bridge starts the target at the splice beat', () => {
    const schedule = spliceSchedule(periodicSchedule([3]), 4, [], [5, 3, 1], 1);
    expect(valueFromSchedule(schedule, 3)).toBe(3);
    // Target 531 phased at 1 → beat4 = values[1] = 3, beat5 = values[2] = 1, ...
    expect(valueFromSchedule(schedule, 4)).toBe(3);
    expect(valueFromSchedule(schedule, 5)).toBe(1);
    expect(valueFromSchedule(schedule, 6)).toBe(5);
  });
});

/**
 * A realistic, collision-free transition schedule from a valid prefix pattern to a
 * valid target pattern (both ball count b, fitting N), planned through the state
 * graph so the seams are legal. Returns the schedule plus the metadata a splice
 * property needs.
 */
function makeTransition(
  prefixValues: readonly number[],
  targetValues: readonly number[],
  maxHeight: number,
  spliceBeat: number,
): { schedule: PatternSchedule; bridgeEndBeat: number; targetPhase: number } {
  const b = validatePattern(prefixValues).ok
    ? (validatePattern(prefixValues) as { ballCount: number }).ballCount
    : 0;
  const graph = buildStateGraph(b, maxHeight);
  const currentState = stateAtBits(prefixValues, spliceBeat, maxHeight);
  const cycle = patternCycle(targetValues, maxHeight);
  const plan = planTransition(graph, currentState, cycle.nodeSet);
  const targetPhase = cycle.phaseOf.get(plan.to) ?? 0;
  const schedule = spliceSchedule(
    periodicSchedule(prefixValues),
    spliceBeat,
    plan.throws,
    targetValues,
    targetPhase,
  );
  return { schedule, bridgeEndBeat: spliceBeat + plan.throws.length, targetPhase };
}

describe('buildTimeline — splice: bit-identical past', () => {
  it('3 -> 51 keeps every pre-splice event bit-identical (incl. ballId)', () => {
    const spliceBeat = 12;
    const { schedule } = makeTransition([3], [5, 1], 5, spliceBeat);
    const beatCount = 40;
    const baseline = buildTimeline([3], { beatCount, params: DEFAULT_PARAMS });
    const spliced = buildTimeline([3], { beatCount, params: DEFAULT_PARAMS, schedule });
    const spliceTime = baseline.beatTime(spliceBeat);

    // Beat schedule up to the splice is identical.
    for (let beat = 0; beat <= spliceBeat; beat++) {
      expect(spliced.beatTime(beat)).toBeCloseTo(baseline.beatTime(beat), 12);
    }
    // Instantaneous events strictly before the splice are bit-identical.
    const before = (e: TimelineEvent): boolean =>
      e.kind !== 'hold' && eventTime(e) < spliceTime - 1e-9;
    expect(spliced.events.filter(before)).toEqual(baseline.events.filter(before));
  });

  it('property: any same-b transition leaves the past bit-identical', () => {
    const arb = fc
      .record({ b: fc.integer({ min: 1, max: 3 }), extra: fc.integer({ min: 1, max: 3 }) })
      .map(({ b, extra }) => ({ b, n: Math.min(6, b + extra) }));
    fc.assert(
      fc.property(arb, fc.nat(), fc.nat(), ({ b, n }, pickA, pickB) => {
        const graph = buildStateGraph(b, n);
        const prefixValues = shortestCycle(
          graph,
          graph.nodes[pickA % graph.nodes.length] as StateBits,
        );
        const targetValues = shortestCycle(
          graph,
          graph.nodes[pickB % graph.nodes.length] as StateBits,
        );
        const spliceBeat = n + prefixValues.length + 4;
        const { schedule } = makeTransition(prefixValues, targetValues, n, spliceBeat);
        const beatCount = spliceBeat + 24;
        const baseline = buildTimeline(prefixValues, { beatCount, params: DEFAULT_PARAMS });
        const spliced = buildTimeline(prefixValues, {
          beatCount,
          params: DEFAULT_PARAMS,
          schedule,
        });
        const spliceTime = baseline.beatTime(spliceBeat);
        const before = (e: TimelineEvent): boolean =>
          e.kind !== 'hold' && eventTime(e) < spliceTime - 1e-9;
        expect(spliced.events.filter(before)).toEqual(baseline.events.filter(before));
      }),
      { numRuns: 60 },
    );
  });
});

describe('buildTimeline — splice: post-transition steady state', () => {
  it('property: landing schedules match the phased target once the bridge completes', () => {
    const arb = fc
      .record({ b: fc.integer({ min: 1, max: 3 }), extra: fc.integer({ min: 1, max: 3 }) })
      .map(({ b, extra }) => ({ b, n: Math.min(6, b + extra) }));
    fc.assert(
      fc.property(arb, fc.nat(), fc.nat(), ({ b, n }, pickA, pickB) => {
        const graph = buildStateGraph(b, n);
        const prefixValues = shortestCycle(
          graph,
          graph.nodes[pickA % graph.nodes.length] as StateBits,
        );
        const targetValues = shortestCycle(
          graph,
          graph.nodes[pickB % graph.nodes.length] as StateBits,
        );
        const spliceBeat = n + prefixValues.length + 4;
        const { schedule, bridgeEndBeat, targetPhase } = makeTransition(
          prefixValues,
          targetValues,
          n,
          spliceBeat,
        );
        const beatCount = bridgeEndBeat + 3 * n + 16;
        const spliced = buildTimeline(targetValues, {
          beatCount,
          params: DEFAULT_PARAMS,
          schedule,
        });
        // Well past the bridge (all landing sources are in the target region), the
        // state equals stateAt of the phased target — steady-state has been reached.
        const start = bridgeEndBeat + maxThrowOf(targetValues) + n;
        for (let beat = start; beat < beatCount; beat++) {
          const phase = floorMod(targetPhase + beat - bridgeEndBeat, targetValues.length);
          expect(spliced.landingScheduleAt(beat, n)).toEqual(
            bitsToState(stateAtBits(targetValues, phase, n), n),
          );
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('buildTimeline — splice: identity + held-2 across the seam', () => {
  it('threads ball identity and conserves balls straight through the splice', () => {
    const arb = fc
      .record({ b: fc.integer({ min: 1, max: 3 }), extra: fc.integer({ min: 1, max: 3 }) })
      .map(({ b, extra }) => ({ b, n: Math.min(6, b + extra) }));
    fc.assert(
      fc.property(arb, fc.nat(), fc.nat(), ({ b, n }, pickA, pickB) => {
        const graph = buildStateGraph(b, n);
        const prefixValues = shortestCycle(
          graph,
          graph.nodes[pickA % graph.nodes.length] as StateBits,
        );
        const targetValues = shortestCycle(
          graph,
          graph.nodes[pickB % graph.nodes.length] as StateBits,
        );
        // A held-forever orbit (all-2 pattern) has no bounded carry model; skip.
        const allTwo = (values: readonly number[]): boolean =>
          orbits(values).some((cycle) => cycle.every((i) => values[i] === 2));
        if (b === 0 || allTwo(prefixValues) || allTwo(targetValues)) {
          return;
        }
        const spliceBeat = n + prefixValues.length + 4;
        const { schedule } = makeTransition(prefixValues, targetValues, n, spliceBeat);
        const beatCount = spliceBeat + 20;
        const timeline = buildTimeline(targetValues, {
          beatCount,
          params: DEFAULT_PARAMS,
          schedule,
        });
        // Balls conserved at every interior midpoint, including across the splice.
        for (let beat = 6; beat < beatCount - 6; beat++) {
          const t = (timeline.beatTime(beat) + timeline.beatTime(beat + 1)) / 2;
          let active = 0;
          for (const flight of timeline.flights) {
            if (flight.throwTime < t && t < flight.arrivalTime) {
              active++;
            }
          }
          for (const carry of timeline.carries) {
            if (carry.startTime < t && t < carry.endTime) {
              active++;
            }
          }
          expect(active).toBe(b);
        }
        // Every carry keeps a non-negative dwell across the seam.
        for (const carry of timeline.carries) {
          expect(carry.endTime).toBeGreaterThan(carry.startTime - 1e-9);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('carries a held 2 across the splice as one merged carry (522 -> 522 via bridge)', () => {
    // Both patterns contain a held 2; a splice mid-pattern must still merge held
    // runs into one carry (no crash, positive dwell).
    const spliceBeat = 15;
    const { schedule } = makeTransition([5, 2, 2], [4, 4, 1], 5, spliceBeat);
    const timeline = buildTimeline([4, 4, 1], {
      beatCount: 40,
      params: DEFAULT_PARAMS,
      schedule,
    });
    // The prefix 522's held 2s (beats before the splice) still produce hold events.
    const holds = timeline.events.filter((e): e is HoldEvent => e.kind === 'hold');
    expect(holds.length).toBeGreaterThan(0);
    for (const carry of timeline.carries) {
      expect(carry.endTime).toBeGreaterThanOrEqual(carry.startTime - 1e-9);
    }
  });
});

describe('buildTimeline — edge cases', () => {
  it('returns an empty timeline for the empty pattern or zero beats', () => {
    const empty = buildTimeline([], { beatCount: 10, params: DEFAULT_PARAMS });
    expect(empty.events).toEqual([]);
    expect(empty.landingScheduleAt(0, 4)).toEqual([false, false, false, false]);
    const zero = buildTimeline(parse('3'), { beatCount: 0, params: DEFAULT_PARAMS });
    expect(zero.events).toEqual([]);
  });

  it('handles a one-hand pattern', () => {
    const timeline = buildTimeline(parse('3'), {
      beatCount: 6,
      params: { ...DEFAULT_PARAMS, handCount: 1 },
    });
    for (const e of timeline.events) {
      if (e.kind === 'throw' || e.kind === 'catch' || e.kind === 'idle') {
        expect(e.hand).toBe(0);
      }
    }
  });

  it('throws a RangeError for a beat past the generation range', () => {
    const timeline = buildTimeline(parse('3'), { beatCount: 12, params: DEFAULT_PARAMS });
    // In-window beats resolve to finite times; a far-future beat has no schedule.
    expect(Number.isFinite(timeline.beatTime(12))).toBe(true);
    expect(() => timeline.beatTime(10_000)).toThrow(RangeError);
  });
});
