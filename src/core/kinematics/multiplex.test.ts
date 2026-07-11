import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MULTIPLEX_CUP_OFFSET, magnitude, multiplexCupOffset } from './index';

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
