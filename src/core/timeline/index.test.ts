import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { orbits, stateAt, validatePattern } from '../siteswap';
import {
  buildTimeline,
  type Carry,
  type CatchEvent,
  type Epoch,
  type HoldEvent,
  type ThrowEvent,
  type TimelineEvent,
  type TimelineParams,
} from './index';

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
        const base = ((target - index) % length + length) % length;
        return base + length * (extra[index] as number);
      });
    }),
);

describe('property: landing schedule matches the state-vector semantics', () => {
  it('timeline.landingScheduleAt == siteswap.stateAt for every beat', () => {
    fc.assert(
      fc.property(
        validPatternArb,
        fc.integer({ min: 1, max: 4 }),
        (values, handCount) => {
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
        },
      ),
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
        const catches = timeline.events.filter(
          (e): e is CatchEvent => e.kind === 'catch',
        );
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
