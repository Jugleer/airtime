// The shared per-ball color rule (state/ballColors): the palette resolver both
// the ladder and the 3D scene use, plus the stability guarantee that makes it
// meaningful — a ball keeps its color across horizon extension and across a
// pattern-transition splice (ballId anchoring, core/timeline + Phase 8).

import { beforeEach, describe, expect, it } from 'vitest';
import { BALL_PALETTE, ballPaletteColor, resolveBallColor } from './ballColors';
import { useAppStore } from './index';

describe('BALL_PALETTE / ballPaletteColor (pure)', () => {
  it('palette entries are distinct six-digit css hex colors', () => {
    expect(BALL_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BALL_PALETTE).size).toBe(BALL_PALETTE.length);
    for (const color of BALL_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('indexes by ballId and wraps modulo the palette length (total for any integer)', () => {
    const n = BALL_PALETTE.length;
    for (let ballId = 0; ballId < n; ballId++) {
      expect(ballPaletteColor(ballId)).toBe(BALL_PALETTE[ballId]);
      expect(ballPaletteColor(ballId + n)).toBe(BALL_PALETTE[ballId]);
      expect(ballPaletteColor(ballId + 3 * n)).toBe(BALL_PALETTE[ballId]);
    }
    expect(ballPaletteColor(-1)).toBe(BALL_PALETTE[n - 1]);
  });

  it('resolveBallColor: palette per ball when on, the single color for every id when off', () => {
    expect(resolveBallColor(true, '#ffffff', 3)).toBe(BALL_PALETTE[3]);
    expect(resolveBallColor(true, '#ffffff', 0)).toBe(BALL_PALETTE[0]);
    for (const ballId of [0, 1, 2, 7, 9, -2]) {
      expect(resolveBallColor(false, '#abcdef', ballId)).toBe('#abcdef');
    }
  });
});

// --- Color stability through the running sim (via the store singleton) ------
// A ball's color is a pure function of its ballId, so these pin the ballId
// half of the guarantee at the color level: the (throwBeat → color) map of the
// generated past never changes under extension or a smooth splice.

/** Per-throw color map for every pattern-era flight (throwBeat ≥ 0). */
function flightColors(sim: {
  timeline: { flights: readonly { throwBeat: number; ballId: number }[] };
}): Map<number, string> {
  const colors = new Map<number, string>();
  for (const flight of sim.timeline.flights) {
    if (flight.throwBeat >= 0) {
      colors.set(flight.throwBeat, ballPaletteColor(flight.ballId));
    }
  }
  return colors;
}

describe('per-ball colors are stable while the sim runs', () => {
  beforeEach(() => {
    useAppStore.setState({ simTime: 0, playing: true, transition: null, epochs: [] });
  });

  it('a horizon extension never recolors an already-generated throw (531)', () => {
    useAppStore.getState().setPattern('531');
    useAppStore.getState().hardReset();
    const before = useAppStore.getState().sim;
    const colorsBefore = flightColors(before);
    expect(colorsBefore.size).toBeGreaterThan(0);

    useAppStore.getState().setSimTime(38); // far past the initial horizon → extends
    const after = useAppStore.getState().sim;
    expect(after.beatCount).toBeGreaterThan(before.beatCount);

    const colorsAfter = flightColors(after);
    for (const [throwBeat, color] of colorsBefore) {
      expect(colorsAfter.get(throwBeat)).toBe(color);
    }
  });

  it('a splice transition (3 → 51) keeps every pre-splice color and every ball id', () => {
    useAppStore.getState().setPattern('3');
    useAppStore.getState().hardReset();
    useAppStore.setState({ simTime: 1.6 });
    const before = useAppStore.getState().sim;
    const colorsBefore = flightColors(before);
    const idsBefore = new Set(before.kinematics.ballIds());

    useAppStore.getState().navigateToPattern('51'); // same b → smooth splice
    const state = useAppStore.getState();
    const transition = state.transition;
    expect(transition).not.toBeNull();
    if (!transition) {
      throw new Error('expected a smooth transition');
    }

    // Flights thrown before the splice keep their ballId, hence their color.
    for (const flight of state.sim.timeline.flights) {
      if (flight.throwBeat >= 0 && flight.throwBeat < transition.startBeat) {
        expect(ballPaletteColor(flight.ballId)).toBe(colorsBefore.get(flight.throwBeat));
      }
    }
    // The same physical balls continue through the transition: same id set,
    // therefore the same palette colors on both sides of the splice.
    expect(new Set(state.sim.kinematics.ballIds())).toEqual(idsBefore);
  });
});
