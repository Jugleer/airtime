import { describe, expect, it } from 'vitest';
import { parseNotation, type CompiledPattern } from '../siteswap';
import { buildTimeline, type TimelineParams } from './index';

const PARAMS: TimelineParams = { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 };

function compile(text: string): CompiledPattern {
  const parsed = parseNotation(text);
  if (!parsed.ok) {
    throw new Error(`fixture ${text} did not parse: ${parsed.errors[0]?.message}`);
  }
  return parsed.compiled;
}

function build(text: string, beatCount = 24) {
  return buildTimeline([], { beatCount, params: PARAMS, compiled: compile(text) });
}

/** Distinct ball ids among the in-window flights + carries. */
function ballIds(text: string): number[] {
  const timeline = build(text);
  const ids = new Set<number>();
  for (const f of timeline.flights) if (f.throwBeat >= 0 && f.throwBeat < 12) ids.add(f.ballId);
  return [...ids].sort((a, b) => a - b);
}

describe('buildCompiledTimeline — sync (4,4)', () => {
  const timeline = build('(4,4)');

  it('has both hands throwing on the same even beats, none on odd beats', () => {
    const beat0 = timeline.flights.filter((f) => f.throwBeat === 0);
    expect(beat0.map((f) => f.throwHand).sort()).toEqual([0, 1]);
    // A non-crossing sync 4 lands in the SAME hand.
    for (const f of beat0) expect(f.landingHand).toBe(f.throwHand);
    // No throws leave odd beats.
    expect(timeline.flights.some((f) => f.throwBeat % 2 === 1)).toBe(false);
  });

  it('is a 4-ball pattern (four distinct balls in a window)', () => {
    expect(ballIds('(4,4)')).toHaveLength(4);
  });

  it('lands each 4 exactly 4 beats after its throw', () => {
    for (const f of timeline.flights) {
      expect(f.landingBeat).toBe(f.throwBeat + 4);
    }
  });
});

describe('buildCompiledTimeline — sync (6x,4)*', () => {
  const timeline = build('(6x,4)*');

  it('crosses the 6x and keeps the 4 in-hand', () => {
    const sixes = timeline.flights.filter((f) => f.value === 6 && f.throwBeat >= 0);
    const fours = timeline.flights.filter((f) => f.value === 4 && f.throwBeat >= 0);
    expect(sixes.length).toBeGreaterThan(0);
    for (const f of sixes) expect(f.landingHand).not.toBe(f.throwHand); // crossing
    for (const f of fours) expect(f.landingHand).toBe(f.throwHand); // same hand
  });

  it('is a 5-ball pattern', () => {
    expect(ballIds('(6x,4)*')).toHaveLength(5);
  });
});

describe('buildCompiledTimeline — multiplex [33]33', () => {
  const timeline = build('[33]33');

  it('throws two balls from the same hand-beat at the multiplex beats', () => {
    // The multiplex is at beats 0, 3, 6, … (period 3). Two flights leave beat 0.
    const beat0 = timeline.flights.filter((f) => f.throwBeat === 0);
    expect(beat0).toHaveLength(2);
    expect(beat0[0]?.throwHand).toBe(beat0[1]?.throwHand);
    expect(beat0.every((f) => f.value === 3)).toBe(true);
  });

  it('is a 4-ball pattern', () => {
    expect(ballIds('[33]33')).toHaveLength(4);
  });

  it('the two co-thrown balls have distinct ball ids', () => {
    const beat0 = timeline.flights.filter((f) => f.throwBeat === 0);
    expect(beat0[0]?.ballId).not.toBe(beat0[1]?.ballId);
  });
});

describe('buildCompiledTimeline — multiplex 24[54]', () => {
  const timeline = build('24[54]');

  it('co-throws a 5 and a 4 from one hand at the multiplex beat', () => {
    const beat2 = timeline.flights.filter((f) => f.throwBeat === 2);
    expect(beat2.map((f) => f.value).sort()).toEqual([4, 5]);
    expect(beat2[0]?.throwHand).toBe(beat2[1]?.throwHand);
  });

  it('is a 5-ball pattern', () => {
    expect(ballIds('24[54]')).toHaveLength(5);
  });
});

describe('buildCompiledTimeline — carries connect flights (position/velocity chaining)', () => {
  it('every in-window carry starts at a catch and ends at a throw of the same ball', () => {
    for (const text of ['(4,4)', '(6x,4)*', '[33]33', '24[54]', '([44],2x)*']) {
      const timeline = build(text);
      for (const carry of timeline.carries) {
        if (carry.startBeat < 0 || carry.startBeat > 12) continue;
        // A delivering flight lands where the carry starts.
        const delivering = timeline.flights.find(
          (f) => f.ballId === carry.ballId && f.landingBeat === carry.startBeat,
        );
        // A departing flight leaves where the carry ends.
        const departing = timeline.flights.find(
          (f) => f.ballId === carry.ballId && f.throwBeat === carry.endBeat,
        );
        expect(delivering, `${text}: carry start has a delivering flight`).toBeDefined();
        expect(departing, `${text}: carry end has a departing flight`).toBeDefined();
        expect(carry.startTime).toBeCloseTo(delivering?.arrivalTime ?? -1, 9);
        expect(carry.endTime).toBeCloseTo(departing?.throwTime ?? -1, 9);
      }
    }
  });
});

// --- Memory fix #1: genFloor windowing (compiled sync / multiplex) -----------
//
// The compiled builder supports genFloor exactly like the vanilla one: the exposed
// window (events / flights / carries with a beat ≥ k) is bit-identical to the full
// build, and the schedule + ball ids are floor-invariant. (The store carves MULTIPLEX
// sims out at genFloor = 0 for their hand PATH, but the timeline + ball segments are
// still exact under windowing — that is what this asserts.)

describe('compiled genFloor windowing is bit-identical on the exposed window', () => {
  for (const text of ['(4,4)', '[52]3', '[43]23']) {
    it(`${text}: schedule/flights/carries/events ≥ k match the full build`, () => {
      const beatCount = 40;
      const compiled = compile(text);
      for (const k of [5, 12, 20, 31]) {
        const full = buildTimeline([], { beatCount, params: PARAMS, compiled });
        const win = buildTimeline([], { beatCount, params: PARAMS, compiled, genFloor: k });
        expect(win.schedule.beatTimes).toEqual(full.schedule.beatTimes);
        expect(win.schedule.beatPeriods).toEqual(full.schedule.beatPeriods);
        expect(win.flights.filter((f) => f.landingBeat >= k)).toEqual(
          full.flights.filter((f) => f.landingBeat >= k),
        );
        expect(win.carries.filter((c) => c.endBeat >= k)).toEqual(
          full.carries.filter((c) => c.endBeat >= k),
        );
        expect(
          win.events.filter((e) => (e.kind === 'hold' ? e.startBeat : e.beat) >= k),
        ).toEqual(full.events.filter((e) => (e.kind === 'hold' ? e.startBeat : e.beat) >= k));
        // Ball ids among the exposed flights are identical (floor-invariant threading).
        const idsOf = (t: ReturnType<typeof buildTimeline>): number[] =>
          [...new Set(t.flights.filter((f) => f.landingBeat >= k).map((f) => f.ballId))].sort(
            (a, b) => a - b,
          );
        expect(idsOf(win)).toEqual(idsOf(full));
      }
    });
  }
});
