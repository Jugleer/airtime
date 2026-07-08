import { describe, expect, it } from 'vitest';
import { landingBeat, landingHand, type ThrowEvent } from './index';

describe('core/timeline placeholder', () => {
  const event: ThrowEvent = { beat: 0, hand: 0, throwValue: 3 };

  it('lands a throw h beats later', () => {
    expect(landingBeat(event)).toBe(3);
  });

  it('routes the landing to hand (beat + h) mod n_h', () => {
    expect(landingHand(event, 2)).toBe(1);
    expect(landingHand({ beat: 1, hand: 1, throwValue: 3 }, 2)).toBe(0);
  });
});
