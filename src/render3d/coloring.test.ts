import { describe, expect, it } from 'vitest';
import { validatePattern, orbits } from '../core/siteswap';
import { buildKinematics, defaultHandGeometry } from '../core/kinematics';
import { buildTimeline } from '../core/timeline';
import { ORBIT_PALETTE, buildBallOrbits, orbitColor } from './coloring';

const HAND_COUNT = 2;

function simFor(pattern: string) {
  const validation = validatePattern(pattern);
  if (!validation.ok) {
    throw new Error(`test pattern ${pattern} is invalid`);
  }
  const values = validation.values;
  const timeline = buildTimeline(values, {
    beatCount: 48,
    params: { beatPeriod: 0.25, dwellTime: 0.3, handCount: HAND_COUNT },
  });
  const kinematics = buildKinematics(timeline, {
    values,
    handCount: HAND_COUNT,
    geometry: defaultHandGeometry(HAND_COUNT),
  });
  return { values, timeline, kinematics };
}

function orbitMap(pattern: string) {
  const { values, timeline, kinematics } = simFor(pattern);
  return buildBallOrbits(values, timeline.flights, kinematics.staticHolds(), HAND_COUNT);
}

describe('orbit color mapping (render3d layer)', () => {
  it('orbitColor indexes the palette and wraps', () => {
    expect(orbitColor(0)).toBe(ORBIT_PALETTE[0]);
    expect(orbitColor(ORBIT_PALETTE.length)).toBe(ORBIT_PALETTE[0]);
    expect(orbitColor(-1)).toBe(ORBIT_PALETTE[ORBIT_PALETTE.length - 1]);
  });

  it('maps every kinematics ball id (dynamic + holds) to an orbit', () => {
    for (const pattern of ['3', '441', '531', '40', '522']) {
      const { values, timeline, kinematics } = simFor(pattern);
      const map = buildBallOrbits(values, timeline.flights, kinematics.staticHolds(), HAND_COUNT);
      const ids = [...kinematics.ballIds(), ...kinematics.staticHolds().map((h) => h.ballId)];
      const orbitCount = orbits(values).length;
      for (const id of ids) {
        expect(map.has(id)).toBe(true);
        const orbit = map.get(id) as number;
        expect(orbit).toBeGreaterThanOrEqual(0);
        expect(orbit).toBeLessThan(Math.max(1, orbitCount));
      }
    }
  });

  it('a single-orbit cascade (3) puts every ball in orbit 0', () => {
    expect(orbits([3])).toEqual([[0]]); // one orbit
    const map = orbitMap('3');
    for (const orbit of map.values()) {
      expect(orbit).toBe(0);
    }
  });

  it('531 has two orbits and colors balls from both', () => {
    // orbits(531) = [[0,2],[1]] — the 5/1 stream and the standalone 3.
    expect(orbits([5, 3, 1])).toEqual([
      [0, 2],
      [1],
    ]);
    const map = orbitMap('531');
    const used = new Set(map.values());
    expect(used.has(0)).toBe(true);
    expect(used.has(1)).toBe(true);
    for (const orbit of used) {
      expect(orbit).toBeGreaterThanOrEqual(0);
      expect(orbit).toBeLessThan(2);
    }
  });

  it('maps static-hold balls (all-2 hands) to a valid orbit', () => {
    // Pattern 2 at n_h = 2: both hands hold a ball forever → two static holds.
    const { values, timeline, kinematics } = simFor('2');
    const holds = kinematics.staticHolds();
    expect(holds.length).toBeGreaterThan(0);
    const map = buildBallOrbits(values, timeline.flights, holds, HAND_COUNT);
    for (const hold of holds) {
      expect(map.get(hold.ballId)).toBe(0); // 2 has a single orbit
    }
  });
});
