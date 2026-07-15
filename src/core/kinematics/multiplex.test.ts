import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MULTIPLEX_CUP_OFFSET,
  buildKinematics,
  magnitude,
  multiplexCupOffset,
  type MotionState,
} from './index';
import { buildTimeline, type TimelineParams } from '../timeline';
import { parseNotation } from '../siteswap';

// multiplexCupOffset places co-located multiplex balls on a small horizontal ring
// by their stable ballId index so they don't z-fight (orchestrator ruling 4). It is
// exported but only consumed internally by buildKinematics; these tests pin its
// contract directly.
describe('core/kinematics multiplexCupOffset', () => {
  it('is deterministic per (index, count)', () => {
    expect(multiplexCupOffset(2, 5)).toEqual(multiplexCupOffset(2, 5));
    expect(multiplexCupOffset(0, 1)).toEqual(multiplexCupOffset(0, 1));
  });

  it('lies in the horizontal plane (zero y) with magnitude MULTIPLEX_CUP_OFFSET', () => {
    for (let count = 1; count <= 6; count++) {
      for (let index = 0; index < count; index++) {
        const off = multiplexCupOffset(index, count);
        expect(off.y).toBe(0);
        expect(magnitude(off)).toBeCloseTo(MULTIPLEX_CUP_OFFSET, 12);
      }
    }
  });

  it('spreads distinct indices to distinct points around the circle', () => {
    const count = 5;
    const seen = new Set<string>();
    for (let index = 0; index < count; index++) {
      const off = multiplexCupOffset(index, count);
      seen.add(`${off.x.toFixed(9)},${off.z.toFixed(9)}`);
    }
    expect(seen.size).toBe(count); // no two co-located balls share a point
  });

  it('property: horizontal, radius-invariant, at angle 2π·index/count', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (count) => {
        for (let index = 0; index < count; index++) {
          const off = multiplexCupOffset(index, count);
          const theta = (2 * Math.PI * index) / count;
          expect(off.y).toBe(0);
          expect(magnitude(off)).toBeCloseTo(MULTIPLEX_CUP_OFFSET, 12);
          expect(off.x).toBeCloseTo(MULTIPLEX_CUP_OFFSET * Math.cos(theta), 12);
          expect(off.z).toBeCloseTo(MULTIPLEX_CUP_OFFSET * Math.sin(theta), 12);
        }
      }),
    );
  });
});

// --- Memory fix #1: genFloor windowing for compiled ball segments ------------
//
// The compiled timeline supports genFloor exactly, so the exposed BALL motion of a
// windowed build is bit-identical to a full build (ball ids — and thus the multiplex
// cup offsets keyed by them — are floor-invariant over a recurring window). HAND-path
// equality is asserted only for pure SYNC (non-multiplex): the multiplex hand tiling
// is deliberately carved out at the store level (genFloor forced to 0).

const WPARAMS: TimelineParams = { beatPeriod: 0.25, dwellTime: 0.3, handCount: 2 };

function compileW(text: string) {
  const parsed = parseNotation(text);
  if (!parsed.ok) {
    throw new Error(`fixture ${text} did not parse`);
  }
  return parsed.compiled;
}

function expectStateEqual(a: MotionState, b: MotionState): void {
  expect(a).toEqual(b);
}

describe('compiled ball segments are bit-identical under genFloor windowing', () => {
  const beatCount = 64;
  const k = 32;
  for (const text of ['[52]3', '[43]23', '(4,4)']) {
    it(`${text}: exposed ball motion + static holds match the full build`, () => {
      const compiled = compileW(text);
      const full = buildTimeline([], { beatCount, params: WPARAMS, compiled });
      const win = buildTimeline([], { beatCount, params: WPARAMS, compiled, genFloor: k });
      const kFull = buildKinematics(full, { values: [], compiled, handCount: 2 });
      const kWin = buildKinematics(win, { values: [], compiled, handCount: 2, genFloor: k });

      // Ball ids recur over the exposed window, so the id set (and cup-offset indices)
      // match — a precondition for multiplex ball positions to be identical.
      expect(kWin.ballIds()).toEqual(kFull.ballIds());
      // Static-hold set is genFloor-invariant.
      expect(kWin.staticHolds()).toEqual(kFull.staticHolds());

      const tk = full.beatTime(k);
      const tEnd = full.beatTime(beatCount);
      for (const id of kWin.ballIds()) {
        for (let s = 0; s <= 50; s++) {
          const t = tk + ((tEnd - tk) * s) / 50;
          expectStateEqual(kWin.ballState(id, t), kFull.ballState(id, t));
        }
      }

      // Pure sync (non-multiplex) additionally keeps the HAND path exact; multiplex is
      // carved out (its overlapping-carry tiling is not a straddle problem).
      if (!compiled.multiplex) {
        for (let hand = 0; hand < 2; hand++) {
          for (let s = 0; s <= 50; s++) {
            const t = tk + ((tEnd - tk) * s) / 50;
            expectStateEqual(kWin.handState(hand, t), kFull.handState(hand, t));
          }
        }
      }
    });
  }
});
