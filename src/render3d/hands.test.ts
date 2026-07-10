import { describe, expect, it } from 'vitest';
import { BALL_PALETTE } from '../state/ballColors';
import {
  HAND_CUP_RADIUS_FACTOR,
  HAND_PATH_MAX_PERIOD_BEATS,
  HAND_PATH_PALETTE,
  HAND_PATH_SAMPLES_PER_BEAT,
  handCupRadius,
  handPathColor,
  handPathPeriodBeats,
  handPathPointCount,
  handPathStartBeat,
  maxHandPathPoints,
} from './hands';

describe('handCupRadius', () => {
  it('scales the ball radius by the cup factor (~1.6–2×)', () => {
    expect(handCupRadius(0.035)).toBeCloseTo(0.035 * HAND_CUP_RADIUS_FACTOR, 12);
    expect(HAND_CUP_RADIUS_FACTOR).toBeGreaterThanOrEqual(1.6);
    expect(HAND_CUP_RADIUS_FACTOR).toBeLessThanOrEqual(2);
  });
});

describe('handPathPeriodBeats', () => {
  it('is 0 for a non-positive period (nothing to draw)', () => {
    expect(handPathPeriodBeats(0)).toBe(0);
    expect(handPathPeriodBeats(-3)).toBe(0);
  });

  it('rounds the spatial period to whole beats', () => {
    expect(handPathPeriodBeats(2)).toBe(2);
    expect(handPathPeriodBeats(6)).toBe(6);
  });

  it('caps very long periods at the sampling maximum', () => {
    expect(handPathPeriodBeats(1000)).toBe(HAND_PATH_MAX_PERIOD_BEATS);
  });
});

describe('handPathPointCount', () => {
  it('is 0 for no period', () => {
    expect(handPathPointCount(0)).toBe(0);
  });

  it('is ~samplesPerBeat per beat plus a closing point', () => {
    // 2 beats ⇒ 2·20 + 1 = 41 points (last sample closes the loop on the first).
    expect(handPathPointCount(2)).toBe(2 * HAND_PATH_SAMPLES_PER_BEAT + 1);
  });

  it('never exceeds the preallocated buffer capacity', () => {
    const cap = maxHandPathPoints();
    for (const period of [1, 2, 6, 12, HAND_PATH_MAX_PERIOD_BEATS, 1000]) {
      expect(handPathPointCount(period)).toBeLessThanOrEqual(cap);
      expect(handPathPointCount(period)).toBeGreaterThanOrEqual(2);
    }
  });

  it('maxHandPathPoints covers the longest sampled loop', () => {
    expect(maxHandPathPoints()).toBe(HAND_PATH_SAMPLES_PER_BEAT * HAND_PATH_MAX_PERIOD_BEATS + 1);
  });
});

describe('handPathStartBeat', () => {
  it('anchors one full period in when there is no kinematics epoch (skip startup)', () => {
    expect(handPathStartBeat(2, 160, -1)).toBe(2);
    expect(handPathStartBeat(6, 160, -1)).toBe(6);
  });

  it('anchors at the latest kinematics-epoch beat so param edits are reflected', () => {
    expect(handPathStartBeat(2, 160, 40)).toBe(40);
  });

  it('clamps the window so the whole loop stays inside the generated horizon', () => {
    // Epoch near the end: start pulls back so start + period ≤ beatCount.
    expect(handPathStartBeat(6, 100, 98)).toBe(94);
    expect(handPathStartBeat(6, 100, 98) + 6).toBeLessThanOrEqual(100);
  });

  it('is 0 for a degenerate period or empty horizon', () => {
    expect(handPathStartBeat(0, 160, 10)).toBe(0);
    expect(handPathStartBeat(2, 0, 10)).toBe(0);
  });
});

describe('handPathColor', () => {
  it('wraps by palette length and is total for any integer', () => {
    for (let hand = 0; hand < HAND_PATH_PALETTE.length; hand++) {
      expect(handPathColor(hand)).toBe(HAND_PATH_PALETTE[hand]);
    }
    expect(handPathColor(HAND_PATH_PALETTE.length)).toBe(HAND_PATH_PALETTE[0]);
    expect(handPathColor(-1)).toBe(HAND_PATH_PALETTE[HAND_PATH_PALETTE.length - 1]);
  });

  it('uses hues distinct from the per-ball palette (guide lines, not balls)', () => {
    const ballHues = new Set(BALL_PALETTE.map((c) => c.toLowerCase()));
    for (const hue of HAND_PATH_PALETTE) {
      expect(ballHues.has(hue.toLowerCase())).toBe(false);
    }
  });
});
