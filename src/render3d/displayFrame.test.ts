// Pure tests for the sim ↔ display coordinate mapping (./displayFrame): the
// round-trip identity and the right-handedness of the display frame (via cross
// products), plus the triad axis metadata. No three.js / WebGL — the mapping is
// plain tuple math.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DISPLAY_AXES,
  DISPLAY_AXIS_COLORS,
  displayToSim,
  simToDisplay,
  type Vec3Tuple,
} from './displayFrame';

const coord = fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });
const vec = fc.tuple(coord, coord, coord);

function cross(a: Vec3Tuple, b: Vec3Tuple): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe('displayFrame mapping', () => {
  it('round-trips sim → display → sim exactly (identity)', () => {
    fc.assert(
      fc.property(vec, (v) => {
        const back = displayToSim(simToDisplay(v));
        expect(back[0]).toBeCloseTo(v[0], 12);
        expect(back[1]).toBeCloseTo(v[1], 12);
        expect(back[2]).toBeCloseTo(v[2], 12);
      }),
    );
  });

  it('round-trips display → sim → display exactly (identity)', () => {
    fc.assert(
      fc.property(vec, (v) => {
        const back = simToDisplay(displayToSim(v));
        expect(back[0]).toBeCloseTo(v[0], 12);
        expect(back[1]).toBeCloseTo(v[1], 12);
        expect(back[2]).toBeCloseTo(v[2], 12);
      }),
    );
  });

  it('realizes the owner-ratified axis choice (X=x, Z=up=y, Y=−z)', () => {
    // Component-wise (toBeCloseTo treats a benign −0 as 0).
    const expectVec = (got: Vec3Tuple, want: Vec3Tuple): void => {
      expect(got[0]).toBeCloseTo(want[0], 12);
      expect(got[1]).toBeCloseTo(want[1], 12);
      expect(got[2]).toBeCloseTo(want[2], 12);
    };
    expectVec(simToDisplay([1, 0, 0]), [1, 0, 0]); // sim x → display X
    expectVec(simToDisplay([0, 1, 0]), [0, 0, 1]); // sim y (up) → display Z
    expectVec(simToDisplay([0, 0, 1]), [0, -1, 0]); // sim z → display −Y
  });

  it('is a right-handed frame: display X × display Y = display Z', () => {
    // Images of the display unit axes back in the sim frame must obey the
    // right-hand rule, i.e. the mapping preserves orientation (det +1).
    const dx = DISPLAY_AXES[0]!.simDirection;
    const dy = DISPLAY_AXES[1]!.simDirection;
    const dz = DISPLAY_AXES[2]!.simDirection;
    const xy = cross(dx, dy);
    expect(xy[0]).toBeCloseTo(dz[0], 12);
    expect(xy[1]).toBeCloseTo(dz[1], 12);
    expect(xy[2]).toBeCloseTo(dz[2], 12);
  });

  it('exposes three orthonormal axis directions with X/Y/Z labels and distinct colors', () => {
    expect(DISPLAY_AXES.map((a) => a.name)).toEqual(['X', 'Y', 'Z']);
    for (const axis of DISPLAY_AXES) {
      expect(dot(axis.simDirection, axis.simDirection)).toBeCloseTo(1, 12); // unit
      expect(axis.color).toBe(DISPLAY_AXIS_COLORS[axis.name]);
    }
    // Mutually orthogonal.
    expect(dot(DISPLAY_AXES[0]!.simDirection, DISPLAY_AXES[1]!.simDirection)).toBeCloseTo(0, 12);
    expect(dot(DISPLAY_AXES[1]!.simDirection, DISPLAY_AXES[2]!.simDirection)).toBeCloseTo(0, 12);
    expect(dot(DISPLAY_AXES[0]!.simDirection, DISPLAY_AXES[2]!.simDirection)).toBeCloseTo(0, 12);
    // Colors all distinct.
    expect(new Set(Object.values(DISPLAY_AXIS_COLORS)).size).toBe(3);
  });
});
